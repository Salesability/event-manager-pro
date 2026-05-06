# People — Dealer Role + Required-Role Invariant

**Started:** 2026-05-06

## Progress Tracker

| Phase | Status | Commit |
|-------|--------|--------|
| 1: Schema — add `dealer` to `team_member_role` enum + parser whitelist | Done | - |
| 2: Backfill — assign `dealer` to existing roleless contacts with a dealer link | Pending | - |
| 3: PersonForm UI — Dealer checkbox + gate Dealers section + require ≥1 role | Pending | - |
| 4: Auto-assign — `createDealer` / `updateDealer` insert `team_member_roles(dealer)` | Pending | - |
| 5: Invariant — DB trigger or app-level guard for "every contact has a role" | Pending | - |
| 6: Tests + smoke verification | Pending | - |

Today the system has two disjoint role surfaces — `team_member_roles` (us-side: `admin`/`coach` live; `staff`/`viewer` reserved) and `dealer_contacts` (them-side: `customer`/`staff`/`prospect`). Dealer staff land in `dealer_contacts` with NO `team_member_roles` row, so they're "roleless" from the People-admin perspective. This chunk closes that gap by introducing a `dealer` role on `team_member_roles`, backfilling existing dealer-side contacts onto it, and enforcing "every person has at least one role" both at the form level and (TBD Phase 5) at the DB level. The Person edit dialog's Dealers section becomes conditional on the `dealer` role, so the link UI matches the person's classification instead of being a free-floating panel on every record.

## Code Anchors

For each new file or method below, the builder reads the anchor first and matches its shape (length, error handling, naming, query style). For modifications to an existing file, the anchor is the nearest sibling method in that same file.

| New code | Anchor (`path:line`) | Why this anchor |
|----------|---------------------|-----------------|
| `drizzle/0004_team_member_role_add_dealer.sql` (enum addition migration) | `drizzle/0003_enable_rls.sql` | Same series, idempotent SQL migration that the build pipeline already picks up — match the header comment style and statement-batching shape |
| Update `team_member_role` pgEnum in `src/lib/db/schema/team-member-roles.ts:5-10` | same file (in place) | One-line enum extension; the literal at line 5-10 is the canonical source — every other type derives from it |
| Update `V1_TEAM_ROLES` whitelist in `src/features/people/actions.ts:27` + `parseRolesField` (line 89-97) | same file (in place) | Single-source list controls what `createPerson` / `updatePerson` accept; widening it is a one-line change that flows through `V1TeamRole` everywhere it's referenced |
| Backfill query (Phase 2) — TS script under `scripts/backfill-dealer-role.ts` | `scripts/calendar-clamp-smoke.ts` | Same idempotent-tag pattern (re-runnable, narrates what it did, exits non-zero on partial failure); avoids hard-coded SQL in a migration so the user can review the rowset before it lands |
| Dealer checkbox + gate logic in `PersonForm` at `src/features/people/people-admin.tsx:433-507` | same file, the existing Admin/Coach checkboxes (lines 437-456) | Mirror the markup, state hook (`useState<boolean>`), and form-data wiring (`name="roles"` repeated input) of Admin/Coach so the new control reads as a sibling, not a special case |
| `createDealer` patch (insert `team_member_roles(role='dealer')`) in `src/features/schedule/actions.ts:60-124` | `src/features/people/actions.ts:syncTeamMemberRoles` (uses `tx.insert(teamMemberRoles)` inside the same transaction) | Same transaction shape, same `createdById`/`updatedById` actor wiring; just one row insert added after the `dealer_contacts` insert at line 105-112 |
| Phase 5 invariant — DB trigger OR app-level guard | `drizzle/0002_contact_user_backfill_trigger.sql` (if trigger route) **OR** `requireAdmin` pattern in `src/lib/auth/require-admin.ts` (if app-level) | Same migration shape if trigger; same single-purpose helper if app-level. The plan picks one in Phase 5 — see Open Questions |

