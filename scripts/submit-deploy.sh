#!/usr/bin/env bash
# Local-first path for chunk 0095: run the keyless CI pipeline
# (cloudbuild.deploy.yaml — gate → build → deploy) via `gcloud builds submit`,
# WITHOUT the GitHub trigger. Validates the exact pipeline the trigger will later
# run. The build (incl. the Cloud Run deploy step) runs server-side as the Cloud
# Build service account; the only local auth needed is to submit the build.
#
# Prereq (one time): `gcloud auth login`, and the Cloud Build SA must have
# roles/run.admin + roles/iam.serviceAccountUser (on the runtime SA) +
# roles/secretmanager.secretAccessor (see docs/chunks/0095-keyless-ci-deploy/plan.md).
#
# Usage:  DEPLOY_CONFIRM=production ./scripts/submit-deploy.sh
set -euo pipefail

PROJECT_ID="${GCP_PROJECT_ID:-eventpro-498313}"
ENV_FILE="${ENV_FILE:-.env.production.local}"
IMAGE_TAG="$(date -u +%Y%m%d-%H%M%S)"

if [ ! -f "${ENV_FILE}" ]; then
  echo "❌ ${ENV_FILE} not found — needed for the non-secret build/runtime config." >&2
  exit 1
fi
# Source the dotfile for the NON-secret substitution values (the real secrets stay
# in Secret Manager and are mounted by the deploy step, never passed here).
set -a; # shellcheck disable=SC1090
. "./${ENV_FILE}"; set +a

echo "────────────────────────────────────────────────────────────────"
echo "🌍 SUBMIT-DEPLOY (local → Cloud Build → PROD)"
echo "   project    : ${PROJECT_ID}"
echo "   config     : cloudbuild.deploy.yaml"
echo "   image tag  : ${IMAGE_TAG}"
echo "   ⚠️  PRODUCTION — real customer emails + prod DB + prod BoldSign."
echo "────────────────────────────────────────────────────────────────"

# Prod safety gate (mirrors deploy.sh): fail-closed when non-interactive.
if [ "${DEPLOY_CONFIRM:-}" != "production" ]; then
  if [ -t 0 ]; then
    printf "Type 'production' to submit the PROD deploy (anything else aborts): "
    read -r reply
    [ "${reply}" = "production" ] || { echo "❌ Aborted."; exit 1; }
  else
    echo "❌ Needs confirmation. Re-run with DEPLOY_CONFIRM=production." >&2
    exit 1
  fi
fi

# Only NON-secret values go in --substitutions; secrets are mounted by the deploy
# step from Secret Manager. Missing optionals default in cloudbuild.deploy.yaml.
SUBS="_IMAGE_TAG=${IMAGE_TAG}"
SUBS+=",_NEXT_PUBLIC_SUPABASE_URL=${NEXT_PUBLIC_SUPABASE_URL}"
SUBS+=",_NEXT_PUBLIC_SUPABASE_ANON_KEY=${NEXT_PUBLIC_SUPABASE_ANON_KEY}"
SUBS+=",_MSA_TEMPLATE_VERSION=${MSA_TEMPLATE_VERSION}"
SUBS+=",_GCS_BUCKET=${GCS_BUCKET}"
SUBS+=",_GCS_PROJECT_ID=${GCS_PROJECT_ID:-}"
SUBS+=",_RESEND_FROM_EMAIL=${RESEND_FROM_EMAIL}"

echo "🏗️  Submitting build (gate → build → deploy)..."
exec gcloud builds submit \
  --config cloudbuild.deploy.yaml \
  --project="${PROJECT_ID}" \
  --substitutions="${SUBS}" \
  .
