# Proper user system — provisioning, RBAC, contact linkage, role-aware routing

**Started:** 2026-05-05

The repo already has the *data model* for a real user system — `contacts.user_id` (nullable UNIQUE FK to `auth.users`), `team_member_roles` (admin / staff / coach / viewer), `dealer_contacts` (customer-side relationships), all wired in `docs/wiki/data-model.md:9-29`. What's missing is the *application wiring*: `src/proxy.ts` gates only "logged in vs not", there is no `requireAdmin()`, no `/admin/users` UI, no contact↔user linkage on signup, no role-aware routing after callback, and no coach auto-filter on `/calendar` (which legacy `deprecated/index.html` did at line 702-710 of `doLogin()`). This plan closes that gap end-to-end. **Done =** an admin can provision a user *and* link them to a `contacts` row + `team_member_roles` row in a single flow; non-admins can't reach `/admin/*`; a signed-in coach lands on `/calendar` already filtered to their own bookings; an unrecognised auth.users post-callback gets a clean error rather than a half-rendered staff app; the `auth.md` wiki "RBAC" open item is resolved.

This plan **subsumed** [`docs/designs/shipped/0017-user-admin/plan.md`](../shipped/0017-user-admin/plan.md). 0017 covered provisioning + `app_metadata.role` + `requireAdmin()` — the foundation here. It was parked and unstarted, so its content folded into Phase 1 below; 0017 moved to `shipped/` on 2026-05-05 with a supersession note.

## Decisions

1. **Role storage is hybrid, not either/or.** Two independent surfaces serve two different jobs:
   - **`app_metadata.role`** (Supabase) — single string on the JWT. Cheap to read in middleware / on every request via `supabase.auth.getUser()` with no DB hit. **Used for the broad-strokes gate**: is this user an admin? Should `/admin/*` even respond?
   - **`team_member_roles`** (Postgres, already exists) — N rows per contact, richer. **Used for per-feature semantics**: who is a coach (and which contact is the coach record for the current auth user)? Multiple roles per person allowed (admin + coach is a valid combo).
   - The two are **kept consistent** at write time: when an admin promotes a user to `admin`, both `app_metadata.role = 'admin'` AND a `team_member_roles(role='admin')` row are written in the same Server Action. Drift is possible but not load-bearing — `app_metadata` is the source of truth for the gate; `team_member_roles` is the source of truth for the relationship.

2. **No new `profiles` table.** The data-model wiki already names `team_member_roles` as the staff-side role table (and `contacts` as the master person record). `auth.md:74` mentions a `profiles` table — that's wiki drift; resolve it in Phase 6 by removing the `profiles` mention rather than building one.

3. **Subsume 0017, don't run alongside.** 0017 is unstarted. Its scope (provisioning UI, `app_metadata.role`, `requireAdmin()`, bootstrap script) is Phase 1 of this plan verbatim. After 0018 is active in `CURRENT.md`, the 0017 folder ships to `shipped/` with a one-line plan-body addendum noting supersession. No content duplication.

4. **Portal routing is *decided* but not *built* here.** The post-callback router (Phase 5) implements the full decision tree (staff role → `/`; contact-only → portal; neither → `/auth/auth-error`). The contact-only branch redirects to `/auth/auth-error?reason=Portal+not+yet+available` until the portal route exists. This costs ~5 lines and makes the day-portal-ships change a one-line route swap rather than a routing rewrite.

5. **Bootstrap.** The first admin (`david.hogan@networknode.ca`) gets `app_metadata.role = 'admin'` via a one-shot script run locally with the service-role key. Subsequent admins are promoted via the new UI. Documented in Phase 1 + the wiki update in Phase 6.

