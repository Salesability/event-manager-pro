# Action gate matrix test (catch wrong admit set, not just missing gate)

**Started:** 2026-05-08

## Progress Tracker

| Phase | Status | Commit |
|-------|--------|--------|
| 1: Build the action↔role admit-set matrix data file | Pending | - |
| 2: Test harness — drive each action with each role, assert documented outcome | Pending | - |
| 3: Wire into vitest + close | Pending | - |

The 0031 lint rule catches "no gate at all." This chunk catches "gate is present but wrong admit set" — e.g. an action gated `requireRole(['admin','coach'])` when intent is admin-only, or a capability call site against the wrong capability. The mistake passes review if the reviewer doesn't have the role↔capability matrix loaded. Solution: a matrix file (data) listing every gated action + its expected admit set per role; a single test file that imports each action and drives it against unauth + each role; assertions check the documented outcome (allow / `redirect:/` / `redirect:/login`). Drift between code and matrix → CI fails. **Done = every gated action has a matrix entry; the suite drives all entries; a deliberate code-change that changes admit set fails the suite without matrix update.**

## Code Anchors

| New code | Anchor (`path:line`) | Why this anchor |
|----------|---------------------|-----------------|
| `src/features/__tests__/action-gate-matrix.ts` (data file: action import → expected admit map per role) | (none — net-new pattern) | First instance of this shape in the repo. Inspired by [`src/lib/auth/capabilities.test.ts`](../../src/lib/auth/capabilities.test.ts) ADMIN_ONLY_CAPS table-driven shape, but here the table imports actions rather than calling `can()` directly. |
| `src/features/__tests__/action-gate-matrix.test.ts` (the harness — for each matrix row, run unauth + each role, assert outcome) | `src/lib/auth/require-role.test.ts:24` (mock-driven role test shape) | Same `vi.hoisted` mocks for `getUser` / `loadCurrentMembership`; same `expect(...).rejects.toThrow('redirect:/...')` assertion shape. Difference: imports each Server Action and calls it with a sample FormData, asserts redirect or non-redirect. |

**Conventions referenced:**
- `docs/wiki/auth.md` § "Per-action gate matrix" + § "Capability matrix" — the matrix file in this chunk is the *executable* twin of those wiki tables.
- `src/lib/auth/capabilities.test.ts` — the existing pattern of "table-driven tests against the auth module" — this chunk extends to "table-driven tests against every action that consumes the auth module."

**Overall Progress:** 0% (0/3 phases complete)

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

- [ ] Inventory the gated surface — grep `assertCan|requireRole` in `src/features/*/actions.ts` and `src/app/(app)/**/route.ts`. ~20 entries today; expect to grow.
- [ ] Create `src/features/__tests__/action-gate-matrix.ts` exporting an array of rows: `{ action, label, sampleFormData, expectedByRole: { unauth: 'redirect:/login', admin: 'allow', coach: 'redirect:/', orphan: 'redirect:/' } }`.
- [ ] One row per action. Document the *intent* in a comment per row (one line: "admin-only — back-office; coach is field-only" etc.). Match the wiki § "Per-action gate matrix" prose.

### Phase 2: Test harness

- [ ] Create `src/features/__tests__/action-gate-matrix.test.ts`. Use `vi.hoisted` for `getUser` + `loadCurrentMembership` + `redirect` mocks (mirror `require-role.test.ts`).
- [ ] For each role × matrix row → assert outcome.
- [ ] Add a "drift detection" test that re-greps the codebase for gated actions and fails if any are missing from the matrix. Use `glob.sync` + simple regex; doesn't need full AST.
- [ ] Run; expect green for the existing surface (since today's gates already match documented intent — verified by 0029's per-action sweep).
- [ ] Run a deliberate sabotage: temporarily change one action's gate from `'admin'` to `['admin', 'coach']`; verify the suite fails on that row; revert.

### Phase 3: Wire + close

- [ ] Verify the test runs in the existing `pnpm test` invocation (no extra config — it's just another `*.test.ts` under `src/`).
- [ ] Update `docs/wiki/auth.md` § "Capability gating" — add a one-paragraph note about the executable matrix as the test-time enforcement layer. Cross-link from § "Per-action gate matrix" to the matrix file.
- [ ] Append a `wiki/log.md` entry.
- [ ] Smoke: full `pnpm test --run` green, including the new matrix file.
- [ ] `pnpm tsc --noEmit && pnpm lint && pnpm test --run` clean.
