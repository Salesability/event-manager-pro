# Action-gate ESLint rule (catch `'use server'` functions missing auth gates)

**Started:** 2026-05-08

## Progress Tracker

| Phase | Status | Commit |
|-------|--------|--------|
| 1: Custom ESLint rule + AST traversal | Done | ce40ece |
| 2: Wire into eslint config + opt-out comment convention + CI verification | Done | ce40ece |
| 3: Sweep existing actions + close | Done | ce40ece |

This chunk closes the highest-impact authz failure mode: a new Server Action ships with no gate. The mistake costs nothing today (caught only by careful review) and the blast radius is full privilege escalation. The fix is small: a custom ESLint rule that walks every exported `async function` in any file with `'use server'` (top-level directive or inline) and asserts the body contains a call to a known allow-listed gate (`assertCan`, `requireRole`, `requireStaffAccess`, plus `next-safe-action`'s middleware shape once 0033 lands). Files can opt out per-function with an explicit `// authz: public` comment that the rule reads — but the *default* must be reject. **Done = the rule fires red on every gate-missing action in CI; the existing surface passes; an `// authz: public` opt-out exists for the legitimate exceptions (auth flow itself).**

## Code Anchors

| New code | Anchor (`path:line`) | Why this anchor |
|----------|---------------------|-----------------|
| `eslint-plugin-action-gate/` (or single rule under `.eslintrc`-relative path) — custom rule + AST visitor | `eslint.config.mjs` (existing flat-config setup) | Same file shape as existing custom plugin entries, same module-resolution surface. Decide single-rule-in-config vs separate plugin in Phase 1. |
| Test fixtures — known-good (gated) and known-bad (ungated) `.tsx`/`.ts` files | (none — net-new) | Fixtures live alongside the rule; mirror the shape of any existing custom-rule tests. If none exist, file as carry-forward. |

**Conventions referenced:**
- `docs/wiki/auth.md` § "Per-action gate matrix" — the canonical list of what gates exist; the lint rule's allow-list reads from this.
- `CLAUDE.md` → "Mutations go through Server Actions, not route handlers" — Route Handlers under `(app)/*` need the same rule (different file shape, same auth requirement).

**Overall Progress:** 100% (3/3 phases complete)

**Note:**
- This is a **CI tooling chunk**, not a feature. No runtime change; gain is "missing-gate becomes uncompilable / unmergeable."
- Forward-compatible with 0033 (next-safe-action): the allow-list adds the safe-action middleware shape so the rule survives the migration. During co-existence, both shapes pass.
- Each phase ends with `pnpm tsc --noEmit && pnpm lint && pnpm test --run` clean.

## Open Questions

1. **Single-rule-in-config vs standalone plugin?**
   - *Working assumption:* inline rule in `eslint.config.mjs` for v1 (single-developer team, no need for plugin packaging). Refactor to a plugin if a second project adopts.
2. **What counts as a gate call?**
   - *Working assumption:* allow-list is `assertCan`, `requireRole`, `requireStaffAccess`, plus the safe-action middleware-action shape (`adminClient.action(...)`, `capabilityClient(...).action(...)`). Add `// authz: public` line comment as the only opt-out path.
3. **Does the rule check Route Handlers (`route.ts`)?**
   - *Working assumption:* yes — same rule, different file selector. Route Handlers are POST/GET endpoints with the same auth requirements.
4. **Should the rule warn on the *position* of the gate (e.g. require it as line 1)?**
   - *Working assumption:* no — only require *presence*. Position is style; presence is correctness. Position can be a separate prefer-pattern rule later.

## Phase Checklist

### Phase 1: Custom ESLint rule + AST traversal

- [x] Read existing `eslint.config.mjs` to understand current rule shape.
- [x] Write the rule: visitor that checks every `ExportNamedDeclaration` whose declaration is an `async FunctionDeclaration`, in files with `'use server'` directive (top-of-file) or inline (function-body opening statement). For each such function, walk the body for any `CallExpression` matching the allow-list. If none found and no `// authz: public` line comment precedes the function, report.
- [x] Add fixtures: (a) gated action passes; (b) ungated action fails; (c) opt-out comment passes; ~~(d) safe-action middleware shape passes~~ — deferred to 0033 when the safe-action shape actually lands. Allow-list is configurable, so 0033 wires the additional gate names without touching the rule.
- [x] Unit-test the rule against the fixtures (vitest with ESLint `Linter` + parser-agnostic JS fixtures).
- [x] `pnpm tsc --noEmit && pnpm lint && pnpm test --run` clean (existing surface should pass — every gated action today calls one of the allow-listed helpers).

### Phase 2: Wire into config + opt-out comment convention + CI verification

- [x] Register the rule in `eslint.config.mjs` for the right glob: `src/features/**/actions.ts`, `src/app/**/route.ts`. Two file blocks — Server Actions + Route Handlers (the latter with `routeHandler: true`).
- [x] Add `// authz: public` to the auth-flow Server Actions (`signInWithMagicLink`, `signInWithGoogle`, `signOut`) and to `src/app/auth/callback/route.ts` GET — the four legitimate ungated exceptions (login flow + OAuth-code exchange).
- [x] Run `pnpm lint` against the full codebase. Clean (only the 4 pre-existing warnings — no errors).
- [x] Deliberate-removal smoke: temporarily replaced `assertCan('email:send')` in `requireSenderEmail` — rule fired on all 3 callers (transitive wrapper detection). Restored.
- [x] CI integration: `pnpm build` runs Next.js's built-in ESLint pass (default-on in Next 16) and the Dockerfile in `cloudbuild.yaml` calls `pnpm build`, so a rule violation fails the cloudbuild image build. `pnpm lint` is also the developer-terminal gate. ~~No GH Actions workflow exists; carry-forward~~ — workflow not in scope for this chunk.

### Phase 3: Sweep existing actions + close

- [x] Cross-walk against `auth.md` § "Per-action gate matrix" — every action listed there passes the rule (verified by `pnpm lint` → 0 errors against the existing `src/features/{people,schedule,email}/actions.ts` and the two protected `route.ts` handlers).
- [x] Updated `docs/wiki/auth.md` § "Capability matrix" with a "Structural enforcement of the matrix" subsection — calls out the rule + the 0031/0032/0034 layering.
- [x] Appended a `wiki/log.md` entry for the chunk (top of file).
- [x] Smoke: `pnpm lint` clean (only the 4 pre-existing warnings).
- [x] Smoke: throwaway `src/features/throwaway/actions.ts` with an ungated `'use server'` export — rule fired red ("Server Action 'thisShouldFireRed' has no auth gate"). Removed.
- [x] `pnpm tsc --noEmit && pnpm lint && pnpm test --run` clean (255/255 vitest, was 239 pre-0031 — added 16 tests for the rule).
