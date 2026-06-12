# Security

The layered controls protecting the staff app + the policies the dealer portal will rely on when it ships. This page is the map; each layer's mechanics live on its own wiki page.

> Part of `docs/wiki/`. Companion pages: [auth.md](auth.md) (identity + RBAC + the per-action role matrix), [data-model.md](data-model.md) (which tables hold what), [conventions.md](conventions.md) (Drizzle vs `supabase-js` split). Forward-looking strategy in [`docs/strategy/`](../strategy/index.md).

## Threat models

Two surfaces, two assumptions:

**Staff app (today).** Closed-signup, ~10 internal employees, all admins-or-trusted-staff. Threat model is *insider mistakes* and *future-portal pre-conditions* more than active attackers. RLS is invisible defence-in-depth (Drizzle bypasses); audit_log is forensics ("who deactivated user X two months ago"); the role gates protect against a misconfigured Server Action exposing more than intended. Public attack surface: `/share/coach/[id]` (read-only), `/login` (Supabase-managed), `/auth/callback` (Supabase-managed). No public-form-of-record yet (`book-your-event` intake is parked at 0016).

**Dealer portal (future, the day it ships).** Multi-tenant, untrusted-ish users (dealer staff at customer dealerships) reading their own dealer's records. Threat model includes hostile users probing the API. The bulk of the protection is RLS — a coach-belonging-to-Dealer-A cannot SELECT rows that belong to Dealer-B even if a route handler forgets the `WHERE` clause. Today the portal isn't built; the *policies* it'll need are.

## Layers

Top to bottom. Cheaper-and-more-likely-to-be-hit-first first.

### 1. Edge — `src/proxy.ts` + `src/lib/supabase/middleware.ts`

Single edge gate. Sends unauthenticated requests to `/login?next=…` for any path not in `PUBLIC_PATHS` (`/login`, `/auth/callback`, `/auth/auth-error`, `/share/coach`). Sends signed-in non-admins hitting `/admin/*` back to `/`. **No DB reads** — gate is `user.app_metadata?.role === 'admin'` from the JWT.

