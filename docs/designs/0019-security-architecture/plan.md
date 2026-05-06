# Secure architecture — RLS defence-in-depth + sensitive-op audit log

**Started:** 2026-05-05

The current authz posture is single-layer: `proxy.ts` rejects anonymous, and each Server Action calls `requireUserId()` (or, after 0018 ships Phase 1, `requireAdmin()`). A leaky Server Action — one that forgets the role check, or that builds a query without the right `WHERE` filter — has no second line at the database. RLS is **disabled** on every table, `auth.uid()` returns NULL on the Drizzle direct connection (`docs/wiki/data-model.md:389`), and `0002-nextjs-scaffold/decision.md:10`'s recorded intent that *"Drizzle owns the schema + migrations, Supabase owns the runtime + Auth + Storage + RLS"* has drifted in practice to *"Drizzle owns everything, Supabase owns auth only."*

This plan reverses that drift **defensively**: enable RLS on every table, but configure Drizzle to connect as a role that bypasses RLS — so existing Server Actions need no rewrite, while any future query path that *does* carry a JWT (the dealer portal, when it ships; any future `supabase-js`-based read) gets policy-enforced. Plus an `audit_log` table for forensics on sensitive operations, an explicit per-action role audit, and a small set of boundary-discipline checks.

**Done =** every domain table has RLS enabled with policies that *would* enforce per-tenant / per-role visibility if a JWT-bearing connection ever reached them; Drizzle continues to operate unchanged via a service-role connection; `audit_log` rows are written for `setUserRoles`, `deactivateUser`, `archiveCoach`, `archiveDealer`, `cancelCampaign`; every Server Action carries the right `requireRole(...)` check; admin accounts can opt into Supabase MFA; the boundary-discipline lint catches a regression where a Client Component reaches for the service-role client.

**Depends on `0018-user-system`** — the role taxonomy (admin / coach / etc.), the `requireAdmin()` helper, `loadCurrentMembership()`, the `requireStaffAccess()` gate, and the `app_metadata.role` claim are all foundations this plan reads. **0018 shipped 2026-05-05** ([`shipped/0018-user-system/plan.md`](../shipped/0018-user-system/plan.md)) — 0019 is unblocked.

## Decisions