6. **Role taxonomy — two sides, four identity models.** The schema already encodes this; what 0018 locks in is *which roles actually do something in v1*.

   **Us-side (`team_member_roles.role`):**

   | Role | v1 wiring | Distinct behaviour |
   |---|---|---|
   | `admin` | **Live** — `app_metadata.role = 'admin'` + `team_member_roles(role='admin')` written together. Unlocks `/admin/*` (user mgmt, lookups). | Yes — gate on every admin route + action. |
   | `coach` | **Live** — `team_member_roles(role='coach')`. Triggers calendar auto-filter (Phase 4) and is the coach-share-link audience. | Yes — calendar pre-filter; can email own share link. |
   | `staff` | **Reserved** — enum value stays in the schema, but no row is written by the v1 admin UI. ~~The default for any signed-in non-admin (no `team_member_roles` row at all) IS the "staff" experience.~~ **Updated 2026-05-05 (eval follow-up):** the staff-app gate now requires a `team_member_roles` row OR `app_metadata.role === 'admin'` — the "no role = implicit staff" default was a Codex Critical (post-callback URL bypass). Use `coach` for coaches; admins use `admin`; reserve `staff`/`viewer` for explicit future wiring. | No — wire when "staff vs viewer" matters. |
   | `viewer` | **Reserved** — same status as `staff`. Wire when a real read-only stakeholder shows up (e.g., a finance manager who needs visibility but not edit access). | No. |

   **Them-side (`dealer_contacts.role` + optional `contacts.user_id`):** these gate **portal** access, not staff app. 0018 doesn't ship the portal — Phase 5 routes them-side users to a placeholder. The taxonomy is locked here so the portal plan inherits it.

   | Role | v1 wiring | Portal access |
   |---|---|---|
   | `customer` | Existing schema; no 0018 changes. | **Yes (future)** if `contacts.user_id` set. Sees own dealer's campaigns + Quote/Contract/Invoice/Payment row(s), redacted of coach fees and internal notes. |
   | `staff` | Existing schema; no 0018 changes. | Maybe (future) — same gate (`user_id` populated). |
   | `prospect` | Existing schema; no 0018 changes. | No login; pure contact data. |

   **Identity model #4: per-coach share links (`/share/coach/[id]`).** Tokenless, no `auth.users` row at all — sits *outside* the role taxonomy. Already shipped (port-views Phase 4). Don't try to fold it in; it's intentionally low-friction legacy parity.

   **Routing rule (locked, implemented in Phase 5):**
   - Has any `team_member_roles` row → staff app at `/` (the gate later inspects `app_metadata.role` for `/admin/*`).
   - No `team_member_roles`, has `dealer_contacts` row(s) → portal (placeholder until portal ships).
   - Has populated `user_id` but neither — defensive error; shouldn't happen with signups disabled.

   **A single contact can have rows in both tables** (per `data-model.md:27`). Routing precedence: any us-side role wins → staff app. The portal wouldn't show their own dealer to them anyway.

   **Out-of-scope for 0018 (call-outs):** the portal redaction model (which campaign fields a `customer` sees vs hides — coach fees, internal notes) is a portal-plan decision, not this one. Phase 5 just routes them somewhere; what they see when they get there is later.

## Progress Tracker

| Phase | Status | Commit |
|-------|--------|--------|
| 1: Provisioning + admin page (subsumes 0017) | Done | working tree |
| 2: RBAC enforcement — `requireAdmin()` consistently applied + admin-route gate + admin-only nav link | Done | working tree |
| 3: Contact↔user linkage — admin-add-user form picks/creates contact + role; SQL trigger to back-fill `contacts.user_id` on signup | Done | working tree |
| 4: Coach auto-filter on `/calendar` (legacy parity) | Done | working tree |
| 5: Role-aware login routing — callback decides staff vs portal vs error | Done | working tree |
| 6: Wiki updates + verification (tsc + tests + /eval + smoke) | Doc + tests done; /eval + browser smoke pending | working tree |

## Code Anchors

For each new file or method below, the builder reads the anchor first and matches its shape (length, error handling, naming, query style). For modifications to an existing file, the anchor is the nearest sibling method in that same file.

