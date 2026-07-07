# 0095 — Keyless CI deploy (push to main → prod via Cloud Build) — Intent

**Created:** 2026-07-03

## Problem

Deploys run `./deploy.sh` from a laptop, which needs a live `gcloud` session. The
business org enforces **`iam.disableServiceAccountKeyCreation`** org-wide (no SA-key
path) and a **session-control reauth policy**, so `gcloud auth login` lapses (it
did after ~9 days) and a deploy fails mid-flight with *"Reauthentication failed.
cannot prompt during non-interactive execution."* An SA key — the usual fix — is
blocked by policy.

## Desired outcome

Deploys run **server-side in Cloud Build**, triggered by a **push to `main`**, with
**no local gcloud auth and no SA key**. The build's own service account does the
work; `git push` becomes the deploy action.

## Decisions (settled)

- **Branch-per-env split (updated 2026-07-03):** **`dev` → STAGE**
  (`event-manager-pro-sandbox` / `eventpro-stage`), **`main` → PROD**
  (`event-manager-pro` / `eventpro-498313`). Two triggers, one per branch. Gives a
  staging buffer — `main` only gets what's been proven on `dev` — and maps onto the
  existing `DEPLOY_APP_ENV` sandbox/prod split. (Supersedes the earlier
  push-to-main-only design.)
- **Compensating gate:** each pipeline runs the **unit suite before deploy**
  (`test-gate` step). A red commit fails the build and never ships. The image build
  (`next build`) already gates tsc + eslint.
- **Integration tests excluded from the gate** — they hit the sandbox pooler and
  trip the `EMAXCONNSESSION` flake ([[feedback-integration-test-pooler-flake]]).
- **Secrets stay in Secret Manager** (mounted `:latest`); only NON-secret config
  (public Supabase URL/anon key, GCS bucket, Resend from-address, MSA template
  version, stage's `EMAIL_DEV_TO`) moves to **trigger substitutions**.
- **Two explicit configs, not one parametrized** — stage/prod diverge heavily
  (project, service, DB secret, Supabase creds baked at build time, mail redirect,
  sandbox BoldSign, no QBO/Calendar on stage), so `cloudbuild.deploy.yaml` (prod) +
  `cloudbuild.deploy.stage.yaml` (stage) are clearer than hidden conditionals.
- **Per-env images** — `NEXT_PUBLIC_SUPABASE_*` are baked into the client bundle at
  build time and differ per env, so each branch builds its own image (no promotion).
- **deploy.sh stays** as a manual fallback (hotfix when GitHub/Cloud Build is down).

## Non-goals

- Retiring `deploy.sh` / the build-only `cloudbuild.yaml`.
- Changing the runtime SA, secrets, or the Cloud Run service shape.
- Image promotion (dev→prod reuse) — precluded by build-time-baked Supabase creds.

## Success criteria

- A push to `main` builds + deploys prod with zero local auth.
- A commit that breaks a unit test (or types/lint) fails the build → no deploy.
- The deployed revision matches a `./deploy.sh` revision (same env vars + secrets).

## Open questions

- Which SA does the 2nd-gen trigger run as (dedicated vs project Compute SA), and
  the minimal role set (`run.admin` + `iam.serviceAccountUser` on the runtime SA +
  `secretmanager.secretAccessor` for `--set-secrets` validation). Pinned at bootstrap.
- Does any unit test import a module that needs runtime env to load? First trigger
  run validates the bare `node:22-alpine` gate; adjust if so.