What this catches: drive-by URL guessing, cookie-less requests, expired sessions. What it misses: anything bypassing the proxy (Route Handlers under `(app)/*` go through the middleware on standard navigation but a direct API POST to a Server Action endpoint goes through it too — so this layer DOES apply to actions, but it's the cheapest layer).

### 2. Layout — `src/lib/auth/require-staff-access.ts`

Runs in `(app)/layout.tsx` (covers all gated pages). Wraps the `app:access` capability predicate with friendly auth-error redirects: admin-via-JWT, or any active `team_member_roles` row whose role is in `STAFF_APP_ROLES = {admin, staff, coach, viewer}` (via React-`cache()`-wrapped `loadCurrentMembership()`). Dealer-only contacts get `/auth/auth-error?reason=Portal+not+yet+available`; unprovisioned auth users get `/auth/auth-error?reason=Account+not+provisioned`. The wrapper exists because bare `assertCan('app:access')` redirects to `/`, which is inside `(app)/` and would loop; the predicate is canonical, only the redirect-target UX is layout-specific.

What this catches: a signed-in customer-only auth user typing `/calendar` directly (no team-member row → portal-or-error). What it misses: Server Actions invoked via direct POST without rendering a layout.

### 3. Action — `src/lib/auth/assert-can.ts` + `src/lib/actions/action-client.ts`

The deepest enforcement layer. Every Server Action and Route Handler runs through the capability layer (capabilities-only at gates, durable as of 0036, 2026-05-09):
- **Server Actions** use the next-safe-action middleware factory: `capabilityClient('cap').schema(...).action(async ({ parsedInput, ctx }) => { ... })` (0033). The middleware composes auth (`getUser` → `redirect('/login')`) and capability check (`assertCan(cap)` → `redirect('/')`) ahead of every action body, so writing an unauthed action requires explicit opt-out (`baseClient` with `// authz: public`).
- **Route Handlers** (which don't run through the safe-action middleware) call `await assertCan(cap)` imperatively at the top.
- **Pages** call `await assertCan(cap)` before any DB read.

All three flows route the predicate through `src/lib/auth/capabilities.ts`'s pure `can(profile, capability, resource?) → boolean`. Returns the `User` on success so callers can use `user.id` for audit columns and `user.email` for outbound mail `replyTo`; redirects on deny.

**Server Actions are public-API-shaped** — a direct POST bypasses the layout — so this layer is load-bearing, not just defence-in-depth. Per-action gate matrix in [auth.md → Per-action gate matrix](auth.md#per-action-gate-matrix); capability ↔ role matrix in [auth.md → Capability matrix](auth.md#capability-matrix).

**Capabilities are intent + security.** `assertCan` redirects on deny, and that server-side gate is what prevents privilege escalation. The companion `<Can>` / `useCan()` client PEP (`src/components/auth/`) hides UI affordances based on the same predicate, but a determined client can always hand-craft a FormData submit — every `<Can>` must pair with the corresponding server-side gate. The 0034 pairing CI script enforces both-sides-paired discipline; today 18/18 capabilities are paired or per-line opted out.

Special case: **`*AvailabilityBlock` actions also call `ensureAvailabilityOwnership(user, ...facets)`** to enforce row-level "is this your own block?" — admin bypasses; non-admin coach can only mutate `kind='coach_unavailable'` rows where `coach_id` matches their own contact. Post-0029 the predicate delegates to `can(profile, 'coach-availability:edit-own', facet)` so the rule lives in capabilities.ts; the soft-error `{ error }` return contract is preserved because "you tried to edit another coach's row" is a validation error, not an auth error. The non-admin UPDATE/archive `WHERE` also pins `kind` + `coach_id` for TOCTOU safety. See `src/features/schedule/availability-authz.ts`.

### 4. RLS — `drizzle/0003_enable_rls.sql` (+ per-table follow-ups)

Postgres Row Level Security on **every** public table. The baseline is `0003_enable_rls.sql`; each table added since gets its own RLS migration that mirrors the pattern: `0004` (`audit_log`), `0009` (`master_service_agreements`), `0010` (`quotes`), `0014` (`service_items`), `0023` (`billing_adjustments`), `0036` (`quote_line_items`, `tax_rates`, `quickbooks_connection`). Standard shape is two policies per table:

- `<table>_service_role_all` (FOR ALL TO `service_role` USING true) — for `supabase-js`'s admin client.
- `<table>_staff_all` (FOR ALL TO `authenticated` USING `public.is_staff_member()`) — what enforces "staff sees all, non-staff sees nothing" the day a JWT-bearing path exists.

**Exception — `quickbooks_connection` (secrets table).** It holds encrypted QBO OAuth tokens that no JWT-bearing path should ever read, so it gets the `service_role` policy *only*. RLS-on with no `authenticated` policy = default-deny for both `anon` and `authenticated`; the app reaches it solely via Drizzle (BYPASSRLS).

**Maintenance invariant — every new public table needs an RLS migration.** `0003`'s `ENABLE` statements only covered the tables that existed in 2026-05. Tables created later (`quote_line_items` in 0024, `tax_rates`, `quickbooks_connection`) shipped RLS-*disabled* and were caught by Supabase's `rls_disabled_in_public` advisor on prod (2026-06-08), closed by `0036` (2026-06-11). When adding a `pgTable`, add the matching `enable row level security` + policies in the same chunk. Audit at any time with the query in *Where to look* below — `rowsecurity = false` rows are the gap.

`is_staff_member()` is `STABLE, SECURITY DEFINER, search_path=''` so it can answer the question even when its underlying tables are RLS-locked against the calling role. anon falls through to default-deny (no policy).

**Drizzle's `postgres` connection role has `BYPASSRLS=t` (verified at write time)**, so policies are inert on the staff app's data path today. They light up the day the portal queries via `supabase-js` + JWT through PostgREST. The existing `/share/coach/[id]` public surface goes through Drizzle (BYPASSRLS), not anon — so no anon read policies are needed.

`audit_log` itself has RLS too: `audit_log_service_role_all` (FOR ALL) and `audit_log_authenticated_read_own` (FOR SELECT, `actor_user_id = auth.uid()`). No anon, default-deny.

#### The Data API (PostgREST) is the only reason RLS matters here

The anon key (`NEXT_PUBLIC_SUPABASE_ANON_KEY`) is exposed in the browser bundle and edge middleware, and it must be — it powers **Supabase Auth only**: `signInWithOtp`, `signInWithOAuth`, `exchangeCodeForSession`, `signOut`, `getUser`, session refresh (`src/lib/supabase/{client,server,session,middleware}.ts`). It is *designed* to be public; alone it grants nothing. Its two distinct powers are (1) reach the Auth service (`/auth/v1/*`) — needed; (2) reach the **Data API / PostgREST** (`/rest/v1/*`) as the `anon`/`authenticated` Postgres role, gated only by RLS — **not used by this app at all.**

Verified: the codebase makes **zero** `supabase.from()/.rpc()/.storage/.channel()` calls. 100% of data access is Drizzle (BYPASSRLS); the service-role client is server-only for `auth.admin.*` user management. So PostgREST serving the `public` schema is pure attack surface — it's exactly what made the RLS-off tables reachable in the `0036` incident.

**Recommended structural hardening — disable the Data API (status: pending dashboard action).** Project Settings → API → *Data API* (toggle off) or remove `public` from *Exposed schemas*, on **both prod and stage**. Auth is a separate service and is unaffected. With the Data API off, the anon key is auth-only and no table is reachable through the API *regardless of RLS state* — which closes the entire *class* of bug (a forgotten per-table RLS migration) rather than relying on the maintenance invariant above, which is the discipline that failed in `0036`. Keep RLS enabled too (belt-and-suspenders; keeps the advisor green). The only future consumer that would want PostgREST back is the not-yet-built dealer portal sketched below — and that portal can equally run on Drizzle + Server Actions, the app's actual pattern.

### 5. Forensic — `src/features/audit/actions.ts:recordAudit()`

Append-only write to `public.audit_log` from inside each sensitive Server Action *after* the mutation lands. Captures `actor_user_id`, `actor_role` (denormalised at write time from `app_metadata.role`), `action` (enum), `target_table`, `target_id`, `payload` (jsonb).

Wired emit points (2026-05-06):

| Action | Event |
|---|---|
| `archivePerson` | `user.deactivated` |
| `updatePerson` (when roles changed) | `user.role_changed` with `{ before, after }` |
| `updatePerson` on→off auth ban | `user.deactivated` with `{ authUserId, via: 'updatePerson' }` |
| `createPerson` (with non-empty roles) | `user.role_changed` with `before: []` |
| `archiveDealer` | `dealer.archived` |
| `cancelCampaign` | `campaign.cancelled` |

The helper is **best-effort**: insert failures log via `console.error('audit insert failed', { ... })` rather than rejecting the action. The wired actions span DB+auth boundaries (Supabase admin API), so wrapping audit in the mutation tx wouldn't actually keep the operation atomic. Forensic gaps are visible in deploy logs.

`audit_log` is forensics, not enforcement. Don't read it on the hot path.

## Network + transport

- **TLS** — Cloud Run terminates HTTPS; the dev server runs HTTP locally. SITE_URL must reflect the deployed origin (no header fallback after 0019 Phase 7).
- **Cookies** — HTTP-only, set by `@supabase/ssr`'s middleware. SameSite + Secure are framework defaults; not adjusted.
- **CORS** — none configured; staff app is same-origin.
- **Rate limiting** — none today. Email sends in particular are vulnerable to replay; the parked Codex High from 0011 is still open after 0019 Phase 7. Plan a dedicated chunk before the booking-intake (0016) ships any public surface.

## Email-send hardening (0019 Phase 7, 2026-05-06)

- **`siteUrl()` reads `process.env.SITE_URL` only** — no Host-header fallback. The operator-set env var IS the allowlist. Returns an error if unset; the calling action surfaces the misconfig instead of silently producing a wrong-host URL inside an outbound email.
- **Status gate** — `sendClientCampaignConfirmation` and `sendCoachCampaignConfirmation` reject any campaign whose status isn't `booked`. Stops replay of confirmations against cancelled/completed campaigns.
- **Inverted dev-redirect** — `lib/email/send.ts` now defaults to fail-safe-prod: `APP_ENV=production` (case + whitespace-normalised) → real-send; non-prod with `EMAIL_DEV_TO` set → redirect to dev inbox with `[DEV→original@…]` subject prefix; non-prod without `EMAIL_DEV_TO` → refuse. Misconfigured deploys can never silently real-send to a customer.

## Where to look when investigating

| Question | Grep / file |
|---|---|
| Did the action gate run? | `src/lib/auth/assert-can.ts`, `src/lib/actions/action-client.ts` (capabilityClient middleware), `src/lib/auth/require-staff-access.ts` (callers in `src/features/*/actions.ts`, `src/app/(app)/**/page.tsx`, `src/app/**/route.ts`) |
| Who did this admin-y thing two months ago? | `select * from audit_log where action = ? and target_id = ? order by occurred_at desc;` |
| Is RLS actually enabled? | `select tablename, rowsecurity from pg_tables where schemaname='public';` |
| What policies exist? | `select tablename, policyname, roles, cmd from pg_policies where schemaname='public';` |
| Which connection role does Drizzle use? | `.env.local` → `DATABASE_URL`; verify with `select current_user, rolbypassrls from pg_roles where rolname=current_user;` |
| Did an audit insert fail? | grep deploy logs for `audit insert failed` |
| Did a Server Action receive an unauthenticated POST? | grep deploy logs for redirect-to-`/login` traces; the `capabilityClient` middleware always redirects loudly before any DB write |
| Did an outbound email use the wrong origin? | `lib/email/send.ts` log lines + `process.env.SITE_URL` on the deploy |

## Out of scope

- **Pen-testing or external audit.** Worth doing before any public-form-of-record opens.
- **Rate limiting on emails / actions.** Parked Codex High from 0011 — needs a dedicated chunk (outbox table + idempotency keys + per-user buckets). Required before web intake lands (`future/0016-book-your-event-intake`).
- **Mandatory MFA for admins.** 0019 Phase 6 was parked because today's threat model (single-admin, ten-employee, closed-signup) doesn't earn the recovery-path foot-gun. Revisit before public launch.
- **Boundary-discipline `secrets-boundary.test.ts`.** 0019 Phase 5 parked: `'server-only'` already throws at build time when a Client Component imports a server module; the proposed full-build-then-grep test is genuine belt-and-suspenders but slow and low marginal value. Revisit if a regression slips past `'server-only'` in practice.
- **Per-row encryption for invoices/payments.** Will get its own threat model when payment data lands.
- **`adoptOrphanAuthUser` audit emission.** Identity-binding event but not in 0019 Phase 4's scope; folds in with the audit-log UI when that lands.
- **`actorRole` precision for non-admin actors.** Today every audited action is admin-only-gated (capabilities like `person:archive`, `dealer:archive`, `campaign:cancel`), so `actorRole` reads `'admin'` from `app_metadata.role` and is never null in practice. The day a non-admin path gains an audited action, join `team_member_roles` at write time.
- **Auth-callback host-header tightening.** `src/features/auth/actions.ts:siteUrl` still has a `headers()` fallback for OAuth/magic-link callbacks. Out of 0019 Phase 7's scope (which covered email-to-recipient). Supabase's redirect allowlist blunts most of the impact, but a small follow-up to apply the same SITE_URL-only pattern is worth it.

## Decision history

- **0019 Phase 1 (2026-05-06):** RLS enabled on every public table; policies mirror staff-access semantics. Drizzle continues to bypass via `postgres` BYPASSRLS.
- **0019 Phase 2 (2026-05-06):** `requireRole(role|role[])` generalises `requireAdmin`. 19 Server Actions audited; lookup admin → `requireRole('admin')`, mutating dealer/campaign → `['admin','staff','coach']`, availability → `['admin','coach']`, email sends → `['admin','staff','coach']`. The orphan `requireUserId()` private helper retired.
- **0019 Phase 3 (2026-05-06):** `ensureAvailabilityOwnership` row-level check on `*AvailabilityBlock` actions; admin bypasses, non-admin coach can only mutate own `coach_unavailable` rows. UPDATE/archive `WHERE` pinned to `kind` + `coach_id` for TOCTOU safety.
- **0019 Phase 4 (2026-05-06):** `audit_log` table + `recordAudit()` helper; wired into the six sensitive emit points listed above. Best-effort write semantics.
- **0019 Phase 5 (parked 2026-05-06):** `'server-only'` import is the primary defence; full-build-then-grep test is too slow for the marginal value.
- **0019 Phase 6 (parked 2026-05-06):** MFA opt-in v1 doesn't earn its keep with a single-admin team. Revisit before public launch.
- **0019 Phase 7 (2026-05-06):** Email-send hardening — SITE_URL-only origin, booked-only status gate, inverted dev-redirect with case-normalised APP_ENV.
- **0019 Phase 8 (2026-05-06):** This page + `auth.md` + `conventions.md` updates. Manual security walk-through verifying three Server Actions reject unauth calls and three RLS-enabled tables return 0 rows for a forged `authenticated` JWT.
- **RLS gap close (0036, 2026-06-11):** Supabase's advisor flagged `rls_disabled_in_public` (Critical) on prod for `quote_line_items`, `tax_rates`, `quickbooks_connection` — three tables added after the last RLS migration (`0023`) that shipped RLS-disabled. The `anon` role had full DML GRANTs, so with RLS off they were readable/writable through PostgREST by anyone with the public anon key. `0036_qbo_quote_lines_tax_rates_rls.sql` enabled RLS on all three; the first two got the standard `service_role` + staff policies, `quickbooks_connection` got `service_role`-only (secrets table). Applied to prod via `pnpm db:migrate:prod`; verified `pg_tables.rowsecurity = true` on all 19 public tables. DB-only change — no Cloud Run redeploy needed (Drizzle bypasses RLS). Stage (`qppenapeguwevcheqwpz`) had the identical gap; `0036` applied there too **2026-06-12** via `pnpm db:migrate` against the sandbox session pooler (`aws-1-us-west-2…:5432`) — verified `rowsecurity = true` on all 3 tables, zero public tables left RLS-off.
- **Data API exposure analysis (2026-06-11):** Established that the anon key is needed for **Auth only** and the app makes **zero** PostgREST Data API calls (all data via Drizzle). Recommended hardening: disable the Data API (or unexpose `public`) on prod + stage so the anon key is auth-only and forgotten-RLS tables can't be reached through the API at all — structurally closing the `0036` bug class. Status: pending dashboard toggle (operator action). See *The Data API (PostgREST) is the only reason RLS matters here* under Layer 4.