1. **Two Postgres roles, one mental model.**
   - **Drizzle connects as `service_role`** (or a dedicated `app_writer` role with `BYPASSRLS`). Every Server Action keeps its current shape: `requireUserId` / `requireAdmin` at the top, then SQL. **No existing action is rewritten.** Drizzle is the staff-app data path; it bypasses RLS by construction.
   - **Future portal queries use `supabase-js`** with the signed-in user's JWT → hits PostgREST → RLS-policed. The portal cannot see another dealer's rows even if the route handler forgets to filter. (Portal not built here; this plan only writes the policies it would need.)
   - **Anon (the `/share/coach/[id]` tokenless path)** stays as today — the share page bypasses auth via `PUBLIC_PATHS` and queries via Drizzle. RLS policies for `anon` are written but largely just `USING (false)` because anon access goes through the explicit share route, not arbitrary table reads.

   **Considered and rejected (2026-05-05): migrating staff-app reads to `supabase-js` for native RLS enforcement.** The intuition that "going through Supabase's client feels more secure" is partly right — RLS on read paths gives policy-enforced filtering for free, and `auth.uid()` works natively without the `pass userId explicitly` pattern. **But the staff app is ~10 internal employees who all see almost everything**, so the marginal security gain over "Drizzle + Server Action authz + RLS-enabled-but-bypassed" is small, while the rewrite cost (10–15 read functions in `queries.ts` files, loss of Drizzle's relational-query ergonomics, no transactions on multi-step ops) is real. **The portal is where supabase-js + RLS earns its keep** — multi-tenant, untrusted-ish users, strict row-level isolation required. Defer the supabase-js read path to the portal plan; restore the original `0002-nextjs-scaffold/decision.md:10` hybrid intent *there*, not on the staff side.

2. **Policies match Server Action behaviour, not invent new rules.**
   The point of RLS here is *defence in depth for the same authz already enforced at the action layer*. Don't introduce new authz semantics in policies that the application doesn't already enforce. Each policy is a mirror, not an extension. Concretely: a `coaches` table read policy says *"`authenticated` role + has `team_member_roles(role∈{admin,staff,coach,viewer})` row → see all coaches"* — the same scope the staff app gives signed-in users today. The portal-relevant policies (e.g. `dealer_contacts` filtered by `auth.uid()`) are the ones that *will* matter when a JWT-bearing path exists.

3. **`audit_log` is append-only, application-written.**
   - Single `audit_log` table: `(id, occurred_at, actor_user_id, actor_role, action, target_table, target_id, payload jsonb)`. Inserts go through a tiny `recordAudit(action, …)` helper called from inside each sensitive Server Action.
   - **Not a trigger.** Triggers can't see app-level context (which call site, which user-friendly description). The helper writes the row in the same transaction as the mutation it's logging — so if the mutation rolls back, the audit row does too (acceptable; the audit is "what we did," not "what we tried").
   - **`audit_log` itself has RLS enabled** with `service_role` allowed, `authenticated` denied except for "your own actions." No-one queries it from the staff app today; future admin UI can read it.

4. **MFA is opt-in for v1, mandatory for admins in v2.**
   Phase 5 enables Supabase TOTP MFA at the project level and adds a "Set up MFA" affordance in the user-profile area. Enforcement (admins must complete MFA) is a follow-up — keeps the v1 cut shippable without locking David out mid-deploy.

5. **`DATABASE_URL` review.**
   Today's `DATABASE_URL` likely uses the `postgres` superuser via the Supabase pooler — that bypasses RLS by default but is broader than ideal. Phase 1 verifies the connection role and either:
   - Confirms `service_role` is what we want (default — least change), or
   - Creates a dedicated `app_writer` role with `BYPASSRLS` + minimal grants. Cleaner separation; one extra migration. **Recommend `service_role`** for v1; revisit if/when external observers need DB access.

## Progress Tracker

| Phase | Status | Commit |
|-------|--------|--------|
| 1: RLS-baseline migration — enable RLS + minimum policies for `service_role` / `authenticated` / `anon` on every table | Done | ae3dbe3 |
| 2: Per-action role audit — sweep every Server Action for the right `requireRole(...)` | Done | - |
| 3: `audit_log` table + `recordAudit()` helper + wire into sensitive actions | Pending | - |
| 4: Boundary-discipline checks — `'server-only'` lint + secrets-in-bundle smoke test | Parked | - |
| 5: MFA enablement (Supabase project toggle + UI affordance) | Pending | - |
| 6: Email-send hardening (fold in parked Codex findings from 0011) | Pending | - |
| 7: Wiki updates + verification (tsc + tests + /eval + smoke + manual security walk-through) | Pending | - |

## Code Anchors

For each new file or method below, the builder reads the anchor first and matches its shape (length, error handling, naming, query style).

| New code | Anchor (`path:line`) | Why this anchor |
|----------|---------------------|-----------------|
| `drizzle/0003_enable_rls.sql` (hand-written: `ALTER TABLE … ENABLE ROW LEVEL SECURITY` + `CREATE POLICY` per table) | `drizzle/0001_seed_lookups.sql` | Sibling hand-written SQL migration. Drizzle doesn't model RLS, so RLS lives in numbered SQL files alongside the generated ones (`docs/wiki/conventions.md:64`). |
| `src/lib/db/audit-log.ts` (Drizzle schema for `audit_log`) | `src/lib/db/schema/team-member-roles.ts:1` | Sibling schema — same `bigIdentity` + `actors` + `timestamps` shape, but no `archivable` (audit rows are append-only by convention). |
| `src/features/audit/actions.ts:recordAudit()` (server-only helper, transaction-aware) | `src/features/email/actions.ts:21` (`siteUrl()` helper pattern) | Same shape — small server-only helper, accepts the calling action's context, writes once. Lives in a new `src/features/audit/` directory. |
| `src/lib/auth/require-role.ts:requireRole(role)` (generalises `requireAdmin`) | `src/lib/auth/require-admin.ts` (created in 0018 P1) | Sibling — same shape, takes a role parameter. After this lands, `requireAdmin` becomes `requireRole('admin')`; existing 0018 callers swap. |
| Per-action role audit edits across `src/features/schedule/actions.ts` | self — every existing action's first 3 lines | Currently most use `requireUserId()`; the audit identifies which need `requireRole('admin')` instead. Touch each `requireUserId()` site. |
| `src/lib/auth/server-only-import.eslint.ts` (custom rule OR a `vitest` smoke test) | `eslint.config.mjs` (existing rule registry) | If a custom rule, registers into the existing config. If a test, lives next to the auth helpers and greps the build manifest. **Recommend the test** — eslint custom rules are heavyweight for a single check. |
| `drizzle/0004_audit_log.sql` (generated by Drizzle from the schema) | `drizzle/0000_cute_ser_duncan.sql` | Generated migration — same shape (Drizzle-emitted CREATE TABLE + indexes). |
| Vitest tests for RLS policies (connect as `authenticated` with a forged JWT, assert cross-tenant query returns 0 rows) | `src/lib/url.test.ts:1` (sibling pure-function test pattern) | Pure-function tests for now; RLS-integration tests live in a new `tests/integration/rls.test.ts` since they need a separate connection. |

**Conventions referenced:**
- `docs/wiki/conventions.md:17-18` — Drizzle for server SQL, supabase-js for RLS-bound reads. **This plan re-aligns the codebase with this stated intent**, which has drifted in practice.
- `docs/wiki/conventions.md:64` — RLS policies live as hand-written `.sql` files in `./drizzle/`, not generated.
- `docs/wiki/architecture.md:78-79` — same Drizzle/supabase-js split.
- `docs/wiki/data-model.md:389` — explicit note that `auth.uid()` is NULL over Drizzle's direct connection. Phase 1 doesn't change that — it just makes RLS *enabled* (so policies *would* enforce) while the Drizzle path remains a `BYPASSRLS` role.
- `db-conventions` skill — RLS policy patterns; `service_role` bypass behaviour; how to write idempotent migration scripts.

**Overall Progress:** 33% (2/6 active phases — Phase 4 parked 2026-05-06)

**Phase 4 parked (2026-05-06).** The `'server-only'` import already throws at build time when a Client Component imports a server module — that's the primary defence. The proposed `secrets-boundary.test.ts` (build the app, grep `.next/static/` for known-secret prefixes) is genuine belt-and-suspenders, but slow (full `pnpm build` per test run) and low marginal value vs. the cost of maintaining it. Revisit if a regression slips past `'server-only'` in practice, or before public launch / external audit.

**Note:**
- **No existing Server Action is rewritten by this plan.** Phase 2's "role audit" identifies *which* `requireUserId()` should become `requireRole('admin')`, but the change is a 3-character edit per call site, not a refactor.
- **The point of RLS here is the day-the-portal-ships invariant, not today's staff-app threat model.** Today the staff app is single-tenant-ish (everyone sees everything). RLS makes the next chunk — the portal, which IS multi-tenant — a one-line route swap rather than a re-architecture.
- **`audit_log` is forensics, not enforcement.** Don't read it on the hot path. It's the answer to "who deactivated user X two months ago, and why" — not "is this user allowed to do X right now."
- **MFA enforcement is deliberately deferred.** Mandatory MFA without a tested recovery path is a foot-gun. Phase 5 enables the option; mandating it for admins waits until we have account-recovery confidence.
- **The boundary-discipline check is small but high-value.** A Client Component accidentally importing the service-role client → leaks the key into the JS bundle → game over. The `'server-only'` import already throws at build, but a smoke test that reads `.next/server/` and `.next/static/` for known-secret strings is cheap belt-and-suspenders.

### Phase Checklist

#### Phase 1: RLS-baseline migration
- [x] Verify the role used by `DATABASE_URL`. If `postgres` superuser via pooler, document and proceed; if a custom role, confirm it has `BYPASSRLS`. **Drizzle connects as `postgres` via the Supabase pooler in session mode (port 5432). `pg_roles` confirms `rolsuper=f, rolbypassrls=t`. `service_role` is also `BYPASSRLS=t`. Both `authenticated` and `anon` are RLS-bound (no bypass) and have full DML grants on every public table — exactly the pre-condition that makes RLS load-bearing.**
- [x] `drizzle/0003_enable_rls.sql` — for every table in `src/lib/db/schema/` (including `auth.users` extension tables): `ALTER TABLE … ENABLE ROW LEVEL SECURITY`. Idempotent: `ALTER TABLE` is safe to re-run. **Done. `auth.users` is NOT touched (Supabase-managed, only shadowed in our schema as a FK reference).**
- [x] For each table, write minimum policies: `service_role` → ALL ALLOWED (the Drizzle path); `authenticated` → mirrors current Server Action authz (e.g. for `campaigns`, `staff with team_member_roles → SELECT all`); `anon` → mostly `USING (false)` except specific public-share read paths. **Done. Two policies per table: `<table>_service_role_all` (FOR ALL, USING true) and `<table>_staff_all` (FOR ALL TO authenticated, USING `public.is_staff_member()`). `anon` falls through to default-deny — `/share/coach/[id]` queries via Drizzle (BYPASSRLS), not via PostgREST anon, so no anon read policies are needed today. Helper function `public.is_staff_member()` is `SECURITY DEFINER, STABLE, search_path=''`, returns true iff the calling user has an unarchived `team_member_roles` row.**
- [x] Apply the migration to dev DB; smoke that **the staff app behaves identically** (every existing test still passes, every page still renders) — proves Drizzle's bypass is intact. **`pnpm db:migrate` applied 0003 cleanly (DROP POLICY IF EXISTS NOTICEs are expected idempotency noise). All 11 public tables verified `rowsecurity=t`. Drizzle connection still returns `campaigns=43, contacts=30, dealers=26` rows. Full unit suite passes 104/104. Browser smoke deferred to /eval.**
- [x] Vitest integration test (`tests/integration/rls.test.ts`): open a connection as `authenticated` with a forged JWT for user A; query `dealer_contacts` for dealer B; assert 0 rows. Proves the policy *would* enforce. **Done. 4-test suite confirms (1) all 11 tables RLS-enabled, (2) `is_staff_member()` returns false for forged JWT, (3) every RLS table returns 0 rows for forged authenticated user, (4) Drizzle's connection role still has `rolbypassrls=t`. Auto-loads `.env.local` via `process.loadEnvFile()` (Node ≥ 21.7); skipIf-guarded when `DATABASE_URL` is unset.**

#### Phase 2: Per-action role audit
- [x] Sweep every export in `src/features/schedule/actions.ts`, `src/features/email/actions.ts`, `src/features/auth/actions.ts` (including 0018 additions). **Done. Audit also covered `src/features/people/actions.ts` since the 0018 user-admin work moved there in 0020 (auth/actions.ts retired to login-only).**
- [x] For each action, decide the right gate: `requireUserId` (any signed-in) vs `requireAdmin` vs `requireRole('admin')` (alias) vs `requireRole('admin' | 'coach')` for actions a coach should be allowed to call (e.g. `updateAvailabilityBlock` on their own block). **Decision matrix:**
  - **schedule/actions.ts:** `archiveDealer`, `cancelCampaign` → `requireRole('admin')` (destructive); `*CampaignStyle` × 3 + `*SalesLeadSource` × 3 → `requireRole('admin')` (alias swap from `requireAdmin`); `createAvailabilityBlock`, `updateAvailabilityBlock`, `archiveAvailabilityBlock` → `requireRole(['admin','coach'])` per the plan example; `createDealer`, `updateDealer`, `createCampaign`, `updateCampaign` → `requireRole(['admin','staff','coach'])` (mutating; viewer excluded). Initially these four were left at `requireUserId()` on the rationale that the layout gate is sufficient defence-in-depth, but Codex correctly flagged that Server Actions are public-API-shaped — a direct POST bypasses the layout gate. Tightened in-eval; the now-orphan `requireUserId()` private helper deleted.
  - **email/actions.ts:** all three send actions (`sendClientCampaignConfirmation`, `sendCoachCampaignConfirmation`, `sendCoachShareLinkEmail`) → `requireRole(['admin','staff','coach'])` (excludes `viewer`; sends external email so a real seat-bearing role should be required). Old `requireUserEmail` helper renamed to `requireSenderEmail` and now derives the email from the User the role check returns.
  - **auth/actions.ts:** `signInWithMagicLink`, `signInWithGoogle`, `signOut` → no gate. These ARE the auth flow.
  - **people/actions.ts:** `createPerson`, `updatePerson`, `archivePerson`, `adoptOrphanAuthUser` → `requireRole('admin')` (alias swap from `requireAdmin`).
  - **Page guards:** `(app)/admin/lookups/page.tsx`, `(app)/admin/people/page.tsx` → `requireRole('admin')` (was `requireAdmin`); the now-unused `requireAdmin` async wrapper was deleted from `src/lib/auth/require-admin.ts`. The pure `isAdmin(user)` predicate stays — used by `require-staff-access.ts`, `auth/callback/route.ts`, `(app)/layout.tsx`, and the new `requireRole` itself for the JWT fast path.
- [x] Edit each action's first 3 lines accordingly. Document the decision matrix in `docs/wiki/auth.md` (added in Phase 7). **Edits applied across `src/features/schedule/actions.ts`, `src/features/email/actions.ts`, `src/features/people/actions.ts`, `src/app/(app)/admin/lookups/page.tsx`, `src/app/(app)/admin/people/page.tsx`. Wiki update parked for Phase 7 per checklist.**
- [x] Vitest tests for the new `requireRole(role)` helper (admin → ok; coach → ok for `'coach'`; coach → throws for `'admin'`; signed-in non-roled → throws for any role). **Done. `src/lib/auth/require-role.test.ts` covers 8 cases including not-signed-in (`/login`), admin via JWT fast-path (no DB hit), admin in a multi-role list, coach via membership lookup, coach denied for admin-only, no membership row → `/`, role intersection misses → `/`. People actions test mock updated to mock `@/lib/auth/require-role` (the new boundary).**

#### Phase 3: `audit_log` + `recordAudit()`
- [ ] `src/lib/db/schema/audit-log.ts` — table with `id`, `occurredAt`, `actorUserId`, `actorRole` (denormalised at write time), `action` (enum: `user.role_changed | user.deactivated | coach.archived | dealer.archived | campaign.cancelled`), `targetTable` (text), `targetId` (bigint), `payload` (jsonb).
- [ ] `pnpm db:generate` → review → commit `drizzle/0004_audit_log.sql`.
- [ ] `src/features/audit/actions.ts:recordAudit({ action, targetTable, targetId, payload })` — `'server-only'` import; reads current user via existing helpers; writes a row.
- [ ] Wire `recordAudit()` into: `setUserRoles`, `deactivateUser` (0018 P1); `archiveCoach`, `archiveDealer`, `cancelCampaign` (existing).
- [ ] Vitest test for `recordAudit()` happy path + the 5 wired actions emit rows of the right shape.

#### Phase 4: Boundary-discipline checks
- [ ] Verify `'server-only'` import is present in: `src/lib/supabase/admin.ts` (0018 P1), `src/lib/db/index.ts`, `src/features/audit/actions.ts`, `src/lib/email/send.ts`. Add where missing.
- [ ] `tests/integration/secrets-boundary.test.ts` — build the app (`pnpm build`), then grep `.next/static/` for known-secret strings (`SUPABASE_SERVICE_ROLE_KEY`'s first 12 chars, `RESEND_API_KEY`'s prefix, `DATABASE_URL` host). Fails if any are found.
- [ ] Document the test in `docs/wiki/conventions.md`.

#### Phase 5: MFA enablement
- [ ] Supabase project: enable TOTP factor at the Auth Settings level.
- [ ] `src/app/(app)/account/mfa/page.tsx` — Server Component, "Set up MFA" affordance. Calls `supabase.auth.mfa.enroll({ factorType: 'totp' })`, displays QR + secret, accepts the verification code.
- [ ] Anchor: `src/app/login/page.tsx:1` (sibling auth-flow page).
- [ ] Smoke (web-test): `goto /account/mfa` (gated); QR + verification field render. **Don't actually enroll** — that mutates real auth state.

#### Phase 6: Email-send hardening
- [ ] Address parked Codex findings from `shipped/0011-email-send/eval-2026-05-01-1609.md`:
  - **Host-header allowlist** — `siteUrl()` (`src/features/email/actions.ts:21`) currently builds the URL from request headers; an attacker controlling `Host` can redirect coach links. Replace with `process.env.NEXT_PUBLIC_SITE_URL` allowlisted to known origins.
  - **Status check before send** — `sendClientCampaignConfirmation` and `sendCoachCampaignConfirmation` don't check `campaign.status` before emailing; rejected/cancelled campaigns can be replayed. Reject anything except `booked`.
  - **`EMAIL_FORCE_DEV_REDIRECT=true` flag** — invert the dev-redirect logic so production explicitly opts out of redirection rather than implicitly opting in via `APP_ENV`.
- [ ] Vitest tests for each.

#### Phase 7: Wiki updates + verification
- [ ] Rewrite `docs/wiki/auth.md` — RBAC section reflects `requireRole(role)`; add a "Defence in Depth" section describing the RLS layer and the `audit_log`.
- [ ] Update `docs/wiki/conventions.md:17-18` to describe the *current* state accurately (Drizzle bypasses RLS via service-role; supabase-js path is reserved for the portal) and reference this plan as where the alignment was restored.
- [ ] Add `docs/wiki/security.md` (new) — single page describing: the five layers, the threat model the staff app assumes, the threat model the portal will assume, where each control lives in the codebase, what to grep when investigating an incident.
- [ ] Append to `docs/wiki/log.md`.
- [ ] `pnpm tsc --noEmit` clean.
- [ ] `pnpm test` clean (including the new RLS integration test + secrets-boundary test).
- [ ] /eval against `0019-security-architecture/plan.md`.
- [ ] Manual security walk-through: pick three Server Actions, attempt an unauthorised call (admin-required action with a non-admin session) and confirm it 403s; pick three tables, attempt a cross-tenant read via a forged `authenticated` JWT and confirm 0 rows.

## Out of scope (explicitly)

- **Portal-side queries via supabase-js.** This plan writes the *policies* the portal will need; the portal route handlers, the supabase-js setup, and the redaction model (which campaign fields a `customer` sees vs hides) live in the portal plan.
- **Mandatory MFA for admins.** Plan enables the option; enforcement waits for a tested account-recovery flow.
- **DB encryption at rest beyond Supabase defaults.** Supabase Postgres is encrypted at rest by the provider; we don't add column-level encryption.
- **Pen-testing or external audit.** Worth doing before public launch; not in scope here.
- **Rate limiting.** The `/book-your-event` public form (parked at `0016-book-your-event-intake`) needs it; covered there.
- **Audit-log UI.** Phase 3 writes rows; reading them via an admin UI is a follow-up.
- **Per-row encryption for invoices/payments** (line 95 of port-migration: Quote → Contract → Invoice → Payment). When payment data lands, that gets its own threat model.
