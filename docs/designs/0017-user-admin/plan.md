# User admin — provision Supabase Auth users from the app

**Started:** 2026-05-03

Today, every new user has to be added through the Supabase dashboard (per `docs/wiki/auth.md:22`). That's fine for the David + Shannon two-row state, but ugly when onboarding the rest of the team — Scott, Adam, Brian — and any future coaches, plus any `salesability.ca` staff who need access. This chunk adds an in-app **User Admin** page (`/admin/users`) that lists existing users, lets an admin add a new one (auto-confirmed so Google auth attaches on first sign-in), and lets an admin deactivate one.

**Done =** an admin signed into the app can navigate to `/admin/users`, see every `auth.users` row with email + provider + last-sign-in, click "Add user" → enter an email → the new user appears in the list with `email_confirmed_at` already set, and clicking "Continue with Google" with that email on the login page works on first try.

## Decisions

1. **Role storage: `app_metadata.role` vs new `profiles.role` column.** `auth.md:96` (the "Open / RBAC" entry) lists both as candidates. **Recommend `app_metadata`** for v1 — zero schema change, role lives on the JWT, server can read it via `supabase.auth.getUser()` without a DB hit. Drop in a real `profiles` table later if/when staff metadata grows beyond a single role string.
2. **Bootstrap.** No admin exists today. Plan: a one-shot script (`scripts/promote-admin.ts`) that reads `david.hogan@networknode.ca` and sets `app_metadata.role = 'admin'`. Run it once locally with the service role key. Subsequent admins are promoted via the new UI.
3. **Scope of v1.** Add user (auto-confirm), list users, deactivate user (Supabase's "Ban user" / `banned_until = far future`). **Out of scope v1:** assigning roles in the UI (everyone added is just a regular user; `admin` is set manually via script for the first one), email/password reset, manual provider linking. These slide into a follow-up if/when needed.

## Progress Tracker

| Phase | Status | Commit |
|-------|--------|--------|
| 1: Service-role Supabase client + `requireAdmin()` helper + bootstrap script | Pending | - |
| 2: `createUser` / `deactivateUser` Server Actions | Pending | - |
| 3: `/admin/users` page + list + add/deactivate UI | Pending | - |
| 4: Wiki update — `auth.md` "To add a user" section + RBAC note | Pending | - |
| 5: Verification — tsc + tests + eval-smoke + manual e2e | Pending | - |

## Code Anchors

| New code | Anchor (`path:line`) | Why this anchor |
|----------|---------------------|-----------------|
| `src/lib/supabase/admin.ts` (service-role client) | `src/lib/supabase/server.ts:1` | Sibling — same shape, same factory pattern, but uses `SUPABASE_SERVICE_ROLE_KEY` instead of the anon key and does **not** use cookies. |
| `src/lib/auth/require-admin.ts` (`requireAdmin()` helper, throws `Response` 403 if not admin) | `src/features/schedule/actions.ts:54` (`requireUserId`) | Same shape: read user via existing helper, throw if missing/insufficient. Layered on top of `requireUserId`. |
| `scripts/promote-admin.ts` (one-shot to set `app_metadata.role`) | `scripts/import-from-sheets.ts:1` | Sibling — same `dotenv → service-role admin client → run` pattern that the import script uses. |
| `src/features/auth/actions.ts:createUser` (new) | `src/features/schedule/actions.ts:231` (`createCoach`) | Same FormData → validate → admin SDK call → `revalidatePath` → `ActionResult` shape. The auth-side actions file already exists for `signInWithGoogle` etc. — extend it. |
| `src/features/auth/actions.ts:deactivateUser` (new) | `src/features/schedule/actions.ts:333` (`archiveCoach`) | Soft-delete equivalent for an `auth.users` row — uses Supabase `banned_until` rather than `archivedAt`. |
| `src/app/(app)/admin/users/page.tsx` (Server Component, lists users) | `src/app/(app)/admin/lookups/page.tsx:1` | Sibling under `/admin/`, same Server-Component-then-pass-to-client-list pattern. |
| `src/app/(app)/admin/users/users-admin.tsx` (Client Component for the list + form) | `src/features/schedule/lookup-admin.tsx:1` | Same shape: list rows + inline add form + per-row action button. The lookup-admin component is the closest existing list-with-mutations UI. |

**Conventions referenced:**
- `docs/wiki/auth.md` — provisioning section (`:18-22`), open RBAC entry (`:96`). The plan is the implementation of those open notes.
- `docs/wiki/architecture.md` — Server Actions for our-UI mutations: createUser is internal, so Server Action (not route handler).
- `docs/wiki/conventions.md` — service-role key is server-only; never imported from a Client Component.

**Overall Progress:** 0% (0/5 phases complete)

**Note:**
- Service-role client must never be imported into a Client Component. Add a `'server-only'` import at the top of `src/lib/supabase/admin.ts` to make the boundary tooling-enforced.
- "Add user" defaults to `email_confirm: true` so Google auth attaches on first sign-in (the gotcha that bit the manual Shannon provisioning today).
- `/admin/users` is gated by `requireAdmin()` at the page level *and* every action validates the same way — defense in depth.

### Phase Checklist

#### Phase 1: Service-role client + `requireAdmin()` + bootstrap
- [ ] `src/lib/supabase/admin.ts` — `'server-only'` import, factory returning a `SupabaseClient` configured with `SUPABASE_SERVICE_ROLE_KEY`. No cookies handling.
- [ ] `src/lib/auth/require-admin.ts` — reads current user via `getUser()`, checks `user.app_metadata.role === 'admin'`, throws `unauthorized()`-like response otherwise.
- [ ] `scripts/promote-admin.ts` — CLI script: takes an email arg, looks up the user via service-role client, sets `app_metadata = { ...existing, role: 'admin' }` via `supabase.auth.admin.updateUserById`. `pnpm tsx scripts/promote-admin.ts david.hogan@networknode.ca` makes David the first admin.
- [ ] Vitest unit test for `requireAdmin()` (admin → ok, non-admin → throws, no user → throws).

#### Phase 2: Server Actions
- [ ] `src/features/auth/actions.ts:createUser` — `requireAdmin()`, parse FormData (`email`), call `supabase.auth.admin.createUser({ email, email_confirm: true })`, revalidate `/admin/users`, return `ActionResult`.
- [ ] `src/features/auth/actions.ts:deactivateUser` — `requireAdmin()`, parse FormData (`userId`), call `admin.updateUserById(id, { ban_duration: '876000h' })` (~100 years), revalidate, return `ActionResult`.
- [ ] Vitest tests: createUser-as-non-admin → error; createUser duplicate email → error surfaced verbatim from Supabase; deactivateUser-as-non-admin → error.

#### Phase 3: `/admin/users` page + UI
- [ ] `src/app/(app)/admin/users/page.tsx` — Server Component, `requireAdmin()` at top, lists users via `supabase.auth.admin.listUsers()`, passes to client component.
- [ ] `src/app/(app)/admin/users/users-admin.tsx` — Client Component: table with email / providers / last sign-in / "Deactivate" button per row; "Add user" form at top.
- [ ] Add `Users` link to `src/components/app/app-nav.tsx` (visible only when current user is admin — small flag prop from the layout).

#### Phase 4: Wiki update
- [ ] Rewrite `docs/wiki/auth.md` "To add a user" section: dashboard → in-app `/admin/users`, fall back to dashboard if SDK is unavailable.
- [ ] Add "RBAC" subsection: `app_metadata.role` is now the role gate; `requireAdmin()` is the single check; first admin set via `scripts/promote-admin.ts`.
- [ ] Update `auth.md:96` "Open / RBAC" entry — partly resolved.
- [ ] Append to `docs/wiki/log.md`.

#### Phase 5: Verification
- [ ] `pnpm tsc --noEmit` clean.
- [ ] `pnpm test` clean (new tests pass).
- [ ] eval-smoke: gated `/admin/users` shows up, non-admin gets 403/redirect, admin can add a user.
- [ ] Manual e2e: as David, add Shannon → Shannon's row appears confirmed → Shannon clicks "Continue with Google" → succeeds, providers column shows `Email, Google`.

## Out of scope (for this chunk)

- **Role assignment in the UI.** v1 has admin / non-admin only, and admin is set via script. No "promote to coach" / "demote to viewer" controls.
- **`profiles` table.** Staying with `app_metadata.role` for v1. If/when staff metadata needs more fields (display name, avatar, scoped roles), `profiles` lands in its own chunk.
- **Email/password reset.** Magic link covers the recovery case; admin can deactivate + recreate if needed.
- **Bulk import.** No CSV upload. The pre-cutover team is small.
- **Audit log.** No `users_audit` table — `auth.users` already records `created_at`, `last_sign_in_at`, `banned_until` natively.
