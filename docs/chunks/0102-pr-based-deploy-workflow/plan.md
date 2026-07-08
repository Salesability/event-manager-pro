# Move to a PR-based deploy workflow — Plan

**Intent:** [`intent.md`](intent.md)
**Started:** 2026-07-08

## Progress Tracker

| Phase | Status | Commit |
|-------|--------|--------|
| 1: Baseline audit + remote reconciliation (decision) | Pending | - |
| 2: PR-time test-gate check | Pending | - |
| 3: Branch protection on `main` (+ `dev`) | Pending | - |
| 4: Promotion runbook — migration gate + hotfix path | Pending | - |
| 5: End-to-end dry-run + close | Pending | - |

Move from main-trunk (commit to `main`, backport to `dev` for stage) to dev-trunk (PR into `dev` → stage, promote `dev`→`main` → prod). The two Cloud Build triggers already map correctly (`dev`→stage, `main`→prod) and a PR-merge *is* a push — so this is guardrails + process, not a trigger rebuild. "Done" = `main`/`dev` protected, a required PR test check blocks red merges, the remotes reconciled to a known baseline, and a wiki runbook covers promotion + the prod-migration gate + hotfixes.

## Code Anchors

For a modification to an existing file, the anchor is the nearest sibling in that same file.

| New code | Anchor (`path:line`) | Why this anchor |
|----------|---------------------|-----------------|
| PR test-gate check — `.github/workflows/pr-check.yml` **or** `cloudbuild.pr.yaml` (Phase-2 decision) | `cloudbuild.deploy.stage.yaml:40-51` (the `test-gate` step: `pnpm exec vitest run --exclude 'tests/integration/**'` on `node:22-alpine`) | The PR gate must run the SAME unit suite the deploy gate runs — reuse the exact command, exclusion, and base image so PR-time and deploy-time agree |
| Deploy-workflow runbook — `docs/wiki/deploy-workflow.md` (new) | `docs/wiki/go-live-accounts.md` (numbered ops sections, "two rules before you start", owner-action callouts, hand-back checklist) | Same doc shape: an operational runbook with numbered steps + explicit owner-vs-developer callouts. Link it from `docs/wiki/index.md` |
| Cloudbuild header-comment corrections | `cloudbuild.deploy.yaml:9-16` (the "push to main = prod drops deploy.sh's typed confirm" safety rationale) | That premise changes under PR flow (`main` is reached only via a protected `dev`→`main` promotion) — edit the rationale in place; mirror in `cloudbuild.deploy.stage.yaml` |
| Trigger + branch-protection settings (EXTERNAL — GitHub org + GCP console; documented, not code) | `docs/chunks/closed/0095-keyless-ci-deploy/plan.md` (how the triggers, `github-salesability` connection, and Compute-SA grants were wired) | 0095 is the source of truth for the trigger/connection wiring; protection + a PR check layer on top of it |

**Conventions referenced:**
- Deploy model + trigger→branch mapping: [`docs/wiki/go-live-accounts.md`](../../wiki/go-live-accounts.md) + [0095](../closed/0095-keyless-ci-deploy/plan.md). `main`→prod (`eventpro-498313`), `dev`→stage (`eventpro-stage`). Org blocks SA keys (`iam.disableServiceAccountKeyCreation`) + `allUsers` grants — keep everything keyless.
- **Migrations are NOT run by CI** — apply to the DB *before* the code deploys, on the session pooler (5432), prod DB separately via `scripts/with-prod-db.sh` / `pnpm db:migrate:prod` (CLAUDE.md → Deploys).
- Commit format: `type(scope): message`, subject-only, no Claude/AI mention (CLAUDE.md → Git Workflow).

**Overall Progress:** 0% (0/5 phases complete)

**Note:**
- **No app code, no migration, no new secret.** Artifacts are: one CI workflow/config, one wiki runbook, cloudbuild comment edits, GitHub/GCP console settings, and a one-time git remote reconciliation.
- **Heavily owner-driven.** Branch protection (GitHub org settings) and Cloud Build trigger settings live in consoles Claude can't fully drive — Phases 3 (and parts of 1/5) are **owner-action** steps this plan *specifies and verifies*, not autonomous edits. `/build` will pause at those gates.
- **Verification is process, not UI.** No web-test surface — the gate is a dry-run PR + observed builds, plus `gh api` reads of the protection settings. This is a `Verification (process)` chunk, not a browser-smoke chunk.

### Phase Checklist

