#!/bin/bash

# Google Cloud Run deployment script for event-manager-pro.
# Builds the image via Cloud Build (NEXT_PUBLIC_* baked in as build args),
# then deploys to Cloud Run with runtime env vars set on the service.

set -euo pipefail

# Load the environment-specific dotfile so the same values feed the build and
# the Cloud Run service. Production reads .env.production.local (prod Supabase /
# Resend / BoldSign values); any other env reads .env.local (sandbox). Keyed on
# the caller-provided DEPLOY_APP_ENV so a prod deploy never sources sandbox creds.
ENV_FILE=".env.local"
if [ "${DEPLOY_APP_ENV:-production}" = "production" ]; then
    ENV_FILE=".env.production.local"
fi
if [ -f "${ENV_FILE}" ]; then
    echo "📄 Loading environment variables from ${ENV_FILE}..."
    set -a
    # shellcheck disable=SC1091
    source "${ENV_FILE}"
    set +a
else
    echo "⚠️  No ${ENV_FILE} file found. Falling back to current shell env."
fi

# PROJECT_ID is environment-keyed below (after DEPLOY_APP_ENV is known), just
# like SERVICE_NAME / the DB secret: production ships to its own business-owned
# GCP project so a stage deploy can never touch prod. Override with GCP_PROJECT_ID.
PROJECT_ID="${GCP_PROJECT_ID:-}"
# Default to us-east4 — canonical prod Cloud Run lives there (the custom domain
# eventpro.salesability.ca domain-maps to us-east4). The old northamerica-northeast1
# default silently shipped to an orphaned Montreal service the domain ignores.
REGION="${GCP_REGION:-us-east4}"
SERVICE_ROLE_SECRET_NAME="${GCP_SERVICE_ROLE_SECRET:-supabase-service-role-key}"
IMAGE_TAG="$(date -u +%Y%m%d-%H%M%S)"
# SERVICE_NAME, IMAGE, PROD_SITE_URL, DB_SECRET_NAME are all keyed on
# DEPLOY_APP_ENV below (each overridable via its GCP_*/PROD_SITE_URL env var) so
# stage and prod are separate Cloud Run services.
SERVICE_NAME="${GCP_SERVICE_NAME:-}"
DB_SECRET_NAME="${GCP_DATABASE_URL_SECRET:-}"
PROD_SITE_URL="${PROD_SITE_URL:-}"

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

# Project is environment-keyed (2026-06-03): production ships to its own
# business-owned GCP project (eventpro-498313); any other env goes to the
# 'eventpro-stage' project (stage; repointed from the old 'nnwweb' developer
# project 2026-06-08, commit e695f4e), so a stage deploy can never touch prod and
# vice versa. One script, one knob (DEPLOY_APP_ENV) drives project + service +
# URL + DB secret. Override the project with GCP_PROJECT_ID.
if [ -z "${PROJECT_ID}" ]; then
    if [ "${DEPLOY_APP_ENV}" = "production" ]; then
        PROJECT_ID="eventpro-498313"
    else
        PROJECT_ID="eventpro-stage"
    fi
fi

# Service + public URL are environment-keyed (2026-06-02): a `production` deploy
# targets the `event-manager-pro` service (the canonical prod URL); any other
# env deploys to a SEPARATE service `event-manager-pro-<env>` (its own URL), so
# stage and prod run side by side and a deploy to one never overwrites the
# other. Override the service with GCP_SERVICE_NAME, the URL with PROD_SITE_URL.
if [ -z "${SERVICE_NAME}" ]; then
    if [ "${DEPLOY_APP_ENV}" = "production" ]; then
        SERVICE_NAME="event-manager-pro"
    else
        SERVICE_NAME="event-manager-pro-${DEPLOY_APP_ENV}"
    fi
fi
IMAGE="gcr.io/${PROJECT_ID}/${SERVICE_NAME}:${IMAGE_TAG}"
# Cloud Run's legacy URL hash (7435lagfjq-nn) is stable per project+region, so a
# service's URL is just its name slotted into the same pattern. Server actions
# use this for OAuth/magic-link redirects — it must match the live service.
if [ -z "${PROD_SITE_URL}" ]; then
    PROD_SITE_URL="https://${SERVICE_NAME}-7435lagfjq-nn.a.run.app"
fi

