# Capability layer (in-process PDP for actions + UI affordances)

**Started:** 2026-05-07

## Progress Tracker

| Phase | Status | Commit |
|-------|--------|--------|
| 1: Capability map + `can()` PDP + `assertCan` server helper | Done | _bundled_ |
| 2: Migrate selected Server Action call sites from `requireRole` → `assertCan` | Done | _bundled_ |
| 3: `CapabilityProvider` + `useCan()` + `<Can>` wrapper for client components | Done | _bundled_ |
| 4: Apply `<Can>` to existing row-actions (Dealers `✕`, People archive, Lookups edit) | Done | _bundled_ |
| 5: Wiki update + tests + smoke | Done | _bundled_ |

This chunk grafts a thin in-process PDP onto the existing `requireRole` foundation so the role-to-permission mapping lives in **one** file, and so client components ask for *capabilities* (e.g. `dealer:archive`) instead of raw roles. Today the role-check shape is duplicated across two surfaces: the Server Action layer (`await requireRole('admin')` × 21 call sites) and the UI affordance layer (ad-hoc `isAdmin` props passed down to nav and toolbars). Both sides reach into the role taxonomy directly, so the matrix is implicit and a future "coaches can archive their own thing" change has to be re-derived in N places. The new module `src/lib/auth/capabilities.ts` is the single PDP — a pure switch from `(profile, capability, resource?) → boolean` — and exposes two PEP shims: `assertCan` (throws/redirects, same shape as `requireRole`) for Server Actions, and `<Can>` / `useCan` (boolean, same shape as a feature flag) for client components. Roles stay; capabilities sit *on top of* roles. **Done = the four row-actions Codex flagged in 0027 + the call sites this plan touches all funnel through `can()`, the affordance layer matches server-side intent, and `auth.md` documents the fourth gate layer.** Soft-depends on 0028 shipping first (route-level scoping is the floor this layer sits on top of).

## Code Anchors

For each new file or method below, the builder reads the anchor first and matches its shape (length, error handling, naming, query style).

| New code | Anchor (`path:line`) | Why this anchor |
|----------|---------------------|-----------------|
| `src/lib/auth/capabilities.ts` (pure `can(profile, cap, resource?) → boolean`, capability list as a string-literal union) | `src/lib/auth/require-role.ts:20` | Same directory, same "role-aware predicate" shape, same `'server-only'` discipline. `requireRole` mixes data-fetch + decide; `can()` is the *decide* half extracted as a pure function. Profile is loaded by the caller (via `loadCurrentMembership`) and passed in — capabilities make no DB calls themselves. |
| `src/lib/auth/assert-can.ts` (`assertCan(cap, resource?) → User`, throws/redirects on deny) | `src/lib/auth/require-role.ts:20` | Same file shape: `'server-only'`, async, calls `getUser()` + `loadCurrentMembership()`, redirects to `/login` or `/`. Internally delegates the decision to `can()` from `capabilities.ts`. Lives next to `require-role.ts` so call sites import from the same neighborhood. |
| `src/lib/auth/capabilities.test.ts` | `src/lib/auth/require-role.test.ts:24` | Same `describe/it` shape, same `redirect:/login` / `redirect:/` rejection assertions. Capability tests are pure-table tests (no mocking) since `can()` is a pure function — the mocked-`getUser` style only applies to `assert-can.test.ts`. |
| `src/lib/auth/assert-can.test.ts` | `src/lib/auth/require-role.test.ts:24` | Same mock surface (`getUser`, `loadCurrentMembership`), same redirect-rejection assertions. Mirror of the require-role suite, one capability per case. |
| `src/components/auth/capability-provider.tsx` (client component, holds `{ profile, can }` in context, wraps the `(app)` tree) | `src/components/auth/session-banner.tsx` | Same dir, same auth-flavored client surface. Provider reads the loaded profile from the layout's server data and exposes a `can` function bound to it; no per-render DB calls. |
| `src/components/auth/can.tsx` (`<Can capability="…" resource={…}>{children}</Can>` + `useCan()` hook) | `src/components/auth/session-banner.tsx` | Same dir, same client-component shape. `<Can>` returns `null` when denied (hide-by-default); a `<Can ... fallback={…}>` slot covers the disable-with-tooltip case. |
| `src/components/auth/can.test.tsx` | `src/components/ui/dialog.test.tsx` (if present) or `src/lib/auth/require-role.test.ts:24` | Component test exercising provider + wrapper rendering decisions per role. Same test runner (vitest), same JSX-test shape used elsewhere. If no component tests exist for `src/components/auth/`, file as carry-forward and verify by code-trace. |
| Migration of `requireRole('admin')` → `assertCan('production:export', …)` etc. (Phase 2) | `src/features/people/actions.ts:333` (existing `await requireRole('admin');` shape) | Same one-liner gate at the top of the action, same return shape (User), same redirect-on-fail behavior. Migration is mechanical: pick the call sites where a *capability* name is more meaningful than the bare role, replace the line. Don't migrate every site — only the ones whose capability semantics tighten intent (see Phase 2 list). |
| `<Can>` adoption in row-actions (Phase 4) | `src/components/app/app-nav.tsx:18` (`tabs.filter((t) => !t.admin || isAdmin)` — existing affordance gate) | Same shape: hide-when-denied. The nav already gates by role-boolean; `<Can>` is the same idea but capability-keyed instead of role-keyed and per-resource-aware. |

