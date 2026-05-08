# Action gate matrix test (catch wrong admit set, not just missing gate)

**Started:** 2026-05-08

## Progress Tracker

| Phase | Status | Commit |
|-------|--------|--------|
| 1: Build the action↔role admit-set matrix data file | Done | 3648eec |
| 2: Test harness — drive each action with each role, assert documented outcome | Done | 3648eec |
| 3: Wire into vitest + close | Done | 3648eec |

The 0031 lint rule catches "no gate at all." This chunk catches "gate is present but wrong admit set" — e.g. an action gated `requireRole(['admin','coach'])` when intent is admin-only, or a capability call site against the wrong capability. The mistake passes review if the reviewer doesn't have the role↔capability matrix loaded. Solution: a matrix file (data) listing every gated action + its expected admit set per role; a single test file that imports each action and drives it against unauth + each role; assertions check the documented outcome (allow / `redirect:/` / `redirect:/login`). Drift between code and matrix → CI fails. **Done = every gated action has a matrix entry; the suite drives all entries; a deliberate code-change that changes admit set fails the suite without matrix update.**

## Code Anchors

| New code | Anchor (`path:line`) | Why this anchor |
|----------|---------------------|-----------------|
| `src/features/__tests__/action-gate-matrix.ts` (data file: action import → expected admit map per role) | (none — net-new pattern) | First instance of this shape in the repo. Inspired by [`src/lib/auth/capabilities.test.ts`](../../src/lib/auth/capabilities.test.ts) ADMIN_ONLY_CAPS table-driven shape, but here the table imports actions rather than calling `can()` directly. |
| `src/features/__tests__/action-gate-matrix.test.ts` (the harness — for each matrix row, run unauth + each role, assert outcome) | `src/lib/auth/require-role.test.ts:24` (mock-driven role test shape) | Same `vi.hoisted` mocks for `getUser` / `loadCurrentMembership`; same `expect(...).rejects.toThrow('redirect:/...')` assertion shape. Difference: imports each Server Action and calls it with a sample FormData, asserts redirect or non-redirect. |

**Conventions referenced:**
- `docs/wiki/auth.md` § "Per-action gate matrix" + § "Capability matrix" — the matrix file in this chunk is the *executable* twin of those wiki tables.
- `src/lib/auth/capabilities.test.ts` — the existing pattern of "table-driven tests against the auth module" — this chunk extends to "table-driven tests against every action that consumes the auth module."

**Overall Progress:** 100% (3/3 phases complete)

**Note:**
- Forward-compatible with 0033 (next-safe-action): the matrix is keyed by action import, not by helper. Migration to safe-action shape doesn't change what the matrix tests — just the action's *implementation* changes. Test mocks adapt to the new shape (mock the safe-action client instead of `assertCan`); matrix entries don't change.
- Each phase ends with `pnpm tsc --noEmit && pnpm lint && pnpm test --run` clean.

## Open Questions

1. **Matrix entry shape — by-action or by-capability?**
   - *Working assumption:* by-action. Each row is `{action: importedFn, formData: SampleFormData, allow: ['admin'], denyRedirect: '/'}`. Reads as "this action, called with this input, by this role, expects this outcome."
2. **How to feed FormData without exercising the mutation?**
   - *Working assumption:* the harness mocks `db` to a no-op stub (same shape as existing actions tests use). The auth gate runs *before* any DB call, so the matrix only needs the gate to fire — assertion lands on `redirect` or `Promise resolved` (no DB activity expected).
3. **Should the matrix include Route Handlers too?**
   - *Working assumption:* yes — `production/export/route.ts` shipping with the wrong gate is the same class of mistake. Same harness; mock `Request`/`Response` at the entry.
4. **Drift detection — can the test require every gated action to have an entry?**
   - *Working assumption:* yes. The harness greps the codebase for `assertCan` / `requireRole` calls in action files, builds the inventory, and fails if the matrix has fewer rows than the inventory. New action lands → CI fails until a matrix row exists. This is the load-bearing guarantee.

## Phase Checklist

### Phase 1: Build the matrix data file

- [x] Inventoried the gated surface (24 Server Actions across `people/`, `schedule/`, `email/` + 2 protected Route Handlers `/production/export` + `/reports/export`).
- [x] Created `src/features/__tests__/action-gate-matrix.ts` exporting `ACTION_MATRIX` — 24 rows, one per gated entry. Two helper outcome-maps (`ADMIN_ONLY`, `ADMIN_OR_COACH`) keep the role-level intent legible at a glance.
- [x] One row per action with `note` field documenting the intent.

### Phase 2: Test harness

- [x] Created `src/features/__tests__/action-gate-matrix.test.ts`. `vi.hoisted` mocks `getUser` + `loadCurrentMembership` + `redirect` + `db` (Proxy-backed no-op stub) + audit + admin client + email send.
- [x] For each row × 4 roles (96 outcome assertions) — green.
- [x] Drift-detection test re-walks `src/features/**/actions.ts` (filtered to top-level `'use server'` files) + `src/app/**/route.ts`, regexes `export async function …`, filters out `// authz: public` opt-outs, asserts every name is in `ACTION_MATRIX`.
- [x] Suite green for current surface — 97/97 (96 matrix + 1 drift).
- [x] Sabotage: replaced `cancelCampaign`'s `assertCan('campaign:cancel')` with `requireRole(['admin', 'coach'])` — `coach → redirect:/` failed as expected. Reverted.

### Phase 3: Wire + close

- [x] Test runs via existing `pnpm test` (already covered by `src/**/*.test.ts` glob in `vitest.config.ts`).
- [x] Updated `docs/wiki/auth.md` § "Structural enforcement of the matrix" with the test-time admit-set sublayer; the new "Three independent layers, each catching a different failure mode" framing splits 0031/0032/0034 into three distinct guarantees.
- [x] Appended `wiki/log.md` entry.
- [x] Full `pnpm test --run` green: 441/441 (was 272 pre-0032 — added 169 tests: 24 rows × 7 roles + 1 drift).
- [x] `pnpm tsc --noEmit && pnpm lint && pnpm test --run` clean. Codex review caught two Highs (4-role matrix admits-set blind spot; drift regex misses const-async/default-async exports) and Medium 2 (file-discovery brittleness) — all three fixed in-eval. Medium 1 (deny-not-tied-to-gate) documented as a known caveat: today no Server Action issues post-gate redirects, but a future action that does could mask a wrong admit; AST-level gate-call telemetry is the carry-forward.