# Database secret is environment-keyed (2026-06-02): a `production` deploy reads
# DATABASE_URL from the GCP-managed `database-url-production` secret; any other
# env uses `database-url` (stage). The prod secret's value is NEVER seeded from
# .env.local — you manage it directly in Secret Manager so the prod connection
# string never lives in the repo/dotfiles. Override either with
# GCP_DATABASE_URL_SECRET. (See docs/wiki/go-live-accounts.md.)
if [ -z "${DB_SECRET_NAME}" ]; then
    if [ "${DEPLOY_APP_ENV}" = "production" ]; then
        DB_SECRET_NAME="database-url-production"
    else
        DB_SECRET_NAME="database-url"
    fi
fi

# Deploy-target banner — the operator's "which env am I shipping?" confirmation.
# A bare `./deploy.sh` defaults to PRODUCTION (real Resend sends + non-sandbox
# BoldSign + the prod DB), so the banner is loud for prod. Ctrl-C now if wrong.
echo "────────────────────────────────────────────────────────────────"
echo "🌍 DEPLOY TARGET"
echo "   env (APP_ENV) : ${DEPLOY_APP_ENV}"
echo "   project       : ${PROJECT_ID}"
echo "   service       : ${SERVICE_NAME}"
echo "   url           : ${PROD_SITE_URL}"
echo "   DB secret     : ${DB_SECRET_NAME}"
if [ "${DEPLOY_APP_ENV}" = "production" ]; then
    echo "   ⚠️  PRODUCTION — real customer emails + production-tier BoldSign + prod DB."
fi
echo "────────────────────────────────────────────────────────────────"

# Production safety gate: a prod build requires an explicit typed confirmation.
# Fails closed — a non-interactive prod deploy (no TTY) must pass
# DEPLOY_CONFIRM=production, otherwise it's refused rather than shipped silently.
if [ "${DEPLOY_APP_ENV}" = "production" ] && [ "${DEPLOY_CONFIRM:-}" != "production" ]; then
    if [ -t 0 ]; then
        printf "Type 'production' to deploy to PROD (anything else aborts): "
        read -r CONFIRM_REPLY
        if [ "${CONFIRM_REPLY}" != "production" ]; then
            echo "❌ Aborted — confirmation did not match 'production'."
            exit 1
        fi
    else
        echo "❌ Production deploy needs confirmation. Re-run with DEPLOY_CONFIRM=production (non-interactive)."
        exit 1
    fi
fi

# Runtime + build vars actually used by the app code (see src/ usages).
# DATABASE_URL is server-only; NEXT_PUBLIC_* must be present at build time
# because Next.js inlines them into the client bundle.
REQUIRED_VARS=(
    "NEXT_PUBLIC_SUPABASE_URL"
    "NEXT_PUBLIC_SUPABASE_ANON_KEY"
    "SUPABASE_SERVICE_ROLE_KEY"
    "MSA_TEMPLATE_VERSION"
    "BOLDSIGN_API_KEY"
    "BOLDSIGN_WEBHOOK_SECRET"
    "GCS_BUCKET"
    "RESEND_API_KEY"
    "RESEND_FROM_EMAIL"
)
# DATABASE_URL is only needed in the env when the stage 'database-url' secret is
# auto-seeded from it. For an externally-managed secret (prod's
# database-url-production), the runtime URL comes from Secret Manager, so it
# doesn't need to live in the dotfile.
if [ "${DB_SECRET_NAME}" = "database-url" ]; then
    REQUIRED_VARS+=("DATABASE_URL")
fi
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

# DB secret. Only the stage `database-url` secret is auto-seeded from
# .env.local; ANY other secret (the prod `database-url-production`, or a custom
# GCP_DATABASE_URL_SECRET override) is externally managed — require it to exist
# and NEVER seed it from .env.local (which holds the stage URL). Keying on the
# secret name (not DEPLOY_APP_ENV) keeps the override case safe.
if [ "${DB_SECRET_NAME}" = "database-url" ]; then
    ensure_secret "${DB_SECRET_NAME}" "DATABASE_URL"
else
    echo "🔐 DB secret '${DB_SECRET_NAME}' is externally managed (value untouched)."
    if ! gcloud secrets describe "${DB_SECRET_NAME}" --project="${PROJECT_ID}" >/dev/null 2>&1; then
        echo "❌ DB secret '${DB_SECRET_NAME}' not found in Secret Manager."
        echo "   Create it once (the connection string stays out of the repo):"
        echo "     printf '%s' 'postgresql://...SESSION-POOLER:5432/postgres' \\"
        echo "       | gcloud secrets create ${DB_SECRET_NAME} --project=${PROJECT_ID} --replication-policy=automatic --data-file=-"
        echo "   FIRST apply all migrations to that DB (set DATABASE_URL=<that-db>; pnpm db:migrate)."
        exit 1
    fi
