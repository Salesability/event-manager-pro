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

**To add a person:** admins use the in-app `/admin/people` page (gated by `assertCan('admin:access')`). The "Add Person" dialog always creates a `contacts` row (firstName + lastName, optional email/phone, optional dealer relationships); toggling **App access** also creates an `auth.users` row via `auth.admin.createUser({ email, email_confirm: true })` and links it via `contacts.user_id` in the same Server Action transaction. Toggle **Admin** to write `app_metadata.role = 'admin'`; toggle **Coach** to write a `team_member_roles(role='coach')` row. `email_confirm: true` lets them sign in via Google immediately without an extra round-trip.

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

The per-route surface matrix is enforced at three layers (see [Route gating](#route-gating-rbac) below): edge `ADMIN_PATHS` (`/admin`, `/production`, `/dealerships`), page-level `assertCan('admin:access')` on the same routes, and nav scoping (`requiresAdmin` flag on top-tab entries; `Admin` dropdown rendered only for admins). 0028 closed the previous gap where Production + Dealers were coach-visible in the nav and the layout-only `requireStaffAccess` gate.

## Route gating (RBAC)

**Capabilities-only at gates** is the durable convention as of 0036 (2026-05-09). Every page, layout, Route Handler, and Server Action uses the capability layer — `assertCan(cap)` imperative or `capabilityClient(cap)` middleware — for its decision. The role↔capability matrix lives in exactly one file (`src/lib/auth/capabilities.ts`); roles are the user's *identity* and the *input* to that matrix, but no app-code call site checks them directly.

Three layers of gating, defence-in-depth (top to bottom: cheapest, most-likely-to-be-bypassed-first):

1. **`src/proxy.ts` + `src/lib/supabase/middleware.ts`** — single edge gate, JWT-claim fast-path.
   - Sends unauthenticated requests to `/login?next=<original-path>` (whitelist: `/login`, `/auth/callback`, `/auth/auth-error`, plus public `/share/coach/[id]` per-coach share links).
   - Sends signed-in non-admins hitting `/admin/*` (matched against the `ADMIN_PATHS` constant) back to `/` — predicate is `user.app_metadata?.role === 'admin'` from the JWT, no DB hit.
   - This is an **optimization** (cheap reject before any DB work), not the durable answer. The capability layer is the source of truth; this gate exists because it can decide the admin path without loading membership. If an `ADMIN_PATHS` entry diverges from the capability matrix, the capability layer wins (the page-level `assertCan` rejects too).
2. **Layout-level `requireStaffAccess()`** (`src/lib/auth/require-staff-access.ts`) — runs in `(app)/layout.tsx`. Wraps the `app:access` capability predicate (`can(profile, 'app:access')`) with friendly auth-error redirects: `/auth/auth-error?reason=Portal+not+yet+available` for dealer-only contacts, `/auth/auth-error?reason=Account+not+provisioned` for unprovisioned auth users. Bare `assertCan('app:access')` redirects to `/` on deny, but `/` is inside `(app)/` and would loop here — the wrapper exists to add the redirect-target UX, not to bypass the capability decision. Any future Route Handler that wants the same friendly redirects can use this; otherwise prefer `assertCan` directly.
3. **Per-page / per-Server-Action capability gate** — the deepest enforcement layer.
   - **Pages** call `assertCan(cap)` at the top before any DB read. Every admin page calls `assertCan('admin:access')`; `/reports` calls `assertCan('reports:view')`; row-action pages each call the capability that maps to the operation they expose.
   - **Server Actions** are written as `capabilityClient('cap').schema(formDataSchema).action(async ({ parsedInput, ctx }) => { ... })` (the next-safe-action middleware chain established in 0033). The middleware composes auth (`getUser` → `redirect('/login')`) and capability check (`assertCan(cap)` → `redirect('/')`) ahead of every action body, so writing an unauthed action requires explicit opt-out (use `baseClient` and add `// authz: public` — only the auth-flow actions opt out today).
   - **Route Handlers** call `assertCan(cap)` imperatively (Route Handlers don't run through the safe-action middleware). The `production/export` and `reports/export` GET handlers each call their respective capability.
   - **Server Actions are public-API-shaped** — a direct POST bypasses the layout gate, so action-level gating is load-bearing, not just defence-in-depth.
   - Pure `isAdmin(user)` predicate (`src/lib/auth/require-admin.ts`) is exposed for ad-hoc decisions like "admin skips the row-ownership check." The `can()` PDP itself uses the same predicate internally for the admin shortcut.

**Capabilities = intent layer + security layer.** `assertCan` redirects on deny, and that server-side gate is what prevents privilege escalation. The `<Can>` / `useCan()` UI wrappers (mounted via `CapabilityProvider` in `(app)/layout.tsx`) hide affordances on deny but are bypassable — a determined client can always hand-craft the FormData submit, so every `<Can>` must pair with the corresponding server-side gate. The 0034 pairing CI script enforces both-sides-paired discipline; today 18/18 capabilities are paired or per-line opted out.

**Two surfaces, kept consistent at write time:**

- **`auth.users.app_metadata.role`** — single string, lives on the JWT. Cheap to read in middleware via `getUser()` with no DB hit. Powers the edge-middleware fast-path on `ADMIN_PATHS` and the admin shortcut in `can()` (and the `isAdmin(user)` predicate that wraps it).
- **`team_member_roles` table** — N rows per contact (admin / staff / coach / viewer enum). Powers per-feature semantics (calendar coach auto-filter, etc.). Multiple roles per person allowed (admin + coach is a valid combo). Read by `loadCurrentMembership()` (React `cache()`-wrapped, request-scoped).

When an admin saves a person via `/admin/people`, both surfaces are written in the same Server Action (`updatePerson` / `createPerson` in `src/features/people/actions.ts`): `team_member_roles` first inside a DB transaction, then `app_metadata.role = 'admin'` (or `null`) via the service-role client. If the auth-side update fails after the DB commit, the action returns `{ ok: true, warning }` — the row is committed, the warning is surfaced as a toast, and the admin can retry. No privilege escalation occurs because the gate trusts `app_metadata.role`, which only changes after a successful update.

**v1 wired roles:** `admin`, `coach`, and `dealer` are selectable in the UI (the Person dialog's Roles fieldset). `staff` and `viewer` are reserved enum values for future use. Staff-app access requires *either* `app_metadata.role === 'admin'` (bootstrap path) *or* at least one active `team_member_roles` row whose role is in `STAFF_APP_ROLES = {admin, staff, coach, viewer}` — `dealer` is deliberately excluded from the staff-app gate (a dealer-only contact is them-side, not us-side; landing them on `/calendar` would be a privilege escalation). The matching SQL `is_staff_member()` helper applies the same whitelist so RLS policies and the app-layer gate agree on what "staff" means. The older "signed-in non-admin = staff by default" was retracted as a Codex Critical (post-callback URL bypass) on 2026-05-05.

**Per-action gate matrix** (set by 0019 Phase 2's audit; capability migration completed by 0036 Phase 2+3, 2026-05-09):

| Action surface | Gate |
|---|---|
| Person CRUD (create / update / archive / adopt-orphan) | `assertCan('person:create' \| 'person:edit' \| 'person:archive' \| 'person:adopt-orphan')` |
| Dealer CRUD (create / update / archive) | `assertCan('dealer:create' \| 'dealer:edit' \| 'dealer:archive')` — admin-only since 2026-05-08 (`/dealerships` page itself was admin-gated by 0028; the actions caught up post-0029) |
| Campaign CRUD (create / update / cancel) | `assertCan('campaign:create' \| 'campaign:edit' \| 'campaign:cancel')` — admin-only since 2026-05-08 (booking is back-office work; coach is field-only) |
| Outbound email (client / coach confirmations, share-link) | `assertCan('email:send')` — admin-only since 2026-05-08 (admin → external comms, sent after admin books) |
| Lookup admin (campaign styles, sales lead sources × create/update/archive) | `assertCan('lookup:edit')` |
| Production CSV export Route Handler | `assertCan('production:export')` |
| Reports page + reports/export Route Handler | `assertCan('reports:view')` — admin || coach (coach can pull the field-side aggregates) |
| Report billing-figure edit (`setBillingAdjustment`) | `capabilityClient('reports:edit-billing')` — **admin-only** (0059). Coaches view reports but can't adjust invoice figures; the editable cells aren't rendered for them (`useCan('reports:edit-billing')` in `<ReportsTabs>`). |
| Availability blocks (create / update / archive) | `capabilityClient('availability:edit')` — admin || coach. Row-level `ensureAvailabilityOwnership` still runs inside the action body (delegates the predicate to `can('coach-availability:edit-own', facet)` so a coach can only touch their own `coach_unavailable` rows). |
| Auth flow (`signIn*`, `signOut`) | none — these IS the auth flow |

## Capability matrix

`src/lib/auth/capabilities.ts` is the canonical role↔capability table. v1 capabilities and their role admit set:

| Capability | admin | coach | dealer | Notes |
|---|---|---|---|---|
| `app:access` | ✅ | ✅ | ❌ | Mirrors `STAFF_APP_ROLES = {admin, staff, coach, viewer}`; `dealer` excluded. Predicate of `requireStaffAccess()` in `(app)/layout.tsx`; `<Can>` opt-out (`// expected: server-only`) — gate is server-only by design. |
| `admin:access` | ✅ | ❌ | ❌ | `/admin/lookups`, `/admin/people`, `/production`, `/dealerships` page gate. Server-only. |
| `reports:view` | ✅ | ✅ | ❌ | `/reports` page + `/reports/export` Route Handler. Server-only (the page itself is the affordance). |
| `reports:edit-billing` | ✅ | ❌ | ❌ | Admin-only inline edit of billing figures on the `/reports` Full Production Report (0059, `setBillingAdjustment`). Paired with `useCan('reports:edit-billing')` in `<ReportsTabs>` (the editable cell renders only for admins) — coaches see read-only effective values. |
| `availability:edit` | ✅ | ✅ | ❌ | 3 availability-block Server Actions (create / update / archive). Paired with `<Can capability="availability:edit">` on the `Block Date` button. Row-level ownership still enforced via `availability-authz.ts` (delegates to `coach-availability:edit-own`). |
| `production:view`, `production:export` | ✅ | ❌ | ❌ | 0028 page-gate already excludes coach |
| `dealer:view`, `dealer:edit`, `dealer:create`, `dealer:archive` | ✅ | ❌ | ❌ | Same |
| `person:view`, `person:create`, `person:edit`, `person:archive`, `person:adopt-orphan` | ✅ | ❌ | ❌ | `/admin/people` admin-only |
| `lookup:edit` | ✅ | ❌ | ❌ | `/admin/lookups` admin-only |
| `campaign:create`, `campaign:edit`, `campaign:cancel` | ✅ | ❌ | ❌ | Booking is back-office; coach is field-only |
| `email:send` | ✅ | ❌ | ❌ | Admin → external comms (client + coach confirmations + share link) |
| `coach-availability:edit-any` | ✅ | ❌ | ❌ | Holiday + company-closure rows |
| `coach-availability:edit-own` | ✅ | ✅ on own row | ❌ | Coach passes only on `kind='coach_unavailable'` AND `coachId === profile.coachContactId` |

**`<Can>` adoption** (0029 Phase 4 + 0034 + 0036): row-actions on `/admin/people` (Edit + Archive), `/dealerships` (Edit + ✕), `/admin/lookups` (Add form + Rename + ✕), the `+ Add Person` / `+ Add Dealer` / orphan `Adopt` buttons surfaced by 0034's pairing run, and the calendar `Block Date` button (added 2026-05-09 by 0036 to pair `availability:edit`). The admin-page affordances are also gated by the page-level `assertCan('admin:access')` — `<Can>` is redundant for the *current* role matrix but locks the affordance to capability-keyed intent for future expansions (e.g. when a `person:archive-own` capability lets coaches archive themselves). The Calendar `Block Date` is the exception — `/calendar` is layout-gated (`app:access`, admin || coach), so the page admits coach but the action behind Block Date is admin-or-coach-with-row-ownership; the `<Can capability="availability:edit">` wrap matches the action's capability so the affordance is hidden for any role that wouldn't pass the action gate. The top-bar `app-nav.tsx` stays on `isAdmin` boolean rather than `<Can capability="…:view">` — the nav decision is computed server-side in the layout and rendering it client-side via `useCan()` would mean a hydration round-trip for an essentially-static surface.

**Structural enforcement of the matrix** (0031 + 0032, 2026-05-08). Three independent layers, each catching a different failure mode:

- **Gate *presence*** (0031, lint-time; complemented by 0033 middleware; allow-list narrowed in 0036). A custom ESLint rule (`eslint-plugins/action-gate.mjs` → `action-gate/no-ungated-action`) wired against `src/features/**/actions.ts` (Server Actions) and `src/app/**/route.ts` (Route Handlers). The rule rejects any exported `async function` whose body doesn't reach an allow-listed gate (`assertCan`, `requireStaffAccess`). Post-0033, most gated actions are written as `export const X = capabilityClient('cap').schema(...).action(...)` — the gate is composed at the *factory* level, not as a line-1 imperative call inside the function body. The lint rule's coverage now scopes to legacy `export async function` shapes (which the auth-flow opt-outs use); the safe-action client tier itself enforces the gate on every action that uses it (auth-required is the *default*, opting out is an explicit `baseClient` choice). The only legitimate `// authz: public` exceptions today are the auth-flow Server Actions (`signInWithMagicLink`, `signInWithGoogle`, `signOut`) and the OAuth `/auth/callback` GET handler.
- **Gate *admit set*** (0032, test-time). `src/features/__tests__/action-gate-matrix.ts` is the executable twin of the per-action gate matrix above — one row per gated action with the expected outcome (`allow` / `redirect:/login` / `redirect:/`) for each of four roles (unauth / admin / coach / orphan). The matching `action-gate-matrix.test.ts` harness mocks `getUser` + `loadCurrentMembership` + `redirect` + `db` and drives every row × every role, asserting the documented outcome. A drift-detection test re-walks the gated source surface and fails if a new action lands without a matrix entry. **Adding a new gated action requires adding a matrix row before CI passes** — that's the load-bearing guarantee.
- **Gate *symmetry*** (0034, CI-time). `scripts/check-capability-pairing.mjs` (run via `pnpm check:capability-pairing`) extracts every capability used in UI affordances (`<Can capability="X">` + `useCan('X')`) and every capability gated server-side (`assertCan('X')` + `can(profile, 'X')`), diffs the two sets, and exits non-zero on either side missing the other. Catches the asymmetric mistakes: a button shipped without a server gate (high-impact security leak) and an action gated server-side without a UI affordance pointing at it (UX leak / orphaned capability). Per-line opt-out via `// expected: server-only` (e.g. `production:export` Route Handler — no UI button) or `// expected: ui-only` (rare — for a capability the server enforces by some non-capability path). 14/14 capabilities paired or opted out as of 0034.

## Defence in depth (RLS + audit log)

Beyond the action-level gates, two layers below them harden the picture:

**Row Level Security on every public table** (drizzle/0003_enable_rls.sql, 2026-05-06). Every domain table has RLS enabled with two policies: `<table>_service_role_all` (FOR ALL TO `service_role` USING true) and `<table>_staff_all` (FOR ALL TO `authenticated` USING `public.is_staff_member()`). Today this is invisible to the staff app — Drizzle connects as the `postgres` Postgres role, which has `BYPASSRLS=t` (verified at write time), so policies don't run on the Drizzle path. The point is the day a JWT-bearing query path exists (the dealer portal): PostgREST sets the role to `authenticated`, the policies run, and a coach-with-no-membership (or anon) sees zero rows — even if a route handler forgot to filter. `is_staff_member()` is `STABLE, SECURITY DEFINER, search_path=''` so it can answer the question even when its underlying tables are RLS-locked against the calling role.

**Forensic `audit_log`** (drizzle/0004_worthless_titanium_man.sql, 2026-05-06). Append-only table written by `recordAudit({ action, targetTable, targetId, payload? })` from inside sensitive Server Actions. Today the wired emit-points are: `archivePerson` → `user.deactivated`; `updatePerson` (when roles changed) → `user.role_changed` with `payload: { before, after }`; `updatePerson` on→off auth-ban → `user.deactivated`; `createPerson` (with non-empty roles) → `user.role_changed` with `before: []`; `archiveDealer` → `dealer.archived`; `cancelCampaign` → `campaign.cancelled`; `convertProspectToActive` → `dealer.activated`; `createQuote` / `sendQuote` / `acceptQuote` / `declineQuote` (all staff-side) → `quote.create` / `quote.sent` / `quote.accepted` / `quote.declined`. `actorRole` is denormalised at write time. The helper is **best-effort**: insert failures log via `console.error` rather than rejecting the action — the wired actions span DB+auth boundaries, so wrapping audit in the mutation tx wouldn't actually buy atomicity. Forensic gaps are visible in deploy logs (grep `audit insert failed`).

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
