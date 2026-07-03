# 0095 — Keyless CI deploy — Plan

**Intent:** [`intent.md`](intent.md)
**Started:** 2026-07-03

Move prod deploys off the laptop into a Cloud Build **GitHub trigger** so no
`gcloud auth login` / SA key is ever needed. Pipeline config authored
(`cloudbuild.deploy.yaml`); the rest is a **one-time bootstrap** that needs the
owner's GitHub-org-admin + a single interactive gcloud auth.

## Progress Tracker

| Phase | Status | Notes |
|-------|--------|-------|
| 1: Pipeline config (`cloudbuild.deploy.yaml`) | Done | gate → build → deploy; parametrized; secrets stay in SM |
| 2: One-time bootstrap (auth + GitHub connect + IAM + trigger) | **Blocked on owner** | needs `gcloud auth login` + GitHub org admin |
| 3: First-run validation (push → build → deploy → smoke) | Pending | first push to `main` is the real test (deploys prod) |

## Code Anchors

- `cloudbuild.deploy.yaml` — the trigger's build config (this chunk). Mirrors
  `deploy.sh`'s `gcloud run deploy` env-vars + `--set-secrets`.
- `deploy.sh` — the local fallback; its deploy section is the source of truth for
  the env-var / secret set the pipeline must match.
- `cloudbuild.yaml` — build-only; still used by `deploy.sh`. **Left untouched.**
- `Dockerfile` — `node:22-alpine`; `pnpm build` (next build) gates tsc + eslint.

## One-time bootstrap runbook

Run once, in order. After this, deploys are just `git push origin main`.

**0. Re-auth once** (only needed for the bootstrap gcloud calls below; the trigger
itself is keyless afterward):
```
gcloud auth login
```

**1. Sync GitHub** — local `main` is ~244 commits ahead of `origin/main` (we've been
deploying from the working tree, not GitHub). The trigger deploys what's on GitHub,
so push first:
```
git push origin main
```

**2. Connect the repo to Cloud Build (2nd-gen)** — Console → Cloud Build →
Repositories → **Connect repository** → **GitHub (Cloud Build GitHub App)** →
install the app on the **EventPro2026** org (needs GitHub org admin) → select
**event-manager-pro**. Region **us-east4**. (CLI equivalent:
`gcloud builds connections create github …` + `gcloud builds repositories create …`.)

**3. Grant the trigger's service account deploy perms** — decide the SA at trigger
creation (a dedicated `ci-deployer@eventpro-498313…` is cleaner than the default
Compute SA). Minimal roles:
```
# act-as the Cloud Run runtime SA
gcloud iam service-accounts add-iam-policy-binding \
  1094204863648-compute@developer.gserviceaccount.com \
  --project=eventpro-498313 \
  --member="serviceAccount:<CI_SA>" \
  --role=roles/iam.serviceAccountUser
# deploy Cloud Run + read secrets for --set-secrets validation + write build logs
for R in roles/run.admin roles/secretmanager.secretAccessor roles/logging.logWriter roles/artifactregistry.writer; do
  gcloud projects add-iam-policy-binding eventpro-498313 \
    --member="serviceAccount:<CI_SA>" --role="$R" --condition=None --quiet
done
```

**4. Create the push-to-main trigger** — substitution values come from
`.env.production.local` (public/non-secret). One way to build the flags:
```
set -a; . ./.env.production.local; set +a
gcloud builds triggers create github \
  --name=deploy-prod-on-main \
  --region=us-east4 --project=eventpro-498313 \
  --repository="projects/eventpro-498313/locations/us-east4/connections/<CONN>/repositories/event-manager-pro" \
  --branch-pattern='^main$' \
  --build-config=cloudbuild.deploy.yaml \
  --service-account="projects/eventpro-498313/serviceAccounts/<CI_SA>" \
  --substitutions="_NEXT_PUBLIC_SUPABASE_URL=${NEXT_PUBLIC_SUPABASE_URL},_NEXT_PUBLIC_SUPABASE_ANON_KEY=${NEXT_PUBLIC_SUPABASE_ANON_KEY},_MSA_TEMPLATE_VERSION=${MSA_TEMPLATE_VERSION},_GCS_BUCKET=${GCS_BUCKET},_GCS_PROJECT_ID=${GCS_PROJECT_ID},_RESEND_FROM_EMAIL=${RESEND_FROM_EMAIL}"
```

**5. Validate (Phase 3)** — push a trivial commit to `main`, watch the build in
Cloud Build, confirm: gate passes → image built → `gcloud run deploy` → new
revision serving → `curl https://eventpro.salesability.ca/login` = 200. The
already-committed **sign-out wrap fix** (`84a8bb6`) rides out on this first push.

## Gotchas / notes

- **allUsers / Domain Restricted Sharing:** `--allow-unauthenticated` needs the
  org exception prod already has; re-applying on an already-public service is
  idempotent. ([[project-prod-gcp]])
- **`--set-secrets` validation:** the deployer (CI SA) needs
  `secretmanager.secretAccessor`, else the deploy 403s validating the mounts.
- **QBO secrets are hardcoded-mounted** (prod has all three). If ever absent the
  deploy fails — prod-only pipeline, acceptable.
- **First-run gate risk:** unit tests run in a bare `node:22-alpine`; if one needs
  runtime env to import, the gate fails — narrow the vitest scope then.
- **Rollback:** `gcloud run services update-traffic event-manager-pro
  --region=us-east4 --to-revisions=<prev>=100` (still the escape hatch).