fi
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

# QuickBooks secrets (chunk 0068/0069) are OPTIONAL — mounted only when they
# exist in the target project. Prod (eventpro-498313) carries
# quickbooks-client-id / -client-secret / -token-enc-key; stage may not. When
# absent, qboConfigured() is false and /admin/quickbooks renders the
# "credentials not set" hint (no crash). When present, QBO_ENV (below) must match
# the Intuit key tier: a sandbox-tier key against QBO_ENV=production 401s.
QBO_SECRET_MOUNTS=""
if gcloud secrets describe quickbooks-client-id --project="${PROJECT_ID}" >/dev/null 2>&1; then
    echo "🔐 QuickBooks secrets present in ${PROJECT_ID} — wiring QBO_CLIENT_ID/SECRET/TOKEN_ENC_KEY (QBO_ENV=${QBO_ENV:-production})."
    grant_secret_access "quickbooks-client-id"
    grant_secret_access "quickbooks-client-secret"
    grant_secret_access "quickbooks-token-enc-key"
    QBO_SECRET_MOUNTS=",QBO_CLIENT_ID=quickbooks-client-id:latest,QBO_CLIENT_SECRET=quickbooks-client-secret:latest,QBO_TOKEN_ENC_KEY=quickbooks-token-enc-key:latest"
else
    echo "ℹ️  QuickBooks secrets not found in ${PROJECT_ID} — /admin/quickbooks ships dormant."
fi

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
# QBO_ENV picks the Intuit API host + expected key tier (sandbox vs production).
# Only baked when the QBO secrets are mounted; defaults to production (the prod
# project is where these secrets live). Override with QBO_ENV=sandbox.
if [ -n "${QBO_SECRET_MOUNTS}" ]; then
    ENV_VARS+="${ENV_DELIM}QBO_ENV=${QBO_ENV:-production}"
fi

# Google Calendar projection (chunk 0077) — non-secret config; auth is KEYLESS
# (no key/secret): the prod runtime SA holds roles/iam.serviceAccountTokenCreator
# on the eventpro-calendar SA, so it signs the DWD assertion at runtime. PRODUCTION
# ONLY: the SA + the EventPro calendar live in the prod project (eventpro-498313)
# and only prod's runtime SA has that grant — setting these on stage would just
# mark every campaign sync 'failed' (signJwt denied). With these set, prod projects
# booked campaigns into Google Calendar; sendUpdates is gated on APP_ENV so prod
# (APP_ENV=production) emails real guest invites. The calendar's dealer-visible
# display name is "EventPro" (owner's chosen brand). Ideally shared read-only to
# staff for the overlay first, but that doesn't gate the guest-invite projection.
if [ "${DEPLOY_APP_ENV}" = "production" ]; then
    ENV_VARS+="${ENV_DELIM}GOOGLE_CALENDAR_SA_EMAIL=eventpro-calendar@eventpro-498313.iam.gserviceaccount.com"
    ENV_VARS+="${ENV_DELIM}GOOGLE_CALENDAR_ID=c_eb45f29a4477f0e879861e24e1cdfaeed04ad140a1f5172919e22b82a57943c5@group.calendar.google.com"
    ENV_VARS+="${ENV_DELIM}GOOGLE_CALENDAR_SUBJECT=shannon@salesability.ca"
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
    --set-secrets="DATABASE_URL=${DB_SECRET_NAME}:latest,SUPABASE_SERVICE_ROLE_KEY=${SERVICE_ROLE_SECRET_NAME}:latest,BOLDSIGN_API_KEY=boldsign-api-key:latest,BOLDSIGN_WEBHOOK_SECRET=boldsign-webhook-secret:latest,RESEND_API_KEY=resend-api-key:latest${QBO_SECRET_MOUNTS}"

echo "✅ Deployment complete."
echo "🌐 Service URL:"
gcloud run services describe "${SERVICE_NAME}" \
    --region="${REGION}" \
    --project="${PROJECT_ID}" \
    --format="value(status.url)"