#### Phase 1: Baseline audit + remote reconciliation (decision)
- [ ] Record the current trigger config verbatim: `gh api` / GCP console — confirm the `main`→prod (`eventpro-498313`) and `dev`→stage (`eventpro-stage`) triggers, their event type (push-to-branch), and that a PR-merge into each branch fires the existing push trigger (no trigger change needed). Capture in `decision.md`.
- [ ] Audit the remote divergence: `git rev-list --left-right --count origin/main...main` (currently `0 28`) and `origin/dev...dev`; determine which Cloud Run revision prod/stage are actually serving vs what `origin/main`/`origin/dev` point at.
- [ ] **Owner decision (D1):** the reconciliation baseline — fast-forward `origin/main` to local `main` (a one-time "catch prod up", which *would* trigger a prod deploy of the 28-commit backlog), **or** re-point remotes to the last-deployed revision and flow the backlog through the new PR pipeline. Needs the owner's call on what prod should reflect now. Record in `decision.md`.
- [ ] **Owner decision (D2):** protect `dev` strictly (PR-only) or leave `dev` push-able and hard-protect only `main`. Record.
- [ ] **Owner decision (D3):** PR-check mechanism — GitHub Actions vs Cloud Build PR trigger; and scope (unit only vs unit+tsc+lint). Record with rationale.
- [ ] Write `decision.md` (D1–D3 + the audit snapshot) — this is the anchor the later phases execute against.

#### Phase 2: PR-time test-gate check
- [ ] Implement the PR check per D3, mirroring `cloudbuild.deploy.stage.yaml:40-51`'s vitest command (unit suite, `--exclude 'tests/integration/**'`); add `tsc --noEmit` + `lint` if D3 chose the fuller gate. Target: PRs into `dev` (and `main`).
- [ ] Name the check so it can be marked **required** in branch protection (Phase 3 references this exact check name).
- [ ] Prove it runs: open a throwaway PR with a deliberately-failing unit test → the check goes red → confirm it would block merge; then a passing PR → green. Delete the throwaway.
- [ ] Confirm the PR check **deploys nothing** (it's a gate, not a deploy trigger) — no Cloud Run revision, no image push.

#### Phase 3: Branch protection on `main` (+ `dev`) — owner action
- [ ] **Owner (GitHub → Salesability/event-manager-pro → Settings → Branches):** protect `main` — require a PR before merge, require the Phase-2 status check to pass, dismiss stale approvals, **block force-push + deletion**, no direct pushes. (Solo-owner: "require approvals" may be 0 or self-review — record the choice.)
- [ ] **Owner:** protect `dev` per D2 (PR-required + check, or lighter).
- [ ] Verify via `gh api repos/Salesability/event-manager-pro/branches/main/protection` — required check present, enforce-admins/force-push state as intended. Capture the JSON in `decision.md`.
- [ ] Attempt a direct `git push origin main` from a scratch commit → expect **rejected**. (Then discard.)

#### Phase 4: Promotion runbook — migration gate + hotfix path
- [ ] Write `docs/wiki/deploy-workflow.md` (anchor: `go-live-accounts.md` shape): the full flow — feature branch off `dev` → PR → merge → **stage build** → verify on stage → PR `dev`→`main` → merge → **prod build**.
- [ ] Document the **prod-migration gate** loudly: before merging `dev`→`main`, apply any new migration to the **prod** DB first (`pnpm db:migrate:prod`, session pooler 5432), because CI never runs migrations — a promotion that ships schema-dependent code ahead of the column fails at runtime. Include the stage equivalent (sandbox DB before the `dev` merge). Cross-link the 0100 `0048`-not-on-prod example.
- [ ] Document the **hotfix path** per intent's open question (branch off `main` → PR to `main` → back-merge to `dev`), with the caveat that a `dev`→`main` promotion drags everything on `dev`.
- [ ] Correct the stale cloudbuild header comments (`cloudbuild.deploy.yaml:9-16` + stage sibling): `main` is now reached only via a protected `dev`→`main` promotion, so the "drops deploy.sh's typed confirm" framing is superseded by branch protection + the PR gate.
- [ ] Link the new page from `docs/wiki/index.md`; add a `docs/wiki/log.md` entry (new deploy convention = state-of-system change).

#### Phase 5: End-to-end dry-run + close
- [ ] Execute the D1 reconciliation (owner-gated if it implies a prod deploy).
- [ ] Full dry-run: cut a trivial feature branch → PR into `dev` → check runs + green → merge → confirm a **stage** build fires (Cloud Build history / new stage revision).
- [ ] Promotion dry-run: PR `dev`→`main` → merge → confirm a **prod** build fires. (Sequence with a *real* next promotion if a gratuitous prod deploy is undesirable — record which.)
- [ ] Update `docs/wiki/deploy-workflow.md` with any reality gaps found; final `log.md` note.
- [ ] Close the chunk per CLAUDE.md → "Closing a chunk" (move to `closed/`, sweep refs, update `CURRENT.md`).

**Verification note:** this is a `Verification (process)` chunk — no web-test route. The gates are: `gh api` reads of the branch-protection state, an observed red→green PR check, and observed stage/prod builds from dry-run merges. Owner-action steps (Phases 1 D1, 3, parts of 5) will pause a `/build` loop — they need console access Claude doesn't have.
