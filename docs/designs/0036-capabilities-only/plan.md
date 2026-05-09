# Capabilities-only authorization at gates — 2026-05-08

**Started:** 2026-05-08

Standalone risk-reduction chunk. Collapses the codebase's two authorization patterns at gates onto **one**: every Server Action, page, and layout uses `capabilityClient(cap)` / `assertCan(profile, cap)`. Roles still exist as the user's *identity* and as the input to the capability matrix, but no app-code call site checks them directly. The edge middleware (`src/lib/supabase/middleware.ts`) keeps its JWT-claim role check as a defense-in-depth fast-path — it's an optimization, not the durable answer.

Done = `pnpm grep -rn 'requireRole\|requireStaffAccess\|requireAdmin\|roleListClient' src/app src/features` returns no production call sites; `roleListClient` is removed from `src/lib/actions/action-client.ts`; the 0034 pairing CI script covers every gated action; `auth.md` declares "capabilities-only at gates" as the durable convention.

## Progress Tracker

| Phase | Status | Commit |
|-------|--------|--------|
| 1: New capabilities (matrix rows + tests) | Done | `5575c62` |
| 2: Migrate page + layout gates | Done | `d8794b3` |
| 3: Migrate availability actions + delete `roleListClient` | In Progress | - |
| 4: Docs + smoke verification | Pending | - |

**Overall Progress:** 50% (2/4 phases complete)

## Code Anchors

