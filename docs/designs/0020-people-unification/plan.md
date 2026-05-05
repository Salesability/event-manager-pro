# People unification — fold `/admin/users` + Sales Coaches into a single Add Person flow that abstracts away `auth.users`

**Started:** 2026-05-05

The data model already says "every human is one `contacts` row, with optional facets" (`docs/wiki/data-model.md:23-29`), but the admin UI fragments that human across three surfaces — `/admin/users` (auth row), Manage Lists → Sales Coaches (contacts + coach role), and the Link contact dialog (the bridge). Provisioning Tilley Shaye exposed the seam: her auth row exists, no contacts row exists, and the only path forward is "use Add Coach as a back-door to materialize a contact, then go re-link it." That mental model is yucky and the eval reports keep flagging the gap (e.g. CURRENT.md history 2026-05-05). This chunk collapses the three surfaces into one **Add Person** flow on a single People page where login + roles + dealer relationships are all checkboxes on one form. **Done =** `/admin/people` is the only place to manage humans; Add Person creates a `contacts` row + optionally `auth.users` + role rows + dealer rows in a single transaction; Manage Lists' Sales Coaches section is gone (or becomes a read-only filtered view); admins never see the words "auth user" or "Link contact" again.

## Decisions

1. **Contact is the spine, auth user is a facet.** The new page lists *contacts*, not auth users. Linked auth-user info (email, last sign-in, providers) appears as a sub-detail when `contacts.user_id` is set. An admin who never thinks about Supabase Auth shouldn't have to.

2. **`createPerson` is the single Server Action.** It always creates a `contacts` row + email/phone identifiers. Optional flags toggle: `appAccess` (creates `auth.users` row + sets `contacts.user_id`), `roles[]` (writes `team_member_roles`), `dealerLinks[]` (writes `dealer_contacts`). One transaction; rollback on any failure.
   - `auth.admin.createUser` is *not* transactional with Drizzle. Mitigation: create the auth user **last** so a Drizzle failure rolls back without leaving an orphan auth row. If `auth.admin.createUser` itself fails, the contact + roles are already committed but the admin can edit/delete via the same UI — no orphan auth row.

3. **`linkUserToContact` is deleted, not relabelled.** "Link contact" is a DB-implementation-detail concept (the `contacts.user_id` FK) that should never have surfaced in admin UI. The unified Add/Edit Person flow covers every primary case: admin creates a person → toggling **App access** atomically writes `auth.users` + `contacts.user_id` in one server-side step. No "now go link them" second action. **Existing orphan auth users (Tilley today) are an exception** handled out-of-band via a one-time adoption script — see Phase 4 below — not a recurring UI concept.

4. **`createUser` (the 0018 action) folds into `createPerson`.** The "Add user" dialog tabs (Create new / Pick existing / No link) collapse into the new Add Person form, which has a single "Has app access" checkbox. The Pick-existing case becomes "find the contact in the list, click Edit, toggle App access on" — different UI path, same DB result. `createUser` is deleted; nothing external calls it.

5. **`createCoach` (Manage Lists action) folds into `createPerson`.** Existing Sales Coaches calls become a filtered view on `/admin/people` (or just disappear — coaches show on the people page tagged with the Coach chip; the booking form keeps reading from `team_member_roles(role='coach')` so no downstream change). `createCoach` is deleted. The booking-form coach picker, `/calendar` coach pre-filter, `/share/coach/[id]`, "email assigned coach" all read from the same query — none change.

6. **Dealer-side relationships stay editable on the Dealer page too.** A contact's `dealer_contacts` rows can be edited from the Person row OR from the Dealer row (existing dealer detail UI). Two doors into the same data — like editing a campaign from `/calendar` vs `/production`. No data duplication.

7. **No DB migration.** The schema already supports the unification; this is purely a UI + Server Action consolidation. Existing rows (David, Shannon, Tilley) become valid people on day one, modulo the same "Tilley needs a contact row" remediation that's already documented (`scripts/promote-admin.ts` handles it).

8. **Page route is `/admin/people`, not `/admin/contacts`.** "Contacts" is overloaded with the customer-side meaning (`dealer_contacts`); "People" is unambiguous and matches how an admin thinks about the page. Old `/admin/users` redirects to `/admin/people` for muscle memory.

## Progress Tracker

| Phase | Status | Commit |
|-------|--------|--------|
| 1: `loadAdminPeople` query + types | Done | `82e3564` |
| 2: `createPerson` + `updatePerson` Server Actions (folds `createUser` + `createCoach`) | Done | `1053257` |
| 3: `/admin/people` page + Add/Edit Person dialog | Done | `33bfc51` |
| 4: Retire Sales Coaches section + redirect `/admin/users` → `/admin/people` | Done | `3dc6ec0` |
| 5: Wiki updates + verification | Pending | - |

