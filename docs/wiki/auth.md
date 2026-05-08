# Authentication

Identity and session for both staff (the internal app) and customer-side contacts (a future client portal).

> Part of `docs/wiki/`. See [data-model.md](data-model.md) for the `auth.users` ↔ `contacts` ↔ `team_member_roles` / `dealer_contacts` relationships, [architecture.md](architecture.md) for where the auth code lives.

## Identity

**Supabase Auth** is the source of truth for who someone is. Two sign-in methods:

- **Google OAuth** (primary CTA on the login page). One click, no inbox round-trip. Core users (Shannon, Scott, Adam) are on Workspace + Gmail.
- **Magic link** (fallback, "Send magic link"). For non-Google emails — today's Outlook user (Brian) and any future client whose dealership is on a non-Google domain (`@centuryhonda.ca`, `@myers.ca`).

Both providers fan into the same `/auth/callback` route, the same session, and the same `auth.users` row — Supabase keys on email, so a magic-link invite + later Google sign-in with the same email collapse into one user.

**No password auth.** No other OAuth providers. Magic link covers the Outlook tail; Google covers everyone else. Adding more providers needs explicit justification.

## Signups are disabled

The Supabase project-level **"Allow new users to sign up"** toggle is **off**. This single switch gates both Google OAuth and magic link — an unrecognized email hitting either entry point gets rejected with `Signups not allowed`. No silent auto-provisioning when someone clicks "Continue with Google" with a brand-new address.

**To add a person:** admins use the in-app `/admin/people` page (gated by `requireRole('admin')`). The "Add Person" dialog always creates a `contacts` row (firstName + lastName, optional email/phone, optional dealer relationships); toggling **App access** also creates an `auth.users` row via `auth.admin.createUser({ email, email_confirm: true })` and links it via `contacts.user_id` in the same Server Action transaction. Toggle **Admin** to write `app_metadata.role = 'admin'`; toggle **Coach** to write a `team_member_roles(role='coach')` row. `email_confirm: true` lets them sign in via Google immediately without an extra round-trip.

**Fallback path:** the Supabase dashboard (Auth → Users → Add user) still works for emergencies, but it bypasses the People page and creates an orphan auth user (no `contacts` row). When that happens, the `/admin/people` page surfaces the orphan in an amber **Unprovisioned auth users** panel with a per-row Adopt button (creates the contact + email identifier + links). The CLI script `scripts/adopt-orphan-auth-users.ts` covers the bulk-adopt case for legacy state.

This mirrors the curated `Users!A:E` sheet from the legacy app — controlled signups, not open registration.

## Session