| New code | Anchor (`path:line`) | Why this anchor |
|----------|---------------------|-----------------|
| `src/lib/auth/capabilities.ts` (modify — add 4 caps: `app:access`, `admin:access`, `reports:view`, `availability:edit`) | `src/lib/auth/capabilities.ts` (existing 17-cap union) | In-place addition; mirror the existing `subject:verb` shape. Each new cap maps in the matrix; tests follow the existing pattern in `capabilities.test.ts`. |
| `src/app/(app)/layout.tsx` (modify — replace `requireStaffAccess()` with `assertCan(profile, 'app:access')`) | `src/app/(app)/admin/lookups/page.tsx:1-6` | Same async-server-component shape, just swap the gate function. The `loadCurrentMembership` cached call already runs downstream. |
| `src/app/(app)/{production,dealerships,admin/lookups,admin/people}/page.tsx` (modify — `requireRole('admin')` → `assertCan(profile, 'admin:access')`) | `src/app/(app)/admin/lookups/page.tsx:1-6` | Same in-place call swap; one-line edit per page. |
| `src/app/(app)/reports/page.tsx` (modify — `requireRole(['admin','coach'])` → `assertCan(profile, 'reports:view')`) | `src/app/(app)/admin/lookups/page.tsx:1-6` | Same shape; admit-set differs (admin + coach). |
| `src/app/(app)/reports/export/route.ts` (modify — `requireRole(['admin','coach'])` → `assertCan(profile, 'reports:view')`) | `src/app/(app)/production/export/route.ts` | Same Route Handler shape; production export already does the imperative `assertCan` pattern (kept per 0033 Open Question 6 — Route Handlers stay imperative; they don't run through the safe-action middleware). |
| `src/features/schedule/actions.ts` (modify — 3 sites: `createAvailabilityBlock` / `updateAvailabilityBlock` / `archiveAvailabilityBlock` from `roleListClient(['admin','coach'])` → `capabilityClient('availability:edit')`) | `src/features/schedule/actions.ts:604-681` (the 3 sites) + `src/features/dealers/actions.ts:createDealer` (capabilityClient call shape) | In-place swap; row-level ownership check via `availability-authz.ts` stays in the action body unchanged. |
| `src/lib/actions/action-client.ts` (modify — delete `roleListClient` export + its tests) | `src/lib/actions/action-client.ts:68` (the `roleListClient` definition) | Removal once Phase 3's call sites migrate. The 4-tier comment block at the top of the file collapses to 3 tiers. |
| `src/lib/auth/require-role.ts` (delete or keep?) | n/a | **Open question #1** — see below. |

**Conventions referenced:**
- `docs/wiki/auth.md` — capability matrix; defense-in-depth layers; will be updated in Phase 4 to declare capabilities-only at gates as the durable convention.
- `docs/wiki/security.md` — four-layer defense-in-depth model; edge middleware role-claim check stays as Layer 1 fast-path.
- `0029-capability-layer/plan.md` (closed) — original PDP/PEP introduction.
- `0033-next-safe-action/plan.md` (closed) — `roleListClient` was added as a 4th tier alongside `capabilityClient` to handle the multi-role admit-set carve-outs; this chunk retires it.
- `0034-can-assertcan-pairing/plan.md` (closed) — the pairing CI script will cover every gated action after this chunk lands (today it's moot for the 3 `roleListClient` sites).

**Note:**
- This chunk is unblocked and can run in parallel with 0035 Phase 1+2 (catalog + dealer status). 0035 Phase 3 should consume the new `quote:edit` capability — if 0036 hasn't landed when 0035 Phase 3 starts, 0035 declares `quote:edit` itself in the same migration.
- No new behavior, no new UI, no new pages. Pure authz-pattern uniformity.

### Phase Checklist

#### Phase 1: New capabilities (matrix rows + tests)

- [x] Add 4 new capabilities to `src/lib/auth/capabilities.ts`'s string-literal union:
  - `app:access` — admin || staff || coach || viewer (matches `STAFF_APP_ROLES`; preserves `requireStaffAccess()` admit-set exactly — refines Q3's working assumption from `admin || coach` to the full staff-app set, since today's coach is the only non-admin holder but the gate has always been broader)
  - `admin:access` — admin (gates the 4 admin-only pages: `/admin/lookups`, `/admin/people`, `/production`, `/dealerships`)
  - `reports:view` — admin || coach (gates `/reports` + `/reports/export`)
  - `availability:edit` — admin || coach (gates the 3 availability-block Server Actions)
- [x] Update the matrix in `can(profile, capability, ...)` accordingly.
- [x] Add tests in `src/lib/auth/capabilities.test.ts` — 4 caps × {admin/coach/viewer/dealer/orphan/unauth} admit-set assertions. (Extended fixtures to add staff/viewer/dealer profiles; +38 new test cases; 88/88 pass.)
- [x] Update the per-action gate matrix in `auth.md` (preview only; full doc rewrite lands in Phase 4).

#### Phase 2: Migrate page + layout gates

- [x] ~~`src/app/(app)/layout.tsx` — `requireStaffAccess()` → `await assertCan(profile, 'app:access')`.~~ Refined: kept layout calling `requireStaffAccess` because `assertCan` redirects to `/` on deny — `/` is inside `(app)/` and would loop on a dealer-only contact typing `/calendar` directly. `requireStaffAccess` retains the friendly auth-error redirects (Portal-not-yet-available / Account-not-provisioned). Predicate refactored to delegate to `can(profile, 'app:access')` so the capability is canonical and `<Can>` / `useCan` see the same decision. (Refines plan's working assumption — see Phase 2 commit; refines Open Question #1.)
- [x] `src/app/(app)/admin/lookups/page.tsx` — `requireRole('admin')` → `assertCan('admin:access')`.
- [x] `src/app/(app)/admin/people/page.tsx` — same.
- [x] `src/app/(app)/production/page.tsx` — same.
- [x] `src/app/(app)/dealerships/page.tsx` — same.
- [x] `src/app/(app)/reports/page.tsx` — `requireRole(['admin','coach'])` → `assertCan('reports:view')`.
- [x] `src/app/(app)/reports/export/route.ts` — `requireRole(['admin','coach'])` → `assertCan('reports:view')` (imperative).
- [x] Existing tests update — `reports/export/route.test.ts` mock swapped to `assertCan('reports:view')` + invocation order assertion. `action-gate-matrix.ts` note updated for `GET /reports/export`. All 489 tests still pass; pairing script reports 17/17.

#### Phase 3: Migrate availability actions + delete `roleListClient`

- [x] `src/features/schedule/actions.ts` — 3 sites from `roleListClient(['admin','coach'])` → `capabilityClient('availability:edit')`. Row-level ownership check via `availability-authz.ts` stays in the action body unchanged.
- [x] ~~Update `src/features/schedule/actions.test.ts` mocks — replace `roleListClient` import + setup.~~ Not needed: `actions.test.ts` doesn't mock `roleListClient` or `requireRole` — it tests action bodies, not the gate factory wiring (which `action-client.test.ts` covers separately).
- [x] Pair check: wrapped the `Block Date` button in `calendar-view.tsx` with `<Can capability="availability:edit">`. Pairing script now reports 18/18.
- [x] Delete `roleListClient` export from `src/lib/actions/action-client.ts`. Delete the corresponding test cases in `src/lib/actions/action-client.test.ts` — replaced the 3 roleListClient cases with 2 capabilityClient cases (admit-coach for `availability:edit`, deny-coach for `admin:access`) so the multi-role admit-set is still covered through the capability layer.
- [x] Update the 4-tier → 3-tier comment block at the top of `action-client.ts`.
- [x] Run 0034 pairing script — reports 18/18 capabilities paired or opted out (was 17/17 with `availability:edit` server-only-flagged before the `<Can>` was added).

#### Phase 4: Docs + smoke verification

- [ ] Update `docs/wiki/auth.md`:
  - Capability matrix table — add the 4 new rows + the migration of the 3 availability actions.
  - Defense-in-depth section — declare "capabilities-only at gates" as the durable convention.
  - Edge middleware section — clarify it's a defense Layer 1 (JWT-claim fast-path), not the authorization decision.
- [ ] Update `docs/wiki/security.md`:
  - Layer 2/3 description — page + action gates are uniform `assertCan` / `capabilityClient`.
- [ ] Update `docs/wiki/log.md` with a same-day entry summarising the chunk.
- [ ] `pnpm test` — full vitest pass (was 453 + 9 from 0033; expect 462+ after Phase 1's new tests).
- [ ] `pnpm tsc --noEmit` clean.
- [ ] `pnpm lint` clean.
- [ ] 0031 lint (action-gate) clean.
- [ ] 0032 action-matrix test clean.
- [ ] 0034 pairing check clean — verify it now covers every action.
- [ ] Smoke (web-test): `goto /production` as admin → renders. As coach → redirects. (auth-injected coach fixture not yet wired; verify by code-trace if no fixture).
- [ ] Smoke (web-test): `goto /reports` as admin → renders; as coach → renders.
- [ ] Smoke (web-test): `goto /calendar` → click `Block Date` → dialog opens (admin + coach both reach this surface).

## Open questions

- **#1 — Delete `require-role.ts` entirely, or keep it for the edge middleware path-match?** The edge middleware reads JWT claims, not the team-membership profile, so it can't use `assertCan` (which needs the cached membership row). Today middleware uses string-match on `ADMIN_PATHS` — that doesn't depend on `require-role.ts` at all. **Working assumption: keep `require-role.ts` as a thin internal helper used only by the middleware's defense-in-depth fast-path; remove all `requireRole` / `requireStaffAccess` exports that aren't used by middleware.** Reads as "not part of the public authorization API anymore; an edge optimization."
- **#2 — Should `admin:access` be split into per-area capabilities (`production:view`, `dealerships:view`, `admin-area:access`)?** Today every admin page admits the same set (admin only). Splitting them is forward-compatibility for "what if /production opens up to coach later?" — but it's a 30-minute matrix bump if/when that day arrives. **Working assumption: one `admin:access` until a real divergence appears.** Keeps the matrix readable.
- **#3 — Does the `(app)/layout.tsx` `app:access` admit-set match `requireStaffAccess()` behavior?** ~~Working assumption: admin || coach.~~ **Resolved Phase 1 (2026-05-08):** `requireStaffAccess()` admits any role in `STAFF_APP_ROLES = {admin, staff, coach, viewer}` (see `src/lib/auth/load-team-membership.ts:16`). To preserve gate semantics on the swap, `app:access` is implemented as `admin || staff || coach || viewer`. Today's coach is the only non-admin holder, but `staff`/`viewer` are reserved enum values per `auth.md`'s "v1 wired roles" note — keeping the broader set means a future `staff` or `viewer` activation doesn't require touching the matrix.
- **#4 — Pair `<Can capability="app:access">` and `<Can capability="admin:access">` UI guards anywhere?** Today the layout gate is server-side only (no UI element conditionally renders on "are you admin"); the admin nav menu is server-rendered with the role from the cached membership. Adding `<Can>` paired with these capabilities would be churn for no UX gain. **Working assumption: opt out via 0034 inline `// expected: server-only` comments on the page-level `assertCan` calls.** Same pattern 0034 already established for `production:export` and `coach-availability:edit-own`.
- **#5 — Coach in `app:access` — is that broader than `staff:access` would be?** Naming nit. `app:access` reads as "can enter the app shell," which today is admin + coach. If a viewer role ever needs read-only app access, the cap can broaden. **Working assumption: `app:access` is the right name; `staff:access` would be misleading once viewer is admitted.**

## Followups (not blockers, but emerge naturally)

- The 0033 Phase 4 carry-forward (write Zod schemas + retire hand-rolled validators) is independent of this chunk but adjacent — both touch the same Server Actions. If 0036 ships first, the migration footprint is 11 sites × authz; if 0033 Phase 4 ships first, it's the same 11 × validators. They commute. Pick whichever lands the developer is in the mood for.
- The `0035-quote-composer` plan declares a `quote:edit` capability (Open Question #3). If 0036 ships first, 0035 inherits the convention; if 0035 ships first, the convention establishes itself in 0035 and 0036 absorbs it.