| New code | Anchor (`path:line`) | Why this anchor |
|----------|---------------------|-----------------|
| `src/lib/supabase/admin.ts` (service-role client) | `src/lib/supabase/server.ts:1` | Sibling — same factory pattern, same import shape, but uses `SUPABASE_SERVICE_ROLE_KEY` and skips cookies. **Add `'server-only'` import at the top** to make the boundary tooling-enforced. |
| `src/lib/auth/require-admin.ts` (`requireAdmin()` helper) | `src/features/schedule/actions.ts:54` (`requireUserId`) | Same shape: read user via `getUser()`, throw if missing/insufficient. Layers on top: `requireAdmin` calls `requireUserId` then checks `user.app_metadata?.role === 'admin'`. |
| `src/lib/auth/load-team-membership.ts` (server helper: `loadCurrentMembership(): { contactId, roles, coachContactId? }`) | `src/lib/supabase/session.ts:1` | Sibling — single-read server helper used by Server Components and Server Actions. Reads the current user's `contacts` row (via `contacts.user_id = auth.uid`) and any `team_member_roles` rows. Returns `null` if the auth user has no contacts row yet. |
| `scripts/promote-admin.ts` (one-shot) | `scripts/import-from-sheets.ts:1` | Sibling script — same `dotenv → service-role admin client → run` pattern. Sets `app_metadata.role = 'admin'` AND inserts a `team_member_roles(role='admin')` row pointing at the contact for that user. |
| `src/features/auth/actions.ts:createUser` (new method, file already exists) | `src/features/schedule/actions.ts:231` (`createCoach`) | Same shape: `requireAdmin()` → parse FormData → admin SDK call (`auth.admin.createUser({ email, email_confirm: true })`) → optional `linkUserToContact` in same transaction → `revalidatePath` → `ActionResult`. |
| `src/features/auth/actions.ts:deactivateUser` (new) | `src/features/schedule/actions.ts:333` (`archiveCoach`) | Soft-delete equivalent. Uses Supabase `ban_duration: '876000h'` (~100y) rather than `archivedAt`; also archives the linked `contacts` and `team_member_roles` rows in the same Server Action. |
| `src/features/auth/actions.ts:setUserRoles` (new — single action that writes the role-set) | `src/features/schedule/actions.ts:298` (`updateCoach`) | Same shape: validate, `requireAdmin()`, accept the desired role-set (e.g. `['admin', 'coach']`), write `app_metadata.role` to `'admin'`-or-absent + sync `team_member_roles` rows (insert missing, delete removed) in one transaction. v1 UI exposes only the `admin` checkbox and the `coach` checkbox; `staff`/`viewer` are reserved and not selectable. |
| `src/features/auth/actions.ts:linkUserToContact` (new — used inside `createUser`) | `src/features/schedule/actions.ts:165` (the dealer-create-with-contact transaction in `createCampaign` flow) | Same shape: optional pick-existing-contact-by-email vs create-new-contact, in a single `db.transaction` with the user-creation step. |
| `src/app/(app)/admin/users/page.tsx` (Server Component) | `src/app/(app)/admin/lookups/page.tsx:1` | Sibling under `/admin/`, same Server-Component-then-pass-to-client-list pattern. `requireAdmin()` at the top before any data load. |
| `src/app/(app)/admin/users/users-admin.tsx` (Client Component) | `src/features/schedule/lookup-admin.tsx:1` | Same shape: list rows + inline add form + per-row action button. Closest existing list-with-mutations UI. |
| `src/components/app/app-nav.tsx` modification (admin-only "Users" + "Lookups" links) | self — same file, existing `<NavLink href="/admin/lookups">Lookups</NavLink>` block | One modification, conditional on a small `isAdmin` flag passed down from the gated layout. The layout already calls `getUser()` once; thread `app_metadata.role` through. |
| `src/lib/supabase/middleware.ts` modification (admin-route gate) | `src/lib/supabase/middleware.ts:4` (existing `PUBLIC_PATHS` array literal) | Add a parallel `ADMIN_PATHS` constant + a check after the existing auth check: any path under `/admin/` requires `user.app_metadata?.role === 'admin'` or redirects to `/`. Keeps the page-level `requireAdmin()` as defence-in-depth. |
| `src/app/auth/callback/route.ts` modification (role-aware routing) | self — extend the existing `exchangeCodeForSession` block | After successful exchange, call `loadCurrentMembership()`. Branch: has `team_member_roles` rows → use `next` as before; has only `dealer_contacts` rows → redirect to `/auth/auth-error?reason=Portal+not+yet+available`; has neither (shouldn't happen with signups disabled) → `/auth/auth-error?reason=Account+not+provisioned`. |
| `src/app/(app)/calendar/calendar-view.tsx` modification (coach auto-filter) | self — `useState<number \| null>` block at line 103 | Replace the bare `useState(null)` with an initial-from-prop reading the signed-in user's `team_member_roles(role='coach')` contact id. Prop comes from a small `viewerCoachId?: number \| null` added to `CalendarView`'s public surface. The page Server Component loads it via `loadCurrentMembership()` and passes it down. |
| `src/app/(app)/calendar/page.tsx` modification (pass `viewerCoachId` to `CalendarView`) | `src/app/share/coach/[id]/page.tsx:23` (existing `Promise.all` data load) | Same Promise.all shape; add `loadCurrentMembership()` to the parallel set, pull `coachContactId` out, pass to component. |
| `drizzle/0002_contact_user_backfill_trigger.sql` (hand-written SQL migration) | `drizzle/0001_seed_lookups.sql` (sibling hand-written SQL migration) | Drizzle doesn't model triggers, so the trigger is hand-written SQL in a numbered migration file. Pattern: `BEFORE INSERT ON auth.users` → if `NEW.email` matches a `contact_identifiers(kind='email', value=NEW.email)` row, set `contacts.user_id = NEW.id` for that contact's `contact_id`. Idempotent: only sets when `contacts.user_id IS NULL`. |
| Vitest tests for `requireAdmin()`, `loadCurrentMembership()`, role-aware callback routing | `src/lib/url.test.ts:1` (existing pure-helper test pattern) and `src/features/schedule/validators.test.ts:1` (Zod-validator test pattern) | Pure functions and route handlers each have an established test shape in the repo. Mirror them. |

**Conventions referenced:**
- `docs/wiki/auth.md:18-22` — provisioning today (dashboard); `:70-83` — staff-vs-portal routing aspiration; `:93-96` — open trigger + RBAC items being closed by this plan.
- `docs/wiki/data-model.md:9-29` — `contacts` master record + `team_member_roles` + `dealer_contacts` model and the `contacts.user_id` linkage; `:187` for the `user_id` semantics.
- `docs/wiki/architecture.md` — Server Actions for our-UI mutations (createUser, promoteUser etc.); service-role key is server-only.
- `docs/wiki/conventions.md` — admin-only routes follow the same gate-at-page + gate-in-action defence-in-depth pattern.
- `db-conventions` skill — Drizzle migration generation; the hand-written trigger SQL bypasses `pnpm db:generate` and lives in a numbered file directly. Document this in Phase 3.

**Overall Progress:** 83% (5/6 phases complete)

**Note:**
- Service-role client must never be imported into a Client Component. The `'server-only'` import at the top of `src/lib/supabase/admin.ts` makes that mechanically enforced — Next throws a build error if a Client Component reaches for it.
- "Add user" defaults to `email_confirm: true` so Google auth attaches on first sign-in (the gotcha that bit the manual Shannon provisioning).
- `/admin/users` is gated **three times** — proxy/middleware (`ADMIN_PATHS`), page-level `requireAdmin()`, and every Server Action's own `requireAdmin()`. The same role string is consulted in all three. Defence in depth survives a missed gate.
- The legacy coach auto-filter in `deprecated/index.html:702-710` had a fall-through that matched coach by *display name* if `coachId` was missing on the user row. The new implementation goes through `team_member_roles(role='coach')` strictly — no name-based fallback. If a coach is missing the role row, they see the unfiltered calendar (same as today). That's the expected behaviour; document it.
- The trigger in Phase 3 is meaningful only after the signups-disabled toggle relaxes (today no random user can hit it). Even so, building it now is cheap insurance for the day a portal opens.

### Phase Checklist

#### Phase 1: Provisioning + admin page (subsumes 0017)
- [x] `src/lib/supabase/admin.ts` — `'server-only'` import, factory returning a service-role `SupabaseClient`. No cookies handling.
- [x] `src/lib/auth/require-admin.ts` — reads current user via `getUser()`, checks `user.app_metadata?.role === 'admin'`, redirects to `/login` (no user) or `/` (signed in but not admin).
- [x] `scripts/promote-admin.ts` — CLI: takes an email, sets `app_metadata.role = 'admin'` via `auth.admin.updateUserById`, writes the matching `team_member_roles(role='admin')` row. Idempotent (insert/restore/already). Optional `firstName`/`lastName` args create the contacts row + email identifier when absent.
- [x] `src/features/auth/actions.ts:createUser` — `requireAdmin`, parse FormData (email + optional roles[]), `auth.admin.createUser({ email, email_confirm: true })`, applies role-set if the email is already linked to a contact (else surfaces the "link first" hint). Phase 3 will add the inline contact picker.
- [x] `src/features/auth/actions.ts:deactivateUser` — `requireAdmin`, ban_duration `876000h` (~100y), strips `app_metadata.role`, archives linked `contacts` + `team_member_roles` in one tx. Self-deactivation guarded.
- [x] `src/features/auth/actions.ts:setUserRoles` — `requireAdmin`, accepts desired role-set, writes `app_metadata.role` (`'admin'` if `'admin'` ∈ set, else `null`) AND syncs `team_member_roles` rows (insert / restore archived / archive removed) in one transaction. v1 set is constrained to `{admin, coach}` — `staff`/`viewer` are rejected with a clear error.
- [x] `src/features/auth/queries.ts:loadAdminUsers` — joins `auth.admin.listUsers()` with `contacts` (linked by `user_id`) + `team_member_roles` so the page renders the role chips in one shot.
- [x] `src/app/(app)/admin/users/page.tsx` — Server Component, `requireAdmin()` at top, calls `loadAdminUsers()`, passes to client component.
- [x] `src/features/auth/users-admin.tsx` — table with email / linked-contact name / role chips / providers / last sign-in / status (active/deactivated) / Roles + Deactivate per-row; "Add user" dialog with `Admin` and `Coach` checkboxes (no `Staff`/`Viewer` — reserved).
- [x] Vitest tests: `isAdmin` (admin → true; coach/staff/missing/null → false); `createUser` non-admin → throws redirect, no Supabase call; invalid email → rejected pre-Supabase; duplicate-email → Supabase error surfaced verbatim; unsupported role (`staff`) → rejected with clear message.

#### Phase 2: RBAC enforcement
- [x] `src/lib/supabase/middleware.ts` — `ADMIN_PATHS = ['/admin']` constant + pure helpers `isAdminPath` / `isAdminUser`; after the auth check, gate any `pathname` matching `ADMIN_PATHS` on `user.app_metadata?.role === 'admin'`. Non-admin → redirect to `/`.
- [x] `src/components/app/app-nav.tsx` — accepts `isAdmin` prop; `TABS` flag entries `admin: true` (Lookups + Users); filtered out when `isAdmin` is false.
- [x] `src/app/(app)/layout.tsx` — passes `isAdmin(user)` (from `@/lib/auth/require-admin`) into `AppHeader`, threaded through to `AppNav`.
- [x] `src/app/(app)/admin/lookups/page.tsx` — added `await requireAdmin()` at the top.
- [x] **Server Action defence-in-depth:** the six lookup actions (`createCampaignStyle` / `updateCampaignStyle` / `archiveCampaignStyle` / `createSalesLeadSource` / `updateSalesLeadSource` / `archiveSalesLeadSource`) switched from `requireUserId()` to `requireAdmin()`. Staff-side actions (dealers/coaches/campaigns/availability) keep `requireUserId()` because they're not admin-only.
- [x] Vitest tests: `isAdminPath` (matches `/admin`, `/admin/*`; doesn't match `/administrative` etc.); `isAdminUser` (only the literal string `'admin'`; defensive against null/undefined/non-strings).
- [x] Smoke (web-test) as non-admin `david.hogan@networknode.ca`: `/admin/users` and `/admin/lookups` both redirect to `/` (cascades to `/calendar`); nav shows only Calendar / Production List / Manage Lists.

#### Phase 3: Contact↔user linkage
- [x] Extend `createUser` Server Action: FormData carries optional `contactId` (existing) or `firstName`/`lastName` (create new); if neither, the user is created without a contacts link and the admin can attach one later via `linkUserToContact`. Conflict-aware against the auto-link trigger (refuses to override a different contact picked up by email match).
- [x] Extend `users-admin.tsx` "Add user" form: tabbed picker — *Create new* (firstName/lastName) / *Pick existing* (combobox over unlinked contacts) / *No link*. Coach + Admin checkboxes optional; submitting with roles but no link is rejected client-side.
- [x] Per-row "Link contact" action on `users-admin.tsx` — opens a picker dialog that calls `linkUserToContact`. Visible only when the row has no contact link.
- [x] `src/features/auth/actions.ts:linkUserToContact` — set `contacts.user_id` for an existing contact, idempotent (no-op if already same user; error if different user; error if the user is already linked elsewhere).
- [x] `src/features/auth/queries.ts:loadUnlinkedContacts` — feeds the picker (`contacts WHERE user_id IS NULL AND archived_at IS NULL`).
- [x] `drizzle/0002_contact_user_backfill_trigger.sql` — hand-written SQL: `AFTER INSERT ON auth.users` (changed from BEFORE — the FK from `contacts.user_id → auth.users.id` requires the parent row to exist before the trigger updates `contacts`) → look up `contact_identifiers` where `kind='email'` and `value=lower(NEW.email)`, find the `contact_id`, set `contacts.user_id = NEW.id` if `contacts.user_id IS NULL`. `SECURITY DEFINER` with locked `search_path`. Wrapped in `CREATE OR REPLACE FUNCTION` + `DROP TRIGGER IF EXISTS` so re-runs are clean. Journal + snapshot wired for `pnpm db:migrate`.
- [x] Vitest tests for `linkUserToContact` action: existing-contact happy path, contact-already-has-different-user → error, contact-already-set-to-same-user → idempotent ok, user-already-linked-to-another-contact → error, non-admin caller → redirect, missing contactId → invalid.
- [x] `pnpm db:migrate` against dev — `0002_contact_user_backfill_trigger` applied 2026-05-05; `DROP TRIGGER IF EXISTS` returned the expected `does not exist, skipping` notice on first apply.
- [x] Smoke (throwaway `scripts/smoke-contact-user-trigger.ts`, deleted after pass): inserted contact + email identifier, called `auth.admin.createUser({email})`, asserted `contacts.user_id` auto-set to the new auth UUID. PASS. Fixtures cleaned up (auth user deleted, contact + identifier rows deleted).

#### Phase 4: Coach auto-filter on `/calendar`
- [x] `src/lib/auth/load-team-membership.ts` — server helper returning `{ contactId, roles, coachContactId | null }`. Returns `null` when not signed in or no contacts row exists.
- [x] `src/app/(app)/calendar/page.tsx` — `loadCurrentMembership()` added to the existing `Promise.all`; resolved `coachContactId` passed as `<CalendarView viewerCoachId={...}>`.
- [x] `src/app/(app)/calendar/calendar-view.tsx` — accepts `viewerCoachId?: number | null` prop; `activeCoachFilter` initialises to `forcedCoachId ?? viewerCoachId ?? null`. Existing manual filter pills still work — the user can override the auto-filter.
- [x] Vitest tests for `loadCurrentMembership` — six cases: not-signed-in, no-contacts-row, coach user, admin-only, admin+coach combo, no-roles-yet contact. All pass (71/71).
- [ ] Smoke (web-test): `inject-supabase` as a coach; `goto /calendar`; the coach's name pill shows as `active` and the visible ribbons are only their own. (Deferred to Phase 6 verification — needs a coach user in dev DB; will pair with the full /eval pass.)

#### Phase 5: Role-aware login routing
- [x] `src/app/auth/callback/route.ts` — after `exchangeCodeForSession`, calls `loadCurrentMembership()` then runs the decision tree:
  - `roles.length > 0` → redirect to safe `next`.
  - No team-member roles, ≥1 active `dealer_contacts` row → `/auth/auth-error?reason=Portal+not+yet+available`.
  - No contacts row, OR contacts but no roles and no dealer_contacts → `/auth/auth-error?reason=Account+not+provisioned`.
- [x] Vitest tests for the callback handler — seven cases (missing code, exchange error, admin, coach, dealer-contact-only, no-contacts-row, contacts-but-orphan). All pass (78/78).

#### Phase 6: Wiki updates + verification
- [x] Rewrote `docs/wiki/auth.md` — provisioning section now describes `/admin/users` (dashboard fallback noted); new "Route gating (RBAC)" section names the two-layer gate (middleware `ADMIN_PATHS` + page-level `requireAdmin()`) and the hybrid `app_metadata.role` ↔ `team_member_roles` write-time consistency model; "Login routing" rewritten to reflect the implemented decision tree. Removed the `profiles` mention. Resolved both open items (trigger shipped, RBAC shipped).
- [x] Removed the `profiles` mention from `auth.md`. None present in `data-model.md`.
- [x] Updated `docs/wiki/data-model.md` Q #15 (the actual `team_member_roles ↔ user_id` coupling question — Q #16 is the schema-rename pass) — resolved app-enforced, with rationale (cross-table predicates would need a trigger; we want flexibility to seed staff records ahead of provisioning; deactivation flow archives roles without orphaning the link). Q #4 (signup trigger) also resolved as shipped. Inline reference at line 29 fixed to point at Q #15.
- [x] Appended to `docs/wiki/log.md`: dated entry "0018 user-system: full RBAC + role-aware login + auto-link trigger".
- [x] Moved `docs/designs/0017-user-admin/` to `docs/designs/shipped/0017-user-admin/` with a top-of-body supersession blockquote on 2026-05-05.
- [x] `pnpm tsc --noEmit` clean.
- [x] `pnpm test` clean (78/78).
- [ ] /eval against `0018-user-system/plan.md`.
- [ ] Smoke (web-test):
  - `goto /admin/users` (as admin): heading "Users", table with email / role / providers / last sign-in, "Add user" button, "Promote" / "Demote" / "Deactivate" per-row actions.
  - Click "Add user": dialog "Add user" with `Email` field, `Pick contact` / `Create new` tabs, `Coach role` checkbox.
  - As non-admin: `goto /admin/users` redirects to `/`.
  - As coach: `goto /calendar`, the coach's pill is active, ribbons are filtered.
  - As an unprovisioned auth user (manually staged): `goto /` after callback lands on `/auth/auth-error` with the `not provisioned` reason. (Manual; can't fully smoke without a fixture user.)

## Out of scope (explicitly)

- **Client portal route.** Phase 5 wires the *decision* but the contact-only branch redirects to `/auth/auth-error?reason=Portal+not+yet+available`. The portal itself is a separate, future plan.
- **Self-service team management.** Only admins set role-sets / deactivate. No "request access" flow, no "manage my team" page for non-admins.
- **`staff` and `viewer` role wiring.** Both stay as reserved enum values. Default for "signed-in non-admin" IS the staff experience today (no `team_member_roles` row required). Wire these explicitly when a distinct view-only stakeholder shows up.
- **Portal redaction model.** What a `customer`-role contact actually sees in the portal (which campaign fields are hidden — coach fees, internal notes) is a portal-plan decision. 0018 routes them to a placeholder.
- **Per-coach share-link auth model.** Tokenless `/share/coach/[id]` already shipped; intentionally outside the role taxonomy.
- **Email/password reset, manual provider linking.** Magic link is the recovery path; admin can deactivate + recreate if a user is truly stuck.
- **Bulk user import.** No CSV. The team is small and bounded for now.
- **Audit log.** `auth.users` already records `created_at`, `last_sign_in_at`, `banned_until` natively; no separate `users_audit` table.
- **`profiles` table.** `team_member_roles` already does the staff-role job; `app_metadata.role` does the gate-cache job. A real `profiles` table would only be justified if staff metadata grows beyond the role string (display name, avatar, scoped roles) — deferred.
- **Dealer-portal contact provisioning UI.** This plan adds the trigger that *would* back-fill `contacts.user_id` for a portal contact, but no UI for the portal-contact-creation flow exists. That ships with the portal plan.