## Code Anchors

For each new file or method below, the builder reads the anchor first and matches its shape (length, error handling, naming, query style). For modifications to an existing file, the anchor is the nearest sibling method in that same file.

| New code | Anchor (`path:line`) | Why this anchor |
|----------|---------------------|-----------------|
| `src/features/people/queries.ts:loadAdminPeople` | `src/features/auth/queries.ts:36` (`loadAdminUsers`) | Same shape: list every contacts row, join the optional auth-user side via `contacts.user_id`, attach role chips. The new query inverts the join direction (contacts as spine) but reuses the same `auth.admin.listUsers` + Drizzle joins. |
| `src/features/people/queries.ts:type AdminPersonRow` | `src/features/auth/queries.ts:7` (`AdminUserRow`) | Same field set + `dealerLinks: { dealerId, dealerName, role }[]` for the dealer-side facet. |
| `src/features/people/actions.ts:createPerson` | `src/features/auth/actions.ts:104` (`createUser`) for the auth + roles transaction shape, **plus** `src/features/schedule/actions.ts:232` (`createCoach`) for the contacts + identifiers + role-row transaction shape. | The new action is literally the merger of these two — same transaction patterns, same `swapPrimaryIdentifier` helper, same `applyRoleSet` from 0018. |
| `src/features/people/actions.ts:updatePerson` | `src/features/auth/actions.ts:179` (`setUserRoles`) + `src/features/schedule/actions.ts:275` (`updateCoach`) | Combines both: edits names/identifiers AND syncs role-set AND syncs dealer relationships. |
| `src/features/people/actions.ts:archivePerson` | `src/features/auth/actions.ts:135` (`deactivateUser`) | Same shape: ban the auth user (if linked) + archive `team_member_roles` rows. **Must NOT archive the `contacts` row** — see [`docs/wiki/lifecycle.md`](../../wiki/lifecycle.md), the principle landed via the 0018 eval (Codex Medium #2). |
| `src/app/(app)/admin/people/page.tsx` | `src/app/(app)/admin/users/page.tsx:1` | Sibling under `/admin/`, same Server-Component-then-pass-to-client-list shape. `requireAdmin()` at top. Loads `loadAdminPeople()` + the same dealer/lookup data the Add/Edit form needs. |
| `src/features/people/people-admin.tsx` (Client Component) | `src/features/auth/users-admin.tsx:47` (`UsersAdmin`) for the table + dialog shell, **plus** `src/app/(app)/lists/coach-form.tsx:1` for the firstName/lastName/specialty/email/phone field shape. | Folds the two existing UIs into one. The Add Person dialog's checkboxes (`App access`, `Admin`, `Coach`) borrow from the existing `RolesForm` checkbox layout. |
| `src/app/(app)/admin/users/page.tsx` modification (redirect to `/admin/people`) | `src/app/page.tsx:1` (root page redirect) | Match the existing `redirect('/calendar')` pattern. Keep for ~1 release as muscle-memory grace, then delete. |
| `src/components/app/app-nav.tsx` modification (Users → People label) | self — same file, existing `<NavLink href="/admin/users">Users</NavLink>` line | One-line rename. |
| `src/app/(app)/lists/page.tsx` modification (remove Sales Coaches section) | self — existing `Sales Coaches` block | Delete the section. The Manage Lists page becomes Dealerships-only (which matches its primary purpose; coaches were the odd-one-out). |
| Vitest tests for `createPerson` / `updatePerson` / `archivePerson` | `src/features/auth/actions.test.ts:1` | Same mock shape (the queue-based Drizzle mock added by 0018). New cases: app-access toggle on/off, role-set + dealer-link sync in one transaction, rollback on `auth.admin.createUser` failure. |

**Conventions referenced:**
- `docs/wiki/auth.md` — Two-surface model (`app_metadata.role` + `team_member_roles`); `requireAdmin()` defence-in-depth; the auto-link trigger that still fires on `auth.users` insert (preserved untouched by this chunk).
- `docs/wiki/data-model.md:23-29` — Master `contacts` table + role-junction model; `:178` for `contacts.user_id` semantics. The unification *is* this wiki page rendered as UI.
- `docs/wiki/lifecycle.md` — Archive the relationship (`team_member_roles`), not the master record (`contacts`). `archivePerson` follows this strictly.
- `docs/wiki/conventions.md` — Server Actions for our-UI mutations; the new actions are no exception. Service-role admin SDK stays server-only.

**Overall Progress:** 80% (4/5 phases complete)

**Note:**
- Phase 2 is the load-bearing one — the merged transaction has to roll back cleanly across the contacts + identifiers + roles + auth-user create, plus optional dealer links. Auth-user create goes last so a Drizzle failure rolls back without leaving an orphan.
- This is a UI + actions refactor; no schema migration. Existing data (David, Shannon, Tilley) lands on the new page as-is.
- Phase 4's redirect from `/admin/users` to `/admin/people` is muscle-memory grace, scheduled for one-release deletion in a future cleanup chunk.

### Phase Checklist

#### Phase 1: `loadAdminPeople` query + types
- [x] `src/features/people/queries.ts` — new file. `loadAdminPeople(): AdminPersonRow[]` queries `contacts` (spine) + bulk reads `team_member_roles`, `dealer_contacts ⋈ dealers`, primary `contact_identifiers`, then plucks the auth-user facet from a single `auth.admin.listUsers()` round-trip filtered to linked `user_id`s. Sorted by `displayName`.
- [x] `AdminPersonRow` type — `{ contactId, displayName, email, phone, hasAppAccess, authUser: { userId, email, lastSignInAt, bannedUntil, providers, appMetadataRole } | null, roles: TeamMemberRole[], dealerLinks: { dealerId, dealerName, role }[] }`. `email` falls back to the linked auth-user email when no primary identifier exists. (Slightly flatter than the original sketch — `identifiers: { email?, phone? }` collapsed into top-level `email` / `phone` since the page only ever needs the primary.)
- [x] Vitest: 6 cases — empty contacts list, Shaye state (contact + identifier, no auth user), David state (contact + auth user + admin role + email+phone), dealer-only customer-side person, magic-link auth user with no identities array (provider fallback to `['email']`), `admin.listUsers` error propagation.

#### Phase 2: `createPerson` + `updatePerson` + `archivePerson` Server Actions
- [x] `src/features/people/actions.ts:createPerson` — `requireAdmin()`, parses firstName, lastName, optional email/phone, `appAccess: bool`, `roles[]`, `dealerLinks[]` (encoded as `<dealerId>:<role>`). Single Drizzle transaction (contact + identifiers + roles + dealer links), then `auth.admin.createUser` + conditional `UPDATE contacts SET user_id = ... WHERE id = ? AND user_id IS NULL` + `app_metadata.role` sync. Auth-side failure returns partial-success error (the contact row remains, admin can retry from Edit Person).
- [x] `updatePerson` — `requireAdmin()`, parses contactId + the same field set, validates the contact is unarchived, runs one transaction over all facets, then handles the four `appAccess × user_id` quadrants in the auth-side step: off→on provisions, on→off bans (Supabase soft-delete idiom), already-on syncs `app_metadata.role` to the role set, already-off no-ops. `contacts.user_id` is *not* dropped on the on→off transition — the FK preserves audit-column history (`actor_id` references on existing rows).
- [x] `archivePerson` — `requireAdmin()`, refuses self-archive, archives `team_member_roles` + `dealer_contacts` in one transaction, bans the linked auth user if any. **Does not archive the contacts row** (per [`docs/wiki/lifecycle.md`](../../wiki/lifecycle.md) — historical FKs keep resolving).
- [x] Helpers folded in: `swapPrimaryIdentifier` (duplicated from `schedule/actions.ts:718` for now; Phase 4 retires the schedule copy), `syncTeamMemberRoles`, `syncDealerLinks`, `syncAuthMetadata`, `IdentifierConflictError` + `toActionResult`, `parseRolesField`, `parseDealerLinksField`. All inside `actions.ts` for the moment; can extract on demand.
- [x] Vitest 24 cases — admin-gate, name validation, email validation, role-without-app-access rejection, unsupported-role rejection (`staff`), app-access-without-email rejection, malformed dealer link, invalid dealer-contact role, no-app-access happy path, full create+admin+auth happy path, partial-success on `auth.admin.createUser` failure, **createPerson race-loss compensating ban (Codex High follow-up)**, **createPerson trigger-won link is no-op**, updatePerson admin gate, missing contact, archived contact, off→on transition provisions auth user, **off→on race-loss compensating ban**, **stale-UI roles=coach + appAccess=off coerces roles to []**, on→off bans, archivePerson admin gate, archivePerson self-archive guard, archivePerson preserves contacts row + bans auth user, archivePerson no-auth-user no-op.
- [x] TOCTOU follow-up commit: conditional `UPDATE contacts SET user_id = ? WHERE id = ? AND user_id IS NULL RETURNING id` on both `createPerson` (trigger-won case treated as same outcome) and `updatePerson` off→on (race loser bans the just-created auth user). Force `roles = []` when `appAccess = false` in `updatePerson` so a stale UI submission can't leave a dangling `team_member_roles(role='coach')` paired with a banned auth user.

#### Phase 3: `/admin/people` page + Add/Edit Person dialog
- [x] `src/app/(app)/admin/people/page.tsx` — Server Component, `requireAdmin()`, `Promise.all` over `loadAdminPeople()` + `loadDealers()`. (`loadUnlinkedContacts` was dropped — the unlinked-contacts panel concept was retired in the plan Decision 3 update; orphan-auth-users handling lands separately in Phase 4.)
- [x] `src/features/people/people-admin.tsx` — table: Name / Email (identifier or auth fallback) / Roles chips (incl. `app` chip when app access is on) / Dealers chips (`<dealer name> · <role>`) / Last sign-in (when app access) / Status (active / banned / archived). 30 people render correctly in dev.
- [x] Add Person dialog: `firstName`, `lastName`, `email`, `phone`, `App access` checkbox, `Admin` + `Coach` checkboxes (disabled when no app access), `+ Link dealer` panel that adds dealer/role rows with a `✕` per-row remove. Form-level guards reject unsupported combos client-side; server still validates.
- [x] Edit Person dialog: same form, prefilled from the row. Toggling App access off→on at submit time triggers the off→on path in `updatePerson` (which is TOCTOU-safe per the Phase 2 fix).
- [x] Per-row Archive (`✕`) — confirms with a clear message ("relationships archived; contact stays for historical references"), calls `archivePerson`, refreshes.
- [x] Nav: added `People` link alongside `Users` in `app-nav.tsx`. Phase 4 retires `Users`.
- [x] Smoke (web-test) — `/admin/people` 200, heading "People", "Team & contacts" subhead, "+ Add Person" button. Dialog opens with First name / Last name / Email / Phone / App access / Admin / Coach / dealer panel. Screenshots `/tmp/web-test-people-list.png` + `/tmp/web-test-people-dialog.png`.
- [x] Eval follow-up: Codex flagged two blockers — both fixed in working tree before commit:
   - **Lifecycle status helper** — replaced `isActive` (which only knew about auth bans) with a three-state `lifecycle()` derivation: `active` (any live facet), `banned` (auth user banned), `inactive` (no auth, no roles, no dealer links). Status chip + Archive button visibility both drive off this. A contact-only person archived now correctly drops to `inactive` and hides the Archive button.
   - **Partial-success contract** — `ActionResult` is now `{ ok: true, contactId, warning?: string } | { error: string }`. DB-committed-but-auth-side-failed cases (`auth.admin.createUser` fail, `auth.admin.updateUserById` ban fail, `syncAuthMetadata` fail) return `{ ok: true, warning }` so the UI can close + refresh + surface a warning toast. The race-loss errors keep the `{ error }` shape but now revalidate before returning so the table reflects the post-compensation state when the admin retries. Test for the partial-success case updated to expect the new shape; full suite still 111/111.

#### Phase 4: Retire Sales Coaches + redirect `/admin/users`
- [x] `src/app/(app)/admin/users/page.tsx` — now a 4-line redirect to `/admin/people`. Kept as a breadcrumb for one transitional release; future cleanup will delete the file.
- [x] `src/components/app/app-nav.tsx` — "Users" tab removed. "People" remains (added in Phase 3).
- [x] `src/app/(app)/lists/page.tsx` — Sales Coaches section deleted. Page is now Dealerships-only with a one-line pointer to /admin/people for "people (including coaches)."
- [x] `src/app/(app)/lists/list-actions.tsx` — `AddCoachButton` + `CoachRowActions` removed; imports trimmed.
- [x] `src/app/(app)/lists/coach-form.tsx` — file deleted.
- [x] `src/features/schedule/actions.ts` — `createCoach`, `updateCoach`, `archiveCoach` deleted (one-comment placeholder remains pointing at the People page). `loadCoaches` (read path) untouched. Unused `EMAIL_RE` import trimmed.
- [x] `src/features/auth/actions.ts` — file rewritten as login-only (`signInWithGoogle`, `signInWithMagicLink`, `signOut`). `createUser`, `linkUserToContact`, `setUserRoles`, `deactivateUser` and the helpers `applyRoleSet` + `parseRolesField` deleted along with `revalidateUserAdmin`.
- [x] `src/features/auth/users-admin.tsx` — file deleted (only consumer of the removed actions).
- [x] `src/features/auth/queries.ts` — file deleted (only consumers — `users-admin.tsx`, the legacy admin page — are gone).
- [x] `src/features/auth/actions.test.ts` — file deleted (tested the removed actions; coverage moved to `src/features/people/actions.test.ts`).
- [x] `scripts/adopt-orphan-auth-users.ts` — one-time CLI. Default lists orphans (dry-run); `--auto` adopts each with stub names (`firstName=<email-local-part>`, `lastName=(orphan <uuid-prefix>)`). Idempotent. Admin can rename via Edit Person.
- [x] `/admin/people` modification — small `<OrphanAuthUsers />` panel renders only when `loadOrphanAuthUsers` returns rows. Each row has an Adopt dialog (firstName + lastName) that calls `adoptOrphanAuthUser`. Hidden in the steady state.
- [x] `src/features/people/actions.ts:adoptOrphanAuthUser` — new Server Action, `requireAdmin`, refuses if a contact is already linked, otherwise transactional contacts insert + email identifier swap.
- [x] `src/features/people/queries.ts:loadOrphanAuthUsers` — single `auth.admin.listUsers` round-trip + LEFT-anti-join via in-memory set difference against `contacts.user_id`.
- [x] Smoke (web-test): `/admin/users` → 307 → `/admin/people`. `/lists` shows only Dealerships ("People (including coaches) live on the People page"). `/admin/people` 200, no orphan panel rendered (all auth users currently linked). Nav: Calendar / Production List / Manage Lists / Lookups / People — no Users tab. `/calendar` → "Master Schedule" intact (regression).
- [x] Tests: 100/100 (was 111; -11 for the deleted `src/features/auth/actions.test.ts` which tested the removed actions). tsc clean. lint clean (4 pre-existing warnings).
- [x] Eval follow-up — Codex flagged two Mediums as commit-blockers, both fixed in working tree:
   - **`adoptOrphanAuthUser` UUID validation + Postgres error mapping.** `userId` now goes through a `UUID_RE` regex check, then `toActionResult` maps codes `22P02` (invalid UUID), `23503` (FK to missing auth user), `23505` (race-into unique-index) to admin-readable toasts instead of bubbling raw constraint errors.
   - **`scripts/adopt-orphan-auth-users.ts --auto` per-orphan transaction.** Wrapped contact insert + email-identifier insert in `db.transaction(...)` so an identifier-uniqueness conflict rolls back the stub contact (which would otherwise silently link the auth user and hide it from future dry-runs). Per-orphan errors are now caught + logged so one failure doesn't abort the batch.

#### Phase 5: Wiki updates + verification
- [ ] Rewrite `docs/wiki/auth.md` provisioning section — `/admin/people` is the new entry point; the dashboard fallback line stays.
- [ ] Update `docs/wiki/data-model.md` — wiki narrative already says "one master `contacts` table, role facets" but mentions Sales Coaches as a separate page. Bring the page-level vocabulary in line.
- [ ] Append to `docs/wiki/log.md` — dated entry for the unification.
- [ ] `pnpm tsc --noEmit` clean.
- [ ] `pnpm test` clean.
- [ ] /eval against `0020-people-unification/plan.md`.
- [ ] Smoke (web-test) end-to-end:
  - `goto /admin/people`: heading "People", table populated with David / Shannon / Tilley; per-row Edit + Archive.
  - Click `+ Add Person`: dialog "Add Person" with `First name` / `Last name` / `Email` / `Phone` / `App access` / `Admin` / `Coach` / dealer picker.
  - As non-admin: `goto /admin/people` redirects to `/auth/auth-error` (the durable layout gate from 0018 still bouncing non-staff is a separate matter).
  - `goto /lists`: only Dealerships section; no Sales Coaches.
  - `goto /calendar`: coach pre-filter + coach pills still work.

## Out of scope (explicitly)

- **`profiles` table.** Not introduced. `team_member_roles` + `app_metadata.role` already do the job (0018 decision).
- **Schema migration.** None needed.
- **Dealer page rewrite.** The dealer detail UI keeps its existing contact-edit affordance. We're not collapsing dealer-detail into people-detail.
- **Self-service profile editing.** Non-admins can't edit their own row from `/admin/people` — that's a future "My Profile" surface, separate from admin tooling.
- **Bulk import.** The existing `scripts/import-from-sheets.ts` flow is unchanged; it writes contacts/dealers/team_member_roles directly via Drizzle, bypassing the new actions.
- **Permanent deletion.** `archivePerson` is soft. Right-to-be-forgotten is open Q #10 in `data-model.md` and stays out of scope here.
- **Renaming `dealer_contacts.role` enum value `staff`** (Q #3 collision). Cosmetic, separate.
