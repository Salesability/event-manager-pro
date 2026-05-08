# Role-route scoping (admin-only Production + Dealers; coach = Calendar only)

**Started:** 2026-05-07

## Progress Tracker

| Phase | Status | Commit |
|-------|--------|--------|
| 1: Tighten `/production` to admin (edge + page gate) | Done | _bundled_ |
| 2: Tighten `/dealerships` to admin (edge + page gate) | Done | _bundled_ |
| 3: Nav scoping + tests + smoke verification | Done | _bundled_ |

The role taxonomy is settled (admin / coach / dealer per `docs/wiki/auth.md` § "What each role is for"), but the per-route surface scoping today is looser than the intended matrix: `requireStaffAccess` admits any staff role to the `(app)/*` shell, and the nav only marks `admin: true` on Lookups + People — Production List and Dealers are visible to coaches in the current build. This chunk tightens three layers (edge middleware `ADMIN_PATHS`, page-level `requireRole('admin')`, and nav `admin: true` flag) so coach's staff-app surface is **Calendar only** and admin owns everything else. Dealer never gets here at all (`STAFF_APP_ROLES` already excludes them at the staff gate). Out of scope: defining new roles, RLS policy changes, the dealer portal, role-promotion UX changes.

## Code Anchors

For each new code below, the builder reads the anchor first and matches its shape. For modifications to an existing file, the anchor is the nearest sibling line in that same file.