**Conventions referenced:**
- `docs/wiki/data-model.md` — role taxonomy and the "team_member_roles vs dealer_contacts.role" distinction. Update this page in the same chunk that adds `dealer` so the wiki stays current.
- `docs/wiki/auth.md` — hybrid role storage (auth.users.app_metadata + team_member_roles). The `dealer` role does NOT need to land in `app_metadata.role` (that field gates admin only); confirm and document in the wiki.
- `docs/designs/shipped/0018-user-system/plan.md` — locks the role-taxonomy decisions this plan extends; read before touching `parseRolesField` or auth-metadata sync.

**Overall Progress:** 17% (1/6 phases complete)

**Note:**
- Each phase includes both implementation and tests
- Integration tests come last, after all phases pass (verifies real DB behavior)
- Migration ordering — Phase 1's `0004_*.sql` lands AFTER `0019-security-architecture` Phase 1's `0003_enable_rls.sql` (already shipped, SHA `ae3dbe3`). No conflict; the two streams touch disjoint DDL.

### Phase Checklist

#### Phase 1: Schema — add `dealer` to `team_member_role` enum + parser whitelist
- [x] Add `'dealer'` to the `teamMemberRole` pgEnum literal at `src/lib/db/schema/team-member-roles.ts:5-10`. **Done.**
- [x] Generate (or hand-write, matching `0003_enable_rls.sql` style) `drizzle/0004_team_member_role_add_dealer.sql` containing `ALTER TYPE team_member_role ADD VALUE IF NOT EXISTS 'dealer';`. **Done — actual filename `drizzle/0005_team_member_role_add_dealer.sql`.** The plan's assumed `0004_*` was already taken by 0019 Phase 4 (`0004_worthless_titanium_man.sql`); bumped to 0005. `IF NOT EXISTS` clause hand-added to the drizzle-kit-generated `ALTER TYPE` for idempotency. Journal entry's `tag` updated from the auto-generated `0005_woozy_kabuki` and `when` bumped past 0004's so the migrate runner picks it up. Applied cleanly to dev DB; `select enumlabel from pg_enum where enumtypid='public.team_member_role'::regtype` returns 5 values including `dealer`.
- [x] Extend `V1_TEAM_ROLES` in `src/features/people/actions.ts:27` to `['admin', 'coach', 'dealer']`. **Done.**
- [x] Update `parseRolesField` error copy (line 93) to reflect the new whitelist. **Done — "admin, coach, dealer only".** The matching unit test in `src/features/people/actions.test.ts:167` updated in the same pass.
- [x] Update `syncTeamMemberRoles` (line ~203) and the desired-roles diffing logic so a `dealer` row participates in the upsert/archive cycle alongside `admin`/`coach`. **Done implicitly** — the `(V1_TEAM_ROLES as readonly string[]).includes(r.role)` filter at the archive step now treats `dealer` as a v1 role, so dealer rows participate in the diff. `staff` and `viewer` rows still skip archiving as before. **Note for Phase 2 sequencing:** until Phase 3's UI checkbox lands, `parseRolesField` returns at most `['admin', 'coach']` from the form; if Phase 2 backfills dealer rows BEFORE Phase 3 ships the checkbox, an admin saving a dealer-side person would archive the freshly-backfilled dealer row. Mitigation: ship Phase 3 (UI) before Phase 2 (backfill), or ship the trio (1+2+3) in close succession. **Also surfaced:** `src/lib/auth/load-team-membership.ts:8` had a hand-written `TeamMemberRole = 'admin' | 'staff' | 'coach' | 'viewer'` union that didn't include `dealer`; widened in the same pass.
- [x] **Codex High fixed in-eval — `dealer` aliased to staff in `is_staff_member()` and `requireStaffAccess()`.** Adding `dealer` to the enum without filtering it out of the staff-app role set meant a dealer-only `team_member_roles` row would have passed `requireStaffAccess()` (route gate), the auth callback's role check (so they'd land on `/calendar`), AND `is_staff_member()` in the SQL helper — meaning RLS's `<table>_staff_all` policy would return all rows to a dealer-side user. Closed by: (1) new exported `STAFF_APP_ROLES = ['admin','staff','coach','viewer']` constant + `isStaffAppRole()` helper in `src/lib/auth/load-team-membership.ts`; (2) `requireStaffAccess()` now checks `membership.roles.some(isStaffAppRole)` instead of `roles.length > 0`; (3) `src/app/auth/callback/route.ts` mirrors the same filter; (4) new `drizzle/0006_is_staff_member_excludes_dealer.sql` rewrites the SQL helper with a `tmr.role IN ('admin','staff','coach','viewer')` whitelist. Applied to dev DB; verified `is_staff_member()` returns false for a forged user with no rows. **New regression guard test** in `src/app/auth/callback/route.test.ts` asserts a `roles=['dealer']` user lands on `/auth/auth-error?reason=Portal+not+yet+available`, not the staff app. Now 145/145 vitest.
- [x] Tsc + lint clean; existing people-admin unit tests still pass. **144/144 vitest, tsc clean, lint clean (4 pre-existing warnings).**

