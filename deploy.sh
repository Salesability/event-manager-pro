#!/bin/bash

# Google Cloud Run deployment script for event-manager-pro.
# Builds the image via Cloud Build (NEXT_PUBLIC_* baked in as build args),
# then deploys to Cloud Run with runtime env vars set on the service.

set -euo pipefail

# Load .env.local into the environment so we can reuse the same values
# for the build and the Cloud Run service.
if [ -f .env.local ]; then
    echo "📄 Loading environment variables from .env.local..."
    set -a
    # shellcheck disable=SC1091
    source .env.local
    set +a
else
    echo "⚠️  No .env.local file found. Falling back to current shell env."
fi

PROJECT_ID="${GCP_PROJECT_ID:-nnwweb}"
SERVICE_NAME="${GCP_SERVICE_NAME:-event-manager-pro}"
REGION="${GCP_REGION:-northamerica-northeast1}"
DB_SECRET_NAME="${GCP_DATABASE_URL_SECRET:-database-url}"
SERVICE_ROLE_SECRET_NAME="${GCP_SERVICE_ROLE_SECRET:-supabase-service-role-key}"
IMAGE_TAG="$(date -u +%Y%m%d-%H%M%S)"
IMAGE="gcr.io/${PROJECT_ID}/${SERVICE_NAME}:${IMAGE_TAG}"

# Public origin used by server actions to build OAuth/magic-link redirect URLs.
# Override via PROD_SITE_URL if the service hostname changes.
PROD_SITE_URL="${PROD_SITE_URL:-https://event-manager-pro-7435lagfjq-nn.a.run.app}"

# APP_ENV value baked into the Cloud Run service. Default 'production' real-
# sends through Resend (no EMAIL_DEV_TO redirect) and marks BoldSign envelopes
# as non-sandbox (sendForSign.isSandbox = false). Override to any
# non-production value (e.g. 'sandbox', 'staging') to flip the BoldSign
# `isSandbox` flag and route Resend mail through `EMAIL_DEV_TO`:
#   DEPLOY_APP_ENV=sandbox ./deploy.sh
# Note: sandbox-vs-prod is signaled per-request via the `isSandbox` flag, NOT
# by a different host — BoldSign uses one regional host per account regardless
# of mode (BOLDSIGN_API_BASE_URL below picks the region). A sandbox-tier
# API key against APP_ENV=production (or vice versa) 401s — match them.
# Separate name from APP_ENV so that sourcing .env.local (which sets
# APP_ENV=development for the local dev server) doesn't shadow it.
DEPLOY_APP_ENV="${DEPLOY_APP_ENV:-production}"

# Runtime + build vars actually used by the app code (see src/ usages).
# DATABASE_URL is server-only; NEXT_PUBLIC_* must be present at build time
# because Next.js inlines them into the client bundle.
REQUIRED_VARS=(
    "NEXT_PUBLIC_SUPABASE_URL"
    "NEXT_PUBLIC_SUPABASE_ANON_KEY"
    "DATABASE_URL"
    "SUPABASE_SERVICE_ROLE_KEY"
    "MSA_TEMPLATE_VERSION"
    "BOLDSIGN_API_KEY"
    "BOLDSIGN_WEBHOOK_SECRET"
    "GCS_BUCKET"
    "RESEND_API_KEY"
    "RESEND_FROM_EMAIL"
)
MISSING_VARS=()
for var in "${REQUIRED_VARS[@]}"; do
    if [ -z "${!var:-}" ]; then
        MISSING_VARS+=("$var")
    fi
