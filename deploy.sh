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

# Runtime + build vars actually used by the app code (see src/ usages).
# DATABASE_URL is server-only; NEXT_PUBLIC_* must be present at build time
# because Next.js inlines them into the client bundle.
REQUIRED_VARS=(
    "NEXT_PUBLIC_SUPABASE_URL"
    "NEXT_PUBLIC_SUPABASE_ANON_KEY"
    "DATABASE_URL"
    "SUPABASE_SERVICE_ROLE_KEY"
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
ENV_VARS+="${ENV_DELIM}APP_ENV=production"

echo "🚀 Deploying ${IMAGE} to Cloud Run service ${SERVICE_NAME} in ${REGION}..."
gcloud run deploy "${SERVICE_NAME}" \
    --image="${IMAGE}" \
    --project="${PROJECT_ID}" \
    --region="${REGION}" \
    --platform=managed \
    --allow-unauthenticated \
    --port=3000 \
    --set-env-vars="${ENV_VARS}" \
    --set-secrets="DATABASE_URL=${DB_SECRET_NAME}:latest,SUPABASE_SERVICE_ROLE_KEY=${SERVICE_ROLE_SECRET_NAME}:latest"

echo "✅ Deployment complete."
echo "🌐 Service URL:"
gcloud run services describe "${SERVICE_NAME}" \
    --region="${REGION}" \
    --project="${PROJECT_ID}" \
    --format="value(status.url)"
