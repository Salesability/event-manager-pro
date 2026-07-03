# 0095 — Keyless CI deploy — Plan

**Intent:** [`intent.md`](intent.md)
**Started:** 2026-07-03

Move deploys off the laptop into Cloud Build **GitHub triggers** (keyless) with a
**`dev` → STAGE / `main` → PROD** branch split. Two pipeline configs authored
(`cloudbuild.deploy.yaml` prod + `cloudbuild.deploy.stage.yaml` stage) + an
env-aware `scripts/submit-deploy.sh`; the rest is a **one-time bootstrap** per
project (IAM grant) + the GitHub connection + two triggers.

## Progress Tracker

| Phase | Status | Notes |
|-------|--------|-------|
| 1: Pipeline configs (prod + stage yaml + env-aware `submit-deploy.sh`) | Done | gate → build → **push** → deploy; two explicit configs; secrets stay in SM |
| 2: **PROD local-first validation** (`submit-deploy.sh`) | **✅ Done 2026-07-03** | keyless build+deploy proven → rev `event-manager-pro-00040-gp7`; sign-out fix shipped |
| 3: **STAGE local-first validation** (`DEPLOY_APP_ENV=stage ./scripts/submit-deploy.sh`) | **Next — needs stage Compute-SA IAM grant** | proves the stage pipeline before wiring the `dev` trigger |
| 4: GitHub trigger bootstrap — `dev`→stage + `main`→prod | Pending | connect repo (org admin) + two `triggers create`; removes local submit |
| 5: First-push validation (push `dev`→stage, `main`→prod) | Pending | confirms both triggers end-to-end |

### Phase 3 — stage local-first (do next)

Same as Phase 2 but for stage. Stage lives in **`eventpro-stage`** (project number
`485010152235`), so its Compute SA needs the same two grants (a separate project =
a separate bootstrap). Per-secret `secretAccessor` from a prior `deploy.sh` stage
run already covers `--set-secrets`.

```
# owner runs (same shape as the prod grant):
gcloud projects add-iam-policy-binding eventpro-stage \
  --member="serviceAccount:485010152235-compute@developer.gserviceaccount.com" \
  --role=roles/run.admin --condition=None
gcloud iam service-accounts add-iam-policy-binding \
  485010152235-compute@developer.gserviceaccount.com --project=eventpro-stage \
  --member="serviceAccount:485010152235-compute@developer.gserviceaccount.com" \
  --role=roles/iam.serviceAccountUser
```
Then: `DEPLOY_APP_ENV=stage ./scripts/submit-deploy.sh` → new
`event-manager-pro-sandbox` revision; smoke its `.run.app/login`.

**Phase 2 result (2026-07-03):** `DEPLOY_CONFIRM=production ./scripts/submit-deploy.sh`
built + deployed prod **keyless** (build ran as the Compute SA
`1094204863648-compute@…`, no interactive gcloud in the pipeline). Two fixes found
en route: (a) **submit-safe `_IMAGE_TAG`** (built-in `$SHORT_SHA` is empty for a
manual submit); (b) **explicit `push` step before `deploy`** — the `images:` block
pushes only *after* all steps, so the first run's deploy hit *"Image … not found."*
Removed `images:`. **IAM granted to the Compute SA** (owner ran, 2026-07-03):
`roles/run.admin` (project) + `roles/iam.serviceAccountUser` (on itself; it's also
the runtime SA). Per-secret `secretAccessor` from `deploy.sh` already covered
`--set-secrets`; `--allow-unauthenticated` set the public-invoker IAM with no
org-policy block. Result rev `-00040-gp7` (image `:20260703-172414`); smoke
`/login`=200; BoldSign still `:latest`=v4, `BOLDSIGN_SENDER_EMAIL` absent.

### Phase 2 — local-first (do this first)

Runs the SAME `cloudbuild.deploy.yaml` the trigger will use, but kicked off by
`gcloud builds submit` instead of a git push. The build (incl. the Cloud Run
deploy step) runs server-side as the **Cloud Build service account** — only the
submit needs local auth. Proves the pipeline before we touch GitHub, and ships
the pending sign-out fix (`84a8bb6`).

1. `gcloud auth login` (one interactive login).
2. **Confirm which SA `builds submit` runs as** and grant it deploy perms (the
   Compute SA already has `secretAccessor` on the prod secrets as the runtime SA):
   ```
   CB_SA=1094204863648-compute@developer.gserviceaccount.com   # confirm after auth
   gcloud iam service-accounts add-iam-policy-binding \
     1094204863648-compute@developer.gserviceaccount.com \
     --project=eventpro-498313 --member="serviceAccount:${CB_SA}" \
     --role=roles/iam.serviceAccountUser
   for R in roles/run.admin roles/secretmanager.secretAccessor; do
     gcloud projects add-iam-policy-binding eventpro-498313 \
       --member="serviceAccount:${CB_SA}" --role="$R" --condition=None --quiet
   done
   ```