**Conventions referenced:**
- `docs/wiki/auth.md` — § "Route gating (RBAC)" enumerates the three existing layers (edge middleware, layout `requireStaffAccess`, per-page/per-action `requireRole`). This chunk adds a *fourth* layer ("Capability gating: actions + UI affordances") as a sibling subsection and updates § "What each role is for" to point at the capability map as the canonical role↔permission table.
- `docs/wiki/security.md` — § "Defence in depth" (the five-layer map). The capability layer doesn't add a *security* layer (server-side `requireRole` is still load-bearing); it adds an *intent* layer that makes the matrix legible. Update the § to call this out so future readers don't think `<Can>` is enforcement.
- `CLAUDE.md` — "Mutations go through Server Actions, not route handlers." Every `<Can>` in the UI must pair with an `assertCan` (or surviving `requireRole`) in the action it triggers. This is the analog of 0018's Critical fix at the button granularity.

**Overall Progress:** 100% (5/5 phases complete — bundled into a single commit on 2026-05-08)

**Note:**
- This is a layering chunk, not a feature. No new user-visible behavior; the gain is *legibility* of the role↔permission matrix and a clean expansion path for resource-relative capabilities (e.g. coach-edits-own-availability) that today require ad-hoc checks like `availability-authz.ts`.
- Phases 1–2 are server-only; Phase 3 introduces the client wiring; Phase 4 is the first concrete UI adoption (small surface, builds confidence); Phase 5 closes with docs + smoke.
- Each phase ends with `pnpm tsc --noEmit && pnpm lint && pnpm test --run` clean.
- **Soft dependency on 0028.** 0028 page-gates Production + Dealers to admin-only, which closes the 0027 carry-forward (staff-visible `✕` archive) at the *route* layer. This plan adds the `<Can capability="dealer:archive">` affordance gate as the *defence-in-depth* re-statement of the same intent — useful when a future button appears that *some* staff (e.g. coaches) should see and dealers shouldn't, where route-gating alone can't carve.

## Open Questions

1. **Capability naming convention — `subject:verb` vs `verb:subject` vs flat.** Working assumption: `subject:verb` (`dealer:archive`, `person:edit`, `production:export`). Matches OpenFGA / Cedar convention and groups by surface area at the top of grep output. Decide before Phase 1 commits.

2. **Resource type — pass typed objects or just IDs?** `can(profile, 'event:edit', event)` vs `can(profile, 'event:edit', { eventId, coachId })`. Working assumption: full objects when available (the action already loaded the row), shape-typed otherwise. Capabilities accept `unknown` and narrow internally. Avoids forcing every call site to load the resource just to ask the question.

