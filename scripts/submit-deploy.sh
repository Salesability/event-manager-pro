#!/usr/bin/env bash
# Local-first path for chunk 0095: run the keyless CI pipeline via
# `gcloud builds submit`, WITHOUT a GitHub trigger. Validates the exact pipeline
# each branch trigger will later run. The build (incl. the Cloud Run deploy step)
# runs server-side as the target project's Compute SA; only the submit needs
# local auth.
#
# One knob, DEPLOY_APP_ENV (mirrors deploy.sh):
#   production (default) → eventpro-498313 / event-manager-pro         / cloudbuild.deploy.yaml       / .env.production.local
#   sandbox              → eventpro-stage  / event-manager-pro-sandbox / cloudbuild.deploy.stage.yaml / .env.local
#
# Prereq (one time per project): `gcloud auth login`, and that project's Compute
# SA must have roles/run.admin + roles/iam.serviceAccountUser (on itself) — see
# docs/chunks/0095-keyless-ci-deploy/plan.md.
#
# Usage:
#   DEPLOY_CONFIRM=production ./scripts/submit-deploy.sh    # prod
#   DEPLOY_APP_ENV=sandbox    ./scripts/submit-deploy.sh    # stage
set -euo pipefail

DEPLOY_APP_ENV="${DEPLOY_APP_ENV:-production}"
IMAGE_TAG="$(date -u +%Y%m%d-%H%M%S)"

if [ "${DEPLOY_APP_ENV}" = "production" ]; then
  PROJECT_ID="${GCP_PROJECT_ID:-eventpro-498313}"
  CONFIG="cloudbuild.deploy.yaml"
  ENV_FILE="${ENV_FILE:-.env.production.local}"
else
  PROJECT_ID="${GCP_PROJECT_ID:-eventpro-stage}"
  CONFIG="cloudbuild.deploy.stage.yaml"
  ENV_FILE="${ENV_FILE:-.env.local}"
fi

[ -f "${ENV_FILE}" ] || { echo "❌ ${ENV_FILE} not found (non-secret build/runtime config)." >&2; exit 1; }
[ -f "${CONFIG}" ]   || { echo "❌ ${CONFIG} not found." >&2; exit 1; }
# Source the dotfile for NON-secret substitutions only; the real secrets stay in
# Secret Manager and are mounted by the deploy step.
set -a; # shellcheck disable=SC1090
. "./${ENV_FILE}"; set +a

echo "────────────────────────────────────────────────────────────────"
echo "🌍 SUBMIT-DEPLOY (local → Cloud Build → ${DEPLOY_APP_ENV})"
echo "   project    : ${PROJECT_ID}"
echo "   config     : ${CONFIG}"
echo "   image tag  : ${IMAGE_TAG}"
[ "${DEPLOY_APP_ENV}" = "production" ] && \
  echo "   ⚠️  PRODUCTION — real customer emails + prod DB + prod BoldSign."
echo "────────────────────────────────────────────────────────────────"

# Prod-only safety gate (mirrors deploy.sh): fail-closed when non-interactive.
if [ "${DEPLOY_APP_ENV}" = "production" ] && [ "${DEPLOY_CONFIRM:-}" != "production" ]; then
  if [ -t 0 ]; then
    printf "Type 'production' to submit the PROD deploy (anything else aborts): "
    read -r reply; [ "${reply}" = "production" ] || { echo "❌ Aborted."; exit 1; }
  else
    echo "❌ Needs confirmation. Re-run with DEPLOY_CONFIRM=production." >&2; exit 1
  fi
fi

# NON-secret substitutions only (secrets are mounted from Secret Manager).
SUBS="_IMAGE_TAG=${IMAGE_TAG}"
SUBS+=",_NEXT_PUBLIC_SUPABASE_URL=${NEXT_PUBLIC_SUPABASE_URL}"
SUBS+=",_NEXT_PUBLIC_SUPABASE_ANON_KEY=${NEXT_PUBLIC_SUPABASE_ANON_KEY}"
SUBS+=",_MSA_TEMPLATE_VERSION=${MSA_TEMPLATE_VERSION}"
SUBS+=",_GCS_BUCKET=${GCS_BUCKET}"
SUBS+=",_GCS_PROJECT_ID=${GCS_PROJECT_ID:-}"
SUBS+=",_RESEND_FROM_EMAIL=${RESEND_FROM_EMAIL}"
# Stage needs the mail-redirect target; prod's config has no such substitution.
if [ "${DEPLOY_APP_ENV}" != "production" ]; then
  SUBS+=",_EMAIL_DEV_TO=${EMAIL_DEV_TO:-}"
fi

# Pin the build identity to the target project's Compute SA (the one granted
# run.admin + serviceAccountUser). Both projects also have the legacy @cloudbuild
# SA, so specifying it removes the guesswork and matches the future trigger.
PROJECT_NUMBER="$(gcloud projects describe "${PROJECT_ID}" --format='value(projectNumber)')"
BUILD_SA="${GCP_BUILD_SA:-projects/${PROJECT_ID}/serviceAccounts/${PROJECT_NUMBER}-compute@developer.gserviceaccount.com}"

echo "🏗️  Submitting build (gate → build → push → deploy) as ${BUILD_SA##*/}..."
exec gcloud builds submit \
  --config "${CONFIG}" \
  --project="${PROJECT_ID}" \
  --service-account="${BUILD_SA}" \
  --substitutions="${SUBS}" \
  .
