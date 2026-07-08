# Move to a PR-based deploy workflow — Intent

**Created:** 2026-07-08

## Problem

Today the repo is **main-trunk**: all chunk work is committed directly to `main`, and `dev` is a downstream "deploy-to-stage" pointer that trails main (you merge `main` → `dev` and push `dev` to get a stage build). The keyless CI from [0095](../closed/0095-keyless-ci-deploy/plan.md) wires `push main → prod`, `push dev → stage`, each gated by a deploy-time unit-test step ([`cloudbuild.deploy.yaml:47-51`](../../../cloudbuild.deploy.yaml), [`cloudbuild.deploy.stage.yaml:40-51`](../../../cloudbuild.deploy.stage.yaml)).

The weakness: **the prod-trigger branch (`main`) accumulates commits *before* they've been stage-verified.** Nothing reaches prod until someone explicitly `git push origin main`, so safety rests entirely on the discipline of not pushing `main` too early. There's no structural guarantee — `main` is not protected, the test gate runs at *deploy* time (post-merge) rather than blocking a bad merge, and there's no written promotion ritual. Right now local `main` is ahead of `origin/main` by 28 commits, which is itself a symptom: the remote branches don't cleanly reflect "what's deployed."

## Desired outcome

The conventional **dev-trunk / promote-to-prod** flow:

1. Feature branches cut from `dev` → **PR into `dev`**. Merging the PR is a push to `dev` → **stage build** (the existing `dev → stage` trigger fires unchanged).
2. When stage is verified, **PR `dev` → `main`**. Merging is a push to `main` → **prod build** (the existing `main → prod` trigger fires unchanged).

The safety this buys: unverified code can't be one `git push` from prod — reaching prod *structurally requires* a promotion merge through a protected branch, and a red test suite blocks the **merge**, not just the deploy.

Crucially, **the trigger→branch mapping does not change** (it's already correct: a PR-merge into `dev` is a push to `dev`; a `dev`→`main` merge is a push to `main`). This chunk is a **process + guardrails** change, not an infra rebuild:

- **Branch protection** on `main` (and `dev`): PR/merge-only, no direct push, no force-push, require the PR check to pass.
- A **PR-time test gate** (a required status check that runs the unit suite on the PR itself) so a red suite blocks the merge.
- A written **promotion runbook** including the **prod-migration gate** (migrations don't auto-run in CI — the sharpest operational risk) and a **hotfix path**.
- A one-time **remote reconciliation** so `origin/main` / `origin/dev` reflect a known-good baseline before protection is switched on.

## Non-goals

- **Not changing the trigger→branch mapping** (`dev`→stage, `main`→prod stays). No new Cloud Build trigger *targets*; at most a new *PR-check* trigger/workflow that deploys nothing.
- **Not automating migrations in CI.** The prod-migration step stays a deliberate manual gate in the promotion checklist (a DDL-against-prod auto-step is out of scope and riskier than the problem it solves).
- **Not retiring `deploy.sh` / `submit-deploy.sh`** — they remain manual fallbacks (0095 decision).
- **Not adopting full git-flow** (release branches, versioned tags). Just dev-trunk + promote.
- **Not a GitHub org-governance change** beyond branch protection (the 0095-a Shannon-as-owner item is separate).

## Success criteria

- `main` is protected: direct pushes rejected, merges only via PR, the PR test check required, force-push disabled. `dev` protected to PR-only as well.
- A PR into `dev` runs the unit suite as a **required check**; a red suite blocks the merge (verified with a deliberately-failing dry-run PR).
- Merging a PR into `dev` produces a **stage** build; merging `dev`→`main` produces a **prod** build — both verified end-to-end (prod half may be verified with a no-op/next-real promotion to avoid a gratuitous prod deploy).
- `origin/main` and `origin/dev` reconciled to a known-good baseline that matches what's actually deployed; the 28-commit divergence resolved.
- A `docs/wiki/` runbook documents: the promotion flow, the **prod-migration-before-promotion** gate, and the hotfix path. The stale "push to main = prod (direct commit)" premise in the cloudbuild header comments is corrected.

## Open questions

- **PR-check mechanism:** a **GitHub Actions** workflow (`.github/workflows/`, none exist today) or a **Cloud Build PR trigger** (`_pr` config, consistent with the existing keyless Cloud Build tooling but needs the Cloud Build GitHub app's PR events)? Leaning GitHub Actions for PR checks (native required-status-check integration, no GCP round-trip, and it deploys nothing) — but decide against the "keep it all in Cloud Build" consistency argument. **Decision phase.**
- **How much does the PR check run?** Unit suite only (mirrors the deploy gate, fast) vs unit + `tsc` + `lint` (the build already gates tsc/eslint, but only *after* merge). Leaning unit + `tsc --noEmit` + `lint` at PR time since that's the cheap, high-value pre-merge signal. Integration excluded (sandbox-pooler flake, per repo convention).
- **Protect `dev` how strictly?** Require a PR for `dev` too (cleanest), or allow direct pushes to `dev` for speed and only hard-protect `main`? Trade-off: strict `dev` = every change is reviewed + stage-tested; loose `dev` = faster iteration but weaker.
- **Remote reconciliation shape:** what is the known-good baseline — does `origin/main` fast-forward to local `main` (a one-time "catch prod up" event, which *would* deploy everything queued), or do we re-point the remotes to the last actually-deployed revision and let the backlog flow through the new PR pipeline? This needs the owner's call on what prod should reflect *right now*.
- **Hotfix policy:** branch off `main` → PR to `main` → back-merge to `dev` (standard), vs. always keep `dev` releasable and never hotfix `main` directly. Pick one and document it.

## Why now

We just hit the friction directly: shipping 0101 to stage required the manual `merge main → dev → push dev` dance, and the conversation surfaced that the branch model is inverted from the safe convention. Moving to PRs is the owner's stated near-term direction ("we will move to using PR in the future"). Doing it now — while the triggers are already correct and only a handful of chunks are in flight — is far cheaper than retrofitting protection onto a busy multi-contributor history later. It also resolves the lurking `origin/main` +28 divergence before it becomes a bigger reconciliation.