3. `DEPLOY_CONFIRM=production ./scripts/submit-deploy.sh` → watch gate → build →
   deploy → new revision. Smoke `https://eventpro.salesability.ca/login` = 200.

Once Phase 2 is green, Phase 3 just swaps the trigger *in front of* the same
config — nothing about the build/deploy changes.

## Code Anchors

- `cloudbuild.deploy.yaml` — PROD build config (`main`→prod). Mirrors `deploy.sh`'s
  `gcloud run deploy` env-vars + `--set-secrets`.
- `cloudbuild.deploy.stage.yaml` — STAGE build config (`dev`→stage): `APP_ENV=stage`,
  `database-url` secret, `EMAIL_DEV_TO`, no QBO/Calendar. (Service is named
  `event-manager-pro-sandbox` — a legacy pin; the environment is "stage".)
- `scripts/submit-deploy.sh` — env-aware local wrapper (`DEPLOY_APP_ENV` picks prod
  vs stage: project + config + dotfile + build SA).
- `deploy.sh` — the local fallback; its deploy section is the source of truth for
  the env-var / secret set each pipeline must match.
- `cloudbuild.yaml` — build-only; still used by `deploy.sh`. **Left untouched.**
- `Dockerfile` — `node:22-alpine`; `pnpm build` (next build) gates tsc + eslint.

## Phase 4 — GitHub trigger bootstrap (two triggers)

Run once. After this, deploys are just `git push origin dev` (→ stage) and
`git push origin main` (→ prod). IAM for both Compute SAs is done in Phases 2/3.

**1. Sync GitHub** — local `main` is ~244 commits ahead of `origin/main` (we deploy
from the working tree, not GitHub). Push both branches (`dev` branched off `main`
2026-07-03):
```
git push origin main
git push origin dev
```

**2. Connect the repo to Cloud Build (2nd-gen), one connection per project** —
Console → Cloud Build → Repositories → **Connect repository** → **GitHub App** →
install on the **EventPro2026** org (needs GitHub org admin) → select
`event-manager-pro`. Do this in **both** `eventpro-498313` and `eventpro-stage`
(each project needs its own connection). Region **us-east4**.

**3. Create the two triggers** (values from the matching dotfile):
```
# PROD — main → eventpro-498313
set -a; . ./.env.production.local; set +a
gcloud builds triggers create github --name=deploy-prod-on-main \
  --region=us-east4 --project=eventpro-498313 \
  --repository="projects/eventpro-498313/locations/us-east4/connections/<CONN>/repositories/event-manager-pro" \
  --branch-pattern='^main$' --build-config=cloudbuild.deploy.yaml \
  --service-account="projects/eventpro-498313/serviceAccounts/1094204863648-compute@developer.gserviceaccount.com" \
  --substitutions="_NEXT_PUBLIC_SUPABASE_URL=${NEXT_PUBLIC_SUPABASE_URL},_NEXT_PUBLIC_SUPABASE_ANON_KEY=${NEXT_PUBLIC_SUPABASE_ANON_KEY},_MSA_TEMPLATE_VERSION=${MSA_TEMPLATE_VERSION},_GCS_BUCKET=${GCS_BUCKET},_GCS_PROJECT_ID=${GCS_PROJECT_ID},_RESEND_FROM_EMAIL=${RESEND_FROM_EMAIL}"

# STAGE — dev → eventpro-stage
set -a; . ./.env.local; set +a
gcloud builds triggers create github --name=deploy-stage-on-dev \
  --region=us-east4 --project=eventpro-stage \
  --repository="projects/eventpro-stage/locations/us-east4/connections/<CONN>/repositories/event-manager-pro" \
  --branch-pattern='^dev$' --build-config=cloudbuild.deploy.stage.yaml \
  --service-account="projects/eventpro-stage/serviceAccounts/485010152235-compute@developer.gserviceaccount.com" \
  --substitutions="_NEXT_PUBLIC_SUPABASE_URL=${NEXT_PUBLIC_SUPABASE_URL},_NEXT_PUBLIC_SUPABASE_ANON_KEY=${NEXT_PUBLIC_SUPABASE_ANON_KEY},_MSA_TEMPLATE_VERSION=${MSA_TEMPLATE_VERSION},_GCS_BUCKET=${GCS_BUCKET},_GCS_PROJECT_ID=${GCS_PROJECT_ID},_RESEND_FROM_EMAIL=${RESEND_FROM_EMAIL},_EMAIL_DEV_TO=${EMAIL_DEV_TO}"
```

**4. Validate (Phase 5)** — push a trivial commit to `dev` → stage build+deploy →
smoke the sandbox URL; then merge `dev`→`main` → prod build+deploy → smoke
`eventpro.salesability.ca/login`.

**Promotion flow (steady state):** feature branch → merge to `dev` (auto stage) →
validate → merge `dev`→`main` (auto prod).

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