3. **Should `<Can>` default to hide or to disable+tooltip?** Working assumption: **hide by default** (matches existing nav behavior). Disable-with-tooltip is opt-in via `<Can ... fallback={<DisabledWithTooltip reason="…" />}>`. Most capability denials in this app are role-based (coach won't ever have admin) — hide is the right primitive. The disable case is for context-based denials (event already locked, URL already expired) which today don't go through the capability layer at all.

4. **Where does the `CapabilityProvider` mount?** Working assumption: in `(app)/layout.tsx`, fed by the same `loadCurrentMembership()` call the layout already makes. Single source of truth per request. The dealer portal (when it exists, post-0029) gets its own provider mount.

5. **Migration scope for Phase 2 — which call sites to migrate?** Working assumption: only sites where `capability` semantically tightens `role`. Concretely: `production:export` (route handler), `dealer:archive` / `dealer:edit` / `dealer:create` (Server Actions), `person:archive` / `person:edit` / `person:adopt-orphan`, `lookup:edit`. Sites where the role *is* the capability (`signOut`, generic staff-only reads with `['admin','staff','coach']`) stay on `requireRole` — adding a `staff:any` capability buys nothing. Decide list before Phase 2 commits.

6. **Coach-edits-own-availability — does this plan absorb it?** `src/features/schedule/availability-authz.ts` today owns the row-ownership + admin-skip predicate. Two options:
   - *Keep separate:* `availability-authz.ts` stays as-is; it's a domain-specific predicate, not a generic capability.
   - *Absorb:* expose as `coach-availability:edit-own` capability with the row-owner check inside the resource branch.
   - **Working assumption:** absorb (Phase 2). One canonical capability map is the entire point. The row-ownership check moves into `capabilities.ts`'s case for `coach-availability:edit`; `availability-authz.ts` becomes a thin re-export for backwards-compat (or gets deleted if no other call sites use it).

7. **Should the capability map be split per-domain or single-file?** Single file is simpler to read end-to-end and matches the small role surface; one file per domain (`capabilities/dealer.ts`, `capabilities/event.ts`) scales better but fragments the matrix. Working assumption: single file for v1 — split if it grows past ~30 capabilities. Today the count would be ~12.

8. **Type-safety for capability strings.** Working assumption: string-literal union (`type Capability = 'dealer:archive' | 'dealer:edit' | …`) — no runtime registry, no Map. TypeScript catches typos at the call site, autocomplete works, no enum overhead. Matches CASL's `Subjects` shape.

## Phase Checklist

### Phase 1: Capability map + `can()` PDP + `assertCan` server helper

- [ ] `src/lib/auth/capabilities.ts` — define `type Capability = …` (string-literal union covering the v1 set); export `can(profile: { user, roles }, cap: Capability, resource?: unknown) → boolean` as a pure switch. No `'server-only'` directive — pure logic, importable from both server and client (the *PDP* is shared; the *PEP* sides differ).
- [ ] Capabilities for v1: `production:view`, `production:export`, `dealer:view`, `dealer:edit`, `dealer:create`, `dealer:archive`, `person:view`, `person:edit`, `person:archive`, `person:adopt-orphan`, `lookup:edit`, `coach-availability:edit-own`, `coach-availability:edit-any`. Refine list during Phase 1.
- [ ] `src/lib/auth/assert-can.ts` — `'server-only'`; `assertCan(cap, resource?) → Promise<User>`; loads user via `getUser()`, loads roles via `loadCurrentMembership()`, calls `can(profile, cap, resource)`, redirects to `/login` (no user) or `/` (denied) on failure. Returns `User` on success — same return contract as `requireRole`.
- [ ] `src/lib/auth/capabilities.test.ts` — pure table-test of `can()`. One row per `(role, capability, expected)`; admin/coach/dealer × the 13 capabilities. Resource-keyed cases (e.g. `coach-availability:edit-own` with matching vs non-matching `coachId`) get their own table.
- [ ] `src/lib/auth/assert-can.test.ts` — mirror of `require-role.test.ts` shape. Mocked `getUser` + `loadCurrentMembership`; assert redirects on `/login` (unauth) and `/` (denied); assert returns User on allow.
- [ ] `pnpm tsc --noEmit && pnpm lint && pnpm test --run` clean.

### Phase 2: Migrate selected Server Action call sites

- [ ] Decide migration list (Open Question 5). Working set:
   - `src/app/(app)/production/export/route.ts` — `requireRole('admin')` → `assertCan('production:export')` (post-0028).
   - `src/features/people/actions.ts` — sites at `:333`, `:483`, `:705`, `:787` → `assertCan('person:archive')` / `'person:edit'` / `'person:adopt-orphan'` per action.
   - Dealer Server Actions (in `src/features/dealers/actions.ts` if it exists, else wherever `archiveDealer`/`updateDealer`/`createDealer` live) → `assertCan('dealer:archive')` etc.
   - `src/features/schedule/availability-authz.ts` — replace contents with `assertCan('coach-availability:edit-own', availabilityRow)` per Open Question 6; keep file as a deprecation re-export or delete depending on call-site sweep.
- [ ] Sites that **stay** on `requireRole`: `src/features/email/actions.ts:15` (multi-role staff send — capability would be `email:send` for `['admin','staff','coach']`, no semantic gain over the role list — defer); generic Calendar reads in `src/features/schedule/actions.ts` for `['admin','staff','coach']` (same reasoning).
- [ ] For each migrated site: replace the line, run the existing per-action test, verify it still passes (the test was asserting the role check; capability check should reject the same set of users).
- [ ] `pnpm tsc --noEmit && pnpm lint && pnpm test --run` clean.

### Phase 3: `CapabilityProvider` + `useCan()` + `<Can>` wrapper

- [ ] `src/components/auth/capability-provider.tsx` — `'use client'`; takes `{ user, roles }` from layout server data; exposes `{ can: (cap, resource?) => boolean }` via context. Single mount in `(app)/layout.tsx`.
- [ ] `src/components/auth/can.tsx` — `useCan(cap, resource?) → boolean`; `<Can capability="…" resource={…} fallback={…}>` component (returns `children` if allowed, `fallback` if provided, else `null`).
- [ ] Wire provider into `src/app/(app)/layout.tsx` — pass the same `user` + `membership.roles` already loaded for `requireStaffAccess`. No additional DB hits.
- [ ] `src/components/auth/can.test.tsx` — render with mocked provider per role; assert children visibility per capability. (If no precedent for component tests in `src/components/auth/`, document as carry-forward and rely on Phase 4's smoke.)
- [ ] `pnpm tsc --noEmit && pnpm lint && pnpm test --run` clean.

### Phase 4: Apply `<Can>` to existing row-actions

- [ ] `/dealerships` row-actions `✕` archive button — wrap in `<Can capability="dealer:archive" resource={dealer}>`. (Closes the 0027 Phase 2 Codex Medium at the affordance layer; 0028's page-gate already closes it at the route layer.)
- [ ] `/admin/people` row-actions Edit + Archive — wrap in `<Can capability="person:edit">` / `<Can capability="person:archive">`. Today these are admin-only via the page-level `requireRole('admin')` gate — `<Can>` becomes redundant for *current* role matrix but locks the affordance to capability-keyed intent for future expansions.
- [ ] `/admin/lookups` row-edit affordances — wrap in `<Can capability="lookup:edit">`.
- [ ] `src/components/app/app-nav.tsx` — replace the `isAdmin` boolean prop + `tabs.filter((t) => !t.admin || isAdmin)` shape with per-tab `<Can capability="…:view">` (or keep nav as role-driven and just call out the inconsistency in Phase 5's wiki update — decide during Phase 4).
- [ ] `pnpm tsc --noEmit && pnpm lint && pnpm test --run` clean.

### Phase 5: Wiki update + tests + smoke

- [ ] `docs/wiki/auth.md` — add a fourth subsection under § "Route gating (RBAC)" titled "Capability gating: actions + UI affordances." Document the PDP (`can()`) + the two PEPs (`assertCan`, `<Can>`); link the capability map; restate that capabilities are an *intent* layer, not a *security* layer, and that every `<Can>` must pair with a server-side `assertCan` (or `requireRole`) in the action it triggers.
- [ ] `docs/wiki/auth.md` § "What each role is for" — replace the "Today the role taxonomy is enforced; the per-route surface scoping isn't fully" gap paragraph (which 0028 Phase 5 should also be tidying) with a pointer to the capability map as the canonical role↔permission table.
- [ ] `docs/wiki/security.md` § "Defence in depth" — add a row to the layer table for the capability layer with the **intent layer, not enforcement** caveat.
- [ ] `docs/wiki/log.md` — append-only entry for the chunk.
- [ ] `pnpm tsc --noEmit && pnpm lint && pnpm test --run` clean. Full vitest suite green.
- [ ] Smoke (web-test, **as admin**): `goto /dealerships`; row-actions column shows `✕` button. `goto /admin/people`; row-actions column shows Edit + Archive. `goto /admin/lookups`; per-row edit affordances visible.
- [ ] Smoke (web-test, **as a coach-only user**, if fixture exists): `goto /` (post-0028); only Calendar tab visible; navigating directly to an admin route bounces to `/`. (Per 0028's smoke checklist.)
- [ ] Confirm `docs/wiki/auth.md` rewrite reads cleanly: § "Route gating (RBAC)" now describes four layers, § "What each role is for" no longer carries the gap paragraph.