#### Phase 2: Backfill — assign `dealer` role to existing roleless contacts with a dealer link
- [ ] Write `scripts/backfill-dealer-role.ts` (anchored on `scripts/calendar-clamp-smoke.ts`): for every `contacts.id` that has a non-archived `dealer_contacts` row AND zero non-archived `team_member_roles` rows, insert `team_member_roles(role='dealer', specialty=null, createdById=<system actor>, updatedById=<system actor>)`
- [ ] Idempotent — re-running the script after success is a no-op (uses the existing `team_member_roles_contact_id_role_unique` index)
- [ ] Dry-run mode that prints the affected `contactId`s + dealer names before any insert; user reviews the list before live run
- [ ] Report any *other* roleless contacts (no team_member_roles AND no dealer_contacts) as a separate "needs human triage" list — these are the truly orphaned rows that Phase 5 has to reckon with
- [ ] Run the dry-run, hand the list to the user, then run live

#### Phase 3: PersonForm UI — Dealer checkbox + gate Dealers section + require ≥1 role
- [ ] Add `dealer` state + checkbox to the Roles fieldset at `src/features/people/people-admin.tsx:433-457` (mirror the Admin/Coach controls verbatim — same markup, same state hook, same `name="roles"` repeated input wiring)
- [ ] Wrap the Dealers section (`src/features/people/people-admin.tsx:459-507`) in `{dealer && (…)}` — when the role is unchecked, the section is gone, and any pending `dealerLinks` are cleared on uncheck (so the form doesn't submit stale rows)
- [ ] Form-level guard: Save button disabled (or `<form noValidate>` with a friendly inline error) when `!admin && !coach && !dealer`. Match the existing pending-state pattern at `src/features/people/people-admin.tsx:511-519`
- [ ] Edit-mode default: `dealer` checkbox `defaultChecked` from `person.roles` already containing `'dealer'`
- [ ] Decide checkbox ordering and copy: "Dealer" label, helper text "External dealer-side contact" (TBD — confirm with user during Phase 3)
- [ ] Test: open Add Person → no roles selected → Save disabled; tick Dealer → Dealers section appears and Save enables; tick Dealer + Coach → both sections coexist (until the mutual-exclusion question is decided — see Open Questions)
- [ ] Test: edit an existing dealer-side person (post-Phase-2 backfill) → dealer ticked, Dealers section visible with their links

#### Phase 4: Auto-assign — `createDealer` / `updateDealer` insert `team_member_roles(dealer)`
- [ ] In `createDealer` (`src/features/schedule/actions.ts:60-124`), after the `dealer_contacts` insert at line 105-112, insert a `team_member_roles` row with `role='dealer'` for the same `contactId`. Same transaction. Use the existing `userId` for `createdById`/`updatedById`
- [ ] In `updateDealer` (`src/features/schedule/actions.ts:126-...`), the "create new contact when staff link missing" branch (around line 186-...) — same insert
- [ ] Re-confirm the audit-actor wiring (the schedule actions pre-date 0018's actor cleanup; ensure consistency with people/actions.ts)
- [ ] Test: create dealer with a primary staff contact → contact has 1 row in `team_member_roles` with `role='dealer'`
- [ ] Test: edit dealer to add a brand-new primary staff contact → same row created
- [ ] Test: editing an EXISTING staff link's name does NOT duplicate the `team_member_roles` row (uniqueness index already protects, but verify the action handles the conflict gracefully)

#### Phase 5: Invariant — DB trigger or app-level guard for "every contact has a role"
- [ ] **Decide route** (Open Question, see below): DB trigger that rejects a `contacts` row without a corresponding `team_member_roles` row, vs. app-level enforcement only via `parseRolesField` rejecting empty + `createDealer` always inserting
- [ ] If DB-level: write `drizzle/0005_contact_role_required_trigger.sql` matching the shape of `drizzle/0002_contact_user_backfill_trigger.sql` — deferrable trigger that fires `AFTER` insert/update on `contacts` and checks for a non-archived `team_member_roles` row
- [ ] If app-level: document the boundaries in `docs/wiki/data-model.md` and add a single helper that asserts the invariant in any new contact-creating action
- [ ] Either route: handle the "needs human triage" list from Phase 2 — orphaned roleless contacts must either be assigned a role, archived, or deleted before this lands, or the trigger will reject any update to them

#### Phase 6: Tests + smoke verification
- [ ] Unit test for `parseRolesField` accepting `dealer`, rejecting unknown
- [ ] Unit test for the form-level guard (no roles → Save disabled)
- [ ] Service-level integration test: `createDealer` with a primary contact → assert `team_member_roles` has a `dealer` row
- [ ] Service-level integration test: `updatePerson` flipping admin off and dealer on → assert old admin row archived, new dealer row inserted
- [ ] Smoke (web-test): `goto /admin/people`; click "Add Person"; tick Dealer; expect the Dealers section to appear with "+ Link dealer" button and "No dealer relationships." empty state
- [ ] Smoke (web-test): with Dealer unticked, expect the Dealers section absent
- [ ] Smoke (web-test): with no roles ticked, Save button shows disabled state (no destructive submit attempted on the gated route)
- [ ] Smoke (web-test): edit a known dealer-side person (post-backfill) → dealer ticked, Dealers section populated. Read-only on this surface — do NOT submit changes

## Open questions (resolve as the chunk progresses)

- **Mutual exclusion?** Should `dealer` be mutually exclusive with `admin`/`coach` (a person is either us-side or them-side, not both), or can a hybrid exist (e.g. an outside consultant who's also coaching for us)? **Working assumption:** allow combinations in the schema, but the form treats `dealer` + (`admin`|`coach`) as a "are you sure?" confirm rather than blocking. Revisit before Phase 3 lands.
- **Customer role too?** Per the project memory, clients (companies) have contacts (people) — should those contacts also get a `customer` role on `team_member_roles`? This plan does NOT add `customer`; the user's request named only `dealer`. If the answer turns out to be yes, it's a sibling chunk that copies this plan's shape (enum addition + backfill + form gate on the Clients section). Confirm with user before Phase 1.
- **DB-level invariant?** Phase 5 picks one route. Trade-off: trigger is bulletproof but couples migrations to backfill ordering and complicates teardown of test fixtures; app-level is simpler but relies on every contact-creating path remembering to insert a role row. **Working lean:** DB trigger, gated on Phase 2 backfill being clean. Decide before Phase 5 starts.
- **Migration ordering vs. 0019.** 0019 Phase 1 (`0003_enable_rls.sql`, SHA `ae3dbe3`) already shipped. This chunk's `0004_*.sql` lands cleanly after it. No coordination needed unless 0019 ships another DDL phase (Phases 2–6 are RLS-policy + audit-log work, not enum changes) — re-check the active 0019 phase before merging Phase 1.
- **What does "App access" mean for a dealer role?** Today, "Admin or Coach role implies app access — convention now: 'everyone who needs APP gets it by default, except dealer staff'" (per the 0021 history note). A `dealer`-only role should NOT auto-create an auth.users row. Confirm: `syncAuthMetadata` (actions.ts:301) should treat `dealer` as a no-op for app access, same as if zero roles were present. Belongs in Phase 1 or 3.