- HTTP-only cookies via `@supabase/ssr`.
- `src/proxy.ts` (Next 16's renamed `middleware.ts`) refreshes the session cookie on every request and gates routes (see below).
- `src/lib/supabase/session.ts` exposes `getUser()` — server helper returning the current `User` or `null`. Single read path. Use it in server components and Server Actions.
- `src/lib/supabase/client.ts` and `server.ts` expose the browser and server-cookie-aware Supabase clients.

## Login flow

```
GET  /login                 → src/app/login/page.tsx (server component)
                              already-authed users redirect to ?next= or /
POST <Server Action>        → signInWithGoogle()  → supabase.auth.signInWithOAuth({
                                                     redirectTo: <origin>/auth/callback?next=…
                                                   })
                            → signInWithMagicLink() → supabase.auth.signInWithOtp({
                                                       redirectTo: …,
                                                       shouldCreateUser: false
                                                     })
GET  /auth/callback?code=…  → src/app/auth/callback/route.ts
                              supabase.auth.exchangeCodeForSession(code)
                              redirect to safe `next` (or /)
GET  /auth/auth-error       → minimal error page for failed callbacks
```

`shouldCreateUser: false` on magic link is belt-and-suspenders — the project-level signups-disabled toggle already blocks creation, but this prevents Supabase from even attempting it.

The `next` param is passed through `safeNextPath()` (in `src/lib/auth/`) to prevent open-redirect attacks. Tests live in `tests/` (Vitest).

## Logout & session UI

- `signOut()` Server Action (`src/features/auth/actions.ts`) → `supabase.auth.signOut()` → redirect to `/login`.
- `<SessionBanner />` (`src/components/auth/session-banner.tsx`) is a server component rendering the logged-in email and a logout form button. Wired into `src/app/layout.tsx` so it appears on every gated page.

## What each role is for

The role labels (`admin` / `coach` / `dealer`) carry purpose, not just permissions — they map to *who does what in the business*, and the surface gates should follow that map:

- **Admin** — back-office / ops. Plans events, manages dealers, provisions coaches, runs the production schedule. Surfaces: every staff page (Calendar, Production List, Reports, Dealers, plus the Admin dropdown's People and Lookups).
- **Coach** — field / event-day. Goes to the dealership on the sales day to run the booth. Staff-app surface is **Calendar + Reports** — Calendar is the where-am-I-booked tool (plus the only mutation a coach can perform: their own `coach_unavailable` blocks via Block Date); Reports lets a coach see their own summary view (`['admin', 'coach']` gate). Booking events, dealer CRUD, sending client/coach emails, cancelling campaigns — all back-office work, all admin-only. The role purpose is "show up, run the booth"; everything that schedules or shapes the booth lives with admin.
- **Dealer** — customer-side. No staff-app access today; the dealer portal isn't built yet. A `dealer`-only contact is them-side, not us-side, and `STAFF_APP_ROLES` excludes `dealer` from the staff gate (see Route gating below).

The per-route surface matrix is enforced at three layers (see [Route gating](#route-gating-rbac) below): edge `ADMIN_PATHS` (`/admin`, `/production`, `/dealerships`), page-level `requireRole('admin')` on the same routes, and nav scoping (`requiresAdmin` flag on top-tab entries; `Admin` dropdown rendered only for admins). 0028 closed the previous gap where Production + Dealers were coach-visible in the nav and the layout-only `requireStaffAccess` gate.

## Route gating (RBAC)

Four layers of gating, defence-in-depth (top to bottom: cheapest, most-likely-to-be-bypassed-first):

1. **`src/proxy.ts` + `src/lib/supabase/middleware.ts`** — single edge gate.
   - Sends unauthenticated requests to `/login?next=<original-path>` (whitelist: `/login`, `/auth/callback`, `/auth/auth-error`, plus public `/share/coach/[id]` per-coach share links).
   - Sends signed-in non-admins hitting `/admin/*` (matched against the `ADMIN_PATHS` constant) back to `/` — gate is `user.app_metadata?.role === 'admin'`.
2. **Page-level `requireStaffAccess()`** (`src/lib/auth/require-staff-access.ts`) — runs in `(app)/layout.tsx` and from any `(app)/*` Route Handler that doesn't route through the layout (e.g. `/production/export`). Single staff-access decision: admin-via-JWT-fast-path or any active `team_member_roles` row. Anyone else lands on `/auth/auth-error?reason=...`.
3. **Per-page / per-Server-Action `requireRole(role | role[])`** (`src/lib/auth/require-role.ts`) — the deepest enforcement layer. Every admin page calls `requireRole('admin')` at the top; every Server Action calls one of the role-list variants (`requireRole('admin')` / `requireRole(['admin','coach'])` / `requireRole(['admin','staff','coach'])`) before its first DB read or external side effect. **Server Actions are public-API-shaped** — a direct POST bypasses the layout gate, so action-level gating is load-bearing, not just defence-in-depth. Pure `isAdmin(user)` predicate (same module that `requireRole` reads) is exposed for ad-hoc decisions like "admin skips the row-ownership check."
4. **Capability gating: actions + UI affordances** (0029, 2026-05-08). Selected `requireRole` call sites — those whose capability semantics tighten intent — migrated to `assertCan(capability, resource?)` from `src/lib/auth/assert-can.ts`. The decision lives in `src/lib/auth/capabilities.ts` as a pure `can(profile, capability, resource?) → boolean`; the same module powers the client-side `<Can>` / `useCan()` PEP for affordance hiding (mounted via `CapabilityProvider` in `(app)/layout.tsx`). **Capabilities are an *intent* layer, not a *security* layer** — `assertCan` redirects on deny exactly like `requireRole` did, and that server-side gate is what prevents privilege escalation. The `<Can>` wrapper is bypassable (a determined client can always hand-craft the FormData submit), so every `<Can>` must pair with the corresponding server-side gate. See § "Capability matrix" below for the role↔capability table.

**Two surfaces, kept consistent at write time:**

- **`auth.users.app_metadata.role`** — single string, lives on the JWT. Cheap to read in middleware via `getUser()` with no DB hit. Powers the JWT-fast-path branch in `requireRole`/`isAdmin`.
- **`team_member_roles` table** — N rows per contact (admin / staff / coach / viewer enum). Powers per-feature semantics (calendar coach auto-filter, etc.). Multiple roles per person allowed (admin + coach is a valid combo). Read by `loadCurrentMembership()` (React `cache()`-wrapped, request-scoped).

When an admin saves a person via `/admin/people`, both surfaces are written in the same Server Action (`updatePerson` / `createPerson` in `src/features/people/actions.ts`): `team_member_roles` first inside a DB transaction, then `app_metadata.role = 'admin'` (or `null`) via the service-role client. If the auth-side update fails after the DB commit, the action returns `{ ok: true, warning }` — the row is committed, the warning is surfaced as a toast, and the admin can retry. No privilege escalation occurs because the gate trusts `app_metadata.role`, which only changes after a successful update.

**v1 wired roles:** `admin`, `coach`, and `dealer` are selectable in the UI (the Person dialog's Roles fieldset). `staff` and `viewer` are reserved enum values for future use. Staff-app access requires *either* `app_metadata.role === 'admin'` (bootstrap path) *or* at least one active `team_member_roles` row whose role is in `STAFF_APP_ROLES = {admin, staff, coach, viewer}` — `dealer` is deliberately excluded from the staff-app gate (a dealer-only contact is them-side, not us-side; landing them on `/calendar` would be a privilege escalation). The matching SQL `is_staff_member()` helper applies the same whitelist so RLS policies and the app-layer gate agree on what "staff" means. The older "signed-in non-admin = staff by default" was retracted as a Codex Critical (post-callback URL bypass) on 2026-05-05.

**Per-action gate matrix** (set by 0019 Phase 2's audit; capability migration in 0029 Phase 2):

| Action surface | Gate |
|---|---|
| Person CRUD (create / update / archive / adopt-orphan) | `assertCan('person:create' \| 'person:edit' \| 'person:archive' \| 'person:adopt-orphan')` |
| Dealer CRUD (create / update / archive) | `assertCan('dealer:create' \| 'dealer:edit' \| 'dealer:archive')` — admin-only since 2026-05-08 (`/dealerships` page itself was admin-gated by 0028; the actions caught up post-0029) |
| Campaign CRUD (create / update / cancel) | `assertCan('campaign:create' \| 'campaign:edit' \| 'campaign:cancel')` — admin-only since 2026-05-08 (booking is back-office work; coach is field-only) |
| Outbound email (client / coach confirmations, share-link) | `assertCan('email:send')` — admin-only since 2026-05-08 (admin → external comms, sent after admin books) |
| Lookup admin (campaign styles, sales lead sources × create/update/archive) | `assertCan('lookup:edit')` |
| Production CSV export Route Handler | `assertCan('production:export')` |
| Availability blocks (create / update / archive) | `requireRole(['admin','coach'])` plus row-level `ensureAvailabilityOwnership` (which delegates the predicate to `can('coach-availability:edit-own', facet)` post-0029) |
| Auth flow (`signIn*`, `signOut`) | none — these IS the auth flow |

## Capability matrix

`src/lib/auth/capabilities.ts` is the canonical role↔capability table. v1 capabilities and their role admit set:

| Capability | admin | coach | dealer | Notes |
|---|---|---|---|---|
| `production:view`, `production:export` | ✅ | ❌ | ❌ | 0028 page-gate already excludes coach |
| `dealer:view`, `dealer:edit`, `dealer:create`, `dealer:archive` | ✅ | ❌ | ❌ | Same |
| `person:view`, `person:create`, `person:edit`, `person:archive`, `person:adopt-orphan` | ✅ | ❌ | ❌ | `/admin/people` admin-only |
| `lookup:edit` | ✅ | ❌ | ❌ | `/admin/lookups` admin-only |
| `campaign:create`, `campaign:edit`, `campaign:cancel` | ✅ | ❌ | ❌ | Booking is back-office; coach is field-only |
| `email:send` | ✅ | ❌ | ❌ | Admin → external comms (client + coach confirmations + share link) |
| `coach-availability:edit-any` | ✅ | ❌ | ❌ | Holiday + company-closure rows |
| `coach-availability:edit-own` | ✅ | ✅ on own row | ❌ | Coach passes only on `kind='coach_unavailable'` AND `coachId === profile.coachContactId` |

**`<Can>` adoption** (Phase 4): row-actions on `/admin/people` (Edit + Archive), `/dealerships` (Edit + ✕), and `/admin/lookups` (Add form + Rename + ✕). Today these affordances are also gated by the page-level `requireRole('admin')` — `<Can>` becomes redundant for the *current* role matrix but locks the affordance to capability-keyed intent for future expansions (e.g. when a `person:archive-own` capability lets coaches archive themselves). The top-bar `app-nav.tsx` stays on `isAdmin` boolean rather than `<Can capability="…:view">` — the nav decision is computed server-side in the layout and rendering it client-side via `useCan()` would mean a hydration round-trip for an essentially-static surface.

**Structural enforcement of the matrix** (0031, 2026-05-08). Gate *presence* is checked at lint-time by a custom ESLint rule (`eslint-plugins/action-gate.mjs` → `action-gate/no-ungated-action`) wired against `src/features/**/actions.ts` (Server Actions) and `src/app/**/route.ts` (Route Handlers). The rule rejects any exported `async` function whose body doesn't reach an allow-listed gate (`assertCan`, `requireRole`, `requireStaffAccess`) — directly or via a same-file wrapper helper that itself calls one. The only legitimate exceptions opt out per-function with a `// authz: public` line comment: the auth-flow Server Actions (`signInWithMagicLink`, `signInWithGoogle`, `signOut`) and the OAuth `/auth/callback` GET handler (runs the code-for-session exchange before any session exists). Gate *admit set* is checked at test-time per 0032; gate *symmetry* (every `<Can capability="X">` paired with an `assertCan('X')` server gate) is checked at CI-time per 0034.

## Defence in depth (RLS + audit log)

Beyond the action-level gates, two layers below them harden the picture:

**Row Level Security on every public table** (drizzle/0003_enable_rls.sql, 2026-05-06). Every domain table has RLS enabled with two policies: `<table>_service_role_all` (FOR ALL TO `service_role` USING true) and `<table>_staff_all` (FOR ALL TO `authenticated` USING `public.is_staff_member()`). Today this is invisible to the staff app — Drizzle connects as the `postgres` Postgres role, which has `BYPASSRLS=t` (verified at write time), so policies don't run on the Drizzle path. The point is the day a JWT-bearing query path exists (the dealer portal): PostgREST sets the role to `authenticated`, the policies run, and a coach-with-no-membership (or anon) sees zero rows — even if a route handler forgot to filter. `is_staff_member()` is `STABLE, SECURITY DEFINER, search_path=''` so it can answer the question even when its underlying tables are RLS-locked against the calling role.

**Forensic `audit_log`** (drizzle/0004_worthless_titanium_man.sql, 2026-05-06). Append-only table written by `recordAudit({ action, targetTable, targetId, payload? })` from inside sensitive Server Actions. Today the wired emit-points are: `archivePerson` → `user.deactivated`; `updatePerson` (when roles changed) → `user.role_changed` with `payload: { before, after }`; `updatePerson` on→off auth-ban → `user.deactivated`; `createPerson` (with non-empty roles) → `user.role_changed` with `before: []`; `archiveDealer` → `dealer.archived`; `cancelCampaign` → `campaign.cancelled`. `actorRole` is denormalised at write time. The helper is **best-effort**: insert failures log via `console.error` rather than rejecting the action — the wired actions span DB+auth boundaries, so wrapping audit in the mutation tx wouldn't actually buy atomicity. Forensic gaps are visible in deploy logs (grep `audit insert failed`).

`audit_log` itself is RLS-enabled: `service_role` permits all (the writer + future audit-UI loads); `authenticated` may SELECT only their own actions (`actor_user_id = auth.uid()`); anon falls through to default-deny.

**The threat model the staff app assumes** is "ten internal employees, all admins-or-trusted-staff, on a closed-signup auth surface." RLS is invisible defence-in-depth for the day-the-portal-ships invariant; audit_log is forensics, not enforcement. See [security.md](security.md) for the layered overview.

## Login routing: staff vs portal contacts

The decision tree runs in **two places** so it's durable, not just a one-shot greeting:

1. `src/app/auth/callback/route.ts` — *first* request after `exchangeCodeForSession`. Picks the landing URL.
2. `src/app/(app)/layout.tsx` — every subsequent request to a gated `(app)/*` route. Re-runs the same gate so a contact-only auth user can't bypass the callback redirect by typing `/calendar` directly.

Both consult `loadCurrentMembership()` (wrapped in React's `cache()` so the per-request DB read is shared with `/calendar`'s `viewerCoachId` fetch). The branches:

- **`team_member_roles` rows exist** (any role) → staff app at `next` (default `/`). Admins also pass on `app_metadata.role === 'admin'` alone, so a fresh admin can operate before any role row is written (bootstrap path).
- **No `team_member_roles`, ≥1 active `dealer_contacts` row** → `/auth/auth-error?reason=Portal+not+yet+available`. The portal isn't built yet (0018 routes the *decision* but not the *destination*); when the portal ships, swap this redirect to `/portal`.
- **No contacts row, OR contacts but neither table** → `/auth/auth-error?reason=Account+not+provisioned`. Defensive — shouldn't happen with signups disabled.

A contact can have rows in both tables (per [data-model.md](data-model.md)). Routing precedence: any us-side role wins → staff app. The portal wouldn't show their own dealer to them anyway.

**Auto-link trigger** (`drizzle/0002_contact_user_backfill_trigger.sql`): an `AFTER INSERT ON auth.users` trigger matches `NEW.email` against `contact_identifiers(kind='email', value=…)`; if a match exists and that contact's `user_id` is null, the trigger sets `contacts.user_id = NEW.id`. Idempotent. Today (signups-disabled) it's mostly insurance — the in-app provisioning flow already links explicitly. It earns its keep the day a self-signup portal opens.

## Email sender

Supabase **default SMTP** for now. Free-tier rate limit is ~4 emails/hour — adequate for in-house use. Switching to Resend is its own future chunk; happens at the Supabase project level (no app-code change required).

## Open

- **Email-confirmation guarantee for Google.** The auto-link trigger's safety depends on Supabase requiring confirmed email. Magic link confirms by definition. For Google OAuth, Supabase trusts Google's `email_verified` claim — fine for Workspace/Gmail, but worth re-confirming if any non-Google IdPs get added.
- **Client portal route.** The post-callback router *decides* the staff/portal/error split, but the portal destination is a placeholder (`/auth/auth-error?reason=Portal+not+yet+available`) until that chunk ships. Day-it-opens change is a one-line redirect swap.