| New code | Anchor (`path:line`) | Why this anchor |
|----------|---------------------|-----------------|
| `src/lib/supabase/middleware.ts:5` (`ADMIN_PATHS` add `/production`, `/dealerships`) | `src/lib/supabase/middleware.ts:5` itself | One-line constant edit — no new code, expand the existing tuple. The path-prefix matcher (`isAdminPath` at `:11`) already handles `/production/export` via the `startsWith` rule. |
| `src/app/(app)/production/page.tsx` (insert `await requireRole('admin')` at top of `default async function`) | `src/app/(app)/admin/people/page.tsx:8` (`await requireRole('admin')`) | Same shape: server-component page, gate at the very top before any data load, reuse the existing helper. |
| `src/app/(app)/production/export/route.ts` (Route Handler — add `requireRole('admin')`) | `src/app/(app)/admin/people/page.tsx:8` (same gate, called inside Route Handler instead of page) | Route Handler bypasses the layout gate, so the action-level gate is load-bearing (this is exactly the bypass that 0018's late Critical caught — see 0018 Phase 6 + `b4e3b6a`/`9231bd8`). Today the file calls `requireStaffAccess()`; tighten to `requireRole('admin')`. |
| `src/app/(app)/dealerships/page.tsx` (insert `await requireRole('admin')` at top) | `src/app/(app)/admin/people/page.tsx:8` | Same shape; relies on 0027 Phase 2 having moved the folder from `/lists` → `/dealerships`. Plan executes against whichever path lives at the top of the (app) tree at start time — see Open Questions. |
| `src/components/app/app-nav.tsx:10-11` (add `admin: true` to Production + Dealers tabs) | `src/components/app/app-nav.tsx:12` (Lookups tab — already has `admin: true`) | Same `Tab` shape, sibling lines. The `tabs.filter((t) => !t.admin || isAdmin)` at `:18` already gates rendering — no logic change needed, just data. |
| `src/lib/supabase/middleware.test.ts` (update assertions: `/production`, `/dealerships` now return `true`) | `src/lib/supabase/middleware.test.ts:18-19` (existing assertions for these paths returning `false`) | Same `expect(isAdminPath('/x')).toBe(...)` shape; flip the value on the two lines that match. |

**Conventions referenced:**
- `docs/wiki/auth.md` — § "What each role is for" defines the matrix; § "Route gating (RBAC)" enumerates the three enforcement layers (edge middleware, layout-level `requireStaffAccess`, per-page `requireRole`). This chunk touches the *first* and *third* layers; the *second* doesn't change (still `requireStaffAccess` on `(app)/layout.tsx`).
- `docs/wiki/auth.md` — § "Per-action gate matrix" stays as-is; this chunk is *page-level*, not Server-Action-level. Action gates were already tightened in 0019 Phase 2.
- `CLAUDE.md` — "Mutations go through Server Actions, not route handlers" — `/production/export` is a legitimate Route Handler exception (CSV download, not a mutation), but it still needs the role gate per the 0018 Critical fix.

**Overall Progress:** 100% (3/3 phases complete — bundled into a single commit on 2026-05-08)

**Note:**
- All three phases are tiny edits — this is a wiring chunk, not a feature.
- Phase 2 has a hard dependency on 0027 Phase 2 actually shipping (route move `/lists` → `/dealerships`).
- Each phase ends with `pnpm tsc --noEmit && pnpm lint && pnpm test --run` clean.

## Open Questions

1. **0027 Phase 2 status — `/lists` vs `/dealerships`?** The 0027 plan tracker shows Phase 2 as `Done | -` (no commit SHA). The folder on disk today is `src/app/(app)/lists/`, not `dealerships/`. If the route move hasn't actually shipped when this chunk starts, two options:
   - *Wait:* hold Phase 2 until 0027 Phase 2 commits the rename.
   - *Adapt:* gate `/lists` instead of `/dealerships` (one edit-target line different in `ADMIN_PATHS`, page anchor moves to whichever path exists). Commit message + anchors stay correct.
   - **Working assumption:** check at start time. Whichever path exists at the top of `(app)/`, gate that one — the URL is incidental, the role is the load-bearing constraint.

2. **Should this also tighten `/production/export`?** Today the Route Handler calls `requireStaffAccess()` (per 0018's late Critical fix). The page itself becomes admin-only in Phase 1; the export endpoint should follow.
   - **Working assumption:** yes — tighten to `requireRole('admin')` in the same phase. A coach who can't see Production has no business exporting it. Listed as a checklist item under Phase 1.

3. **0027 Phase 2 carry-forward — staff-visible `✕` archive on `/dealerships`.** Codex flagged during 0027 Phase 2 eval (`docs/designs/closed/0027-lists-to-dealers/eval-2026-05-07-1040.md`, Medium): the row-actions column renders a `✕` Remove button for every staff viewer, but `archiveDealer` requires `admin` server-side. Pre-existing behavior carried forward verbatim from `list-actions.tsx`, deferred from 0027 by user decision on 2026-05-07. **Phase 2 of this plan resolves it implicitly** — once `/dealerships` is admin-gated at the page level, non-admin staff can't reach the page, so the column-level affordance gate is unnecessary. No separate action needed; flag closed when this plan ships.

4. **Coach with admin-secondary-role: how does that read?** Per auth.md, a person can have multiple `team_member_roles` rows (admin + coach is a valid combo). `requireRole('admin')` matches if *any* of the user's roles is admin (the JWT fast-path checks `app_metadata.role === 'admin'`; the membership fallback uses `roles.some((r) => allowed.includes(r))`). So an admin who is also a coach still sees Production + Dealers — correct.
   - No action needed; documenting for the smoke checklist.

5. **What does a coach see on `/` (the landing route after sign-in)?** Today `(app)/page.tsx` is the landing — does it list links to all staff pages, or auto-redirect somewhere role-appropriate?
   - **Working assumption:** out of scope for this chunk. The landing-page UX (route-based dashboards per role) is a separate UX question. The tightening here just prevents direct navigation; the landing page can be polished later.

6. **Should the redirect target on rejection be friendlier than `/`?** `requireRole` redirects to `/` on role mismatch. For a coach hitting `/production` directly, landing on `/` and silently failing is confusing.
   - **Working assumption:** keep `/` for v1 (matches the existing `requireRole` behavior); follow up with a `/auth/auth-error?reason=...` route if the friction surfaces. Note in carry-forward.

## Phase Checklist

### Phase 1: Tighten `/production` to admin (edge + page gate)

- [ ] `src/lib/supabase/middleware.ts:5` — change `const ADMIN_PATHS = ['/admin'];` → `const ADMIN_PATHS = ['/admin', '/production'];`. The `isAdminPath` matcher at `:11` already handles `/production/export` via the prefix rule.
- [ ] `src/app/(app)/production/page.tsx` — add `await requireRole('admin');` at the top of the default exported async function (anchor: `src/app/(app)/admin/people/page.tsx:8`). Replace any existing `requireStaffAccess()` call if present (the page may not have one — layout-level gate was sufficient).
- [ ] `src/app/(app)/production/export/route.ts` — replace the existing `requireStaffAccess()` call with `requireRole('admin')` (anchor: same as above; commit context is 0018's `b4e3b6a`/`9231bd8` Critical fix).
- [ ] `src/lib/supabase/middleware.test.ts:18` — update `expect(isAdminPath('/production')).toBe(false)` → `toBe(true)`.
- [ ] `pnpm tsc --noEmit && pnpm lint && pnpm test --run` clean.

### Phase 2: Tighten `/dealerships` (or `/lists` if 0027 Phase 2 hasn't shipped) to admin

- [ ] At start time: check whether the folder is `src/app/(app)/dealerships/` or `src/app/(app)/lists/`. Use whichever exists (Open Question 1).
- [ ] `src/lib/supabase/middleware.ts:5` — extend `ADMIN_PATHS` to include the resolved path. End state: `['/admin', '/production', '/dealerships']` (or `'/lists'`).
- [ ] `src/app/(app)/<path>/page.tsx` — add `await requireRole('admin');` at the top. If the page already calls `requireRole(...)` for a different role (unlikely), tighten to `'admin'`.
- [ ] `src/lib/supabase/middleware.test.ts:19` — update the matching assertion from `toBe(false)` → `toBe(true)`.
- [ ] `pnpm tsc --noEmit && pnpm lint && pnpm test --run` clean.

### Phase 3: Nav scoping + tests + smoke verification

- [ ] `src/components/app/app-nav.tsx:10` (Production List tab) — add `admin: true` to the Tab definition.
- [ ] `src/components/app/app-nav.tsx:11` (Manage Lists / Dealers tab) — add `admin: true`.
- [ ] Verify the existing `tabs.filter((t) => !t.admin || isAdmin)` at `:18` correctly hides both tabs from non-admins (no code change — just confirm the filter logic).
- [ ] `pnpm test --run` — full suite (149/149 today on this repo); verify the middleware-test changes from Phases 1+2 pass.
- [ ] `pnpm tsc --noEmit && pnpm lint` clean.
- [ ] Smoke (web-test, **as admin**): `goto /` — nav shows Calendar / Production List / Dealers / Lookups / People. `goto /production` — page renders. `goto /dealerships` — page renders.
- [ ] Smoke (web-test, **as a coach-only user**): `goto /` — nav shows **only Calendar** (no Production, no Dealers, no Lookups, no People). Direct-nav `goto /production` — bounced to `/`. Direct-nav `goto /dealerships` — bounced to `/`. (If a coach-only test fixture isn't already wired, file as carry-forward and verify by code-trace + Codex source-review.)
- [ ] Smoke (manual or curl, **unauthenticated**): `curl -sI <prod>/production` — still 307 → `/login?next=%2Fproduction` (edge gate before role gate; unchanged behavior at this layer).
- [ ] Confirm `docs/wiki/auth.md` § "What each role is for" still reads correctly — the gap paragraph ("Today the role taxonomy is enforced; the per-route surface scoping isn't fully") becomes stale once this chunk ships and should be edited to reflect the new state.