done
if [ ${#MISSING_VARS[@]} -ne 0 ]; then
    echo "❌ Missing required environment variables: ${MISSING_VARS[*]}"
    echo "   Set them in .env.local or export them before running."
    exit 1
fi
echo "✅ Required environment variables present."

ensure_secret() {
    local secret_name="$1"
    local local_var="$2"
    echo "🔐 Ensuring Secret Manager secret '${secret_name}' exists..."
    if ! gcloud secrets describe "${secret_name}" --project="${PROJECT_ID}" >/dev/null 2>&1; then
        echo "   Secret not found — creating from local ${local_var}."
        printf '%s' "${!local_var}" | gcloud secrets create "${secret_name}" \
            --project="${PROJECT_ID}" \
            --replication-policy=automatic \
            --data-file=-
    else
        echo "   Secret exists — leaving stored value untouched."
        echo "   To push a new version from local .env.local, run:"
        echo "     printf '%s' \"\$${local_var}\" | gcloud secrets versions add ${secret_name} --project=${PROJECT_ID} --data-file=-"
    fi
}

ensure_secret "${DB_SECRET_NAME}" "DATABASE_URL"
ensure_secret "${SERVICE_ROLE_SECRET_NAME}" "SUPABASE_SERVICE_ROLE_KEY"
ensure_secret "boldsign-api-key" "BOLDSIGN_API_KEY"
ensure_secret "boldsign-webhook-secret" "BOLDSIGN_WEBHOOK_SECRET"
ensure_secret "resend-api-key" "RESEND_API_KEY"

PROJECT_NUMBER="$(gcloud projects describe "${PROJECT_ID}" --format='value(projectNumber)')"
RUNTIME_SA="${GCP_RUNTIME_SA:-${PROJECT_NUMBER}-compute@developer.gserviceaccount.com}"

grant_secret_access() {
    local secret_name="$1"
    echo "🔑 Granting ${RUNTIME_SA} access to secret '${secret_name}' (idempotent)..."
    gcloud secrets add-iam-policy-binding "${secret_name}" \
        --project="${PROJECT_ID}" \
        --member="serviceAccount:${RUNTIME_SA}" \
        --role="roles/secretmanager.secretAccessor" \
        --condition=None \
        --quiet >/dev/null
}

grant_secret_access "${DB_SECRET_NAME}"
grant_secret_access "${SERVICE_ROLE_SECRET_NAME}"
grant_secret_access "boldsign-api-key"
grant_secret_access "boldsign-webhook-secret"
grant_secret_access "resend-api-key"

echo "🏗️  Building image ${IMAGE} via Cloud Build..."
gcloud builds submit \
    --config cloudbuild.yaml \
    --project="${PROJECT_ID}" \
    --substitutions="_SERVICE_NAME=${SERVICE_NAME},_IMAGE_TAG=${IMAGE_TAG},_NEXT_PUBLIC_SUPABASE_URL=${NEXT_PUBLIC_SUPABASE_URL},_NEXT_PUBLIC_SUPABASE_ANON_KEY=${NEXT_PUBLIC_SUPABASE_ANON_KEY}"

# NEXT_PUBLIC_* are already in the bundle (build-time), but Cloud Run also
# needs them at runtime so server-rendered code in the standalone server can
# read process.env.NEXT_PUBLIC_*. DATABASE_URL is mounted from Secret Manager.
ENV_DELIM='@@'
ENV_VARS="^${ENV_DELIM}^"
ENV_VARS+="NEXT_PUBLIC_SUPABASE_URL=${NEXT_PUBLIC_SUPABASE_URL}"
ENV_VARS+="${ENV_DELIM}NEXT_PUBLIC_SUPABASE_ANON_KEY=${NEXT_PUBLIC_SUPABASE_ANON_KEY}"
ENV_VARS+="${ENV_DELIM}SITE_URL=${PROD_SITE_URL}"
ENV_VARS+="${ENV_DELIM}APP_ENV=${DEPLOY_APP_ENV}"
ENV_VARS+="${ENV_DELIM}MSA_TEMPLATE_VERSION=${MSA_TEMPLATE_VERSION}"
ENV_VARS+="${ENV_DELIM}GCS_BUCKET=${GCS_BUCKET}"
ENV_VARS+="${ENV_DELIM}RESEND_FROM_EMAIL=${RESEND_FROM_EMAIL}"
# Optional vars — only include if set locally
if [ -n "${GCS_PROJECT_ID:-}" ]; then
    ENV_VARS+="${ENV_DELIM}GCS_PROJECT_ID=${GCS_PROJECT_ID}"
fi
if [ -n "${EMAIL_DEV_TO:-}" ]; then
    ENV_VARS+="${ENV_DELIM}EMAIL_DEV_TO=${EMAIL_DEV_TO}"
fi
# BOLDSIGN_API_BASE_URL picks the regional API host (US default unset; EU =
# api-eu.boldsign.com; CA = api-ca.boldsign.com). Optional — only included
# when set locally; absent means Cloud Run uses the US default at runtime.
if [ -n "${BOLDSIGN_API_BASE_URL:-}" ]; then
    ENV_VARS+="${ENV_DELIM}BOLDSIGN_API_BASE_URL=${BOLDSIGN_API_BASE_URL}"
fi

BOLDSIGN_HOST="${BOLDSIGN_API_BASE_URL:-https://api.boldsign.com (US default)}"
if [ "${DEPLOY_APP_ENV}" = "production" ]; then
    BOLDSIGN_MODE="production (isSandbox=false — key must be a production-tier key)"
else
    BOLDSIGN_MODE="sandbox (isSandbox=true — key must be a sandbox-tier key)"
fi
echo "📍 BoldSign host: ${BOLDSIGN_HOST}"
echo "📍 BoldSign mode: ${BOLDSIGN_MODE} (APP_ENV=${DEPLOY_APP_ENV})"
if [ "${DEPLOY_APP_ENV}" != "production" ] && [ -z "${EMAIL_DEV_TO:-}" ]; then
    echo "⚠️  DEPLOY_APP_ENV=${DEPLOY_APP_ENV} but EMAIL_DEV_TO is unset — sendEmail + BoldSign sendSignatureRequest will refuse to send on the deployed service."
fi

echo "🚀 Deploying ${IMAGE} to Cloud Run service ${SERVICE_NAME} in ${REGION}..."
gcloud run deploy "${SERVICE_NAME}" \
    --image="${IMAGE}" \
    --project="${PROJECT_ID}" \
    --region="${REGION}" \
    --platform=managed \
    --allow-unauthenticated \
    --port=3000 \
    --set-env-vars="${ENV_VARS}" \
    --set-secrets="DATABASE_URL=${DB_SECRET_NAME}:latest,SUPABASE_SERVICE_ROLE_KEY=${SERVICE_ROLE_SECRET_NAME}:latest,BOLDSIGN_API_KEY=boldsign-api-key:latest,BOLDSIGN_WEBHOOK_SECRET=boldsign-webhook-secret:latest,RESEND_API_KEY=resend-api-key:latest"

echo "✅ Deployment complete."
echo "🌐 Service URL:"
gcloud run services describe "${SERVICE_NAME}" \
    --region="${REGION}" \
    --project="${PROJECT_ID}" \
    --format="value(status.url)"
