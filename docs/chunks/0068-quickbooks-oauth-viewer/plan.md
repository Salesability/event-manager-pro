# 0068 — QuickBooks in-app OAuth viewer · plan

**Intent:** [`intent.md`](intent.md)
**Started:** 2026-06-08

## Progress Tracker

| Phase | Status | Commit |
|-------|--------|--------|
| 1: Connection storage + token crypto (db-conventions) | Done | `177ebfa` |
| 2: OAuth connect / callback / refresh / disconnect + config | Pending | - |
| 3: Admin viewer page (read + display) + nav item | Pending | - |
| 4: Tests + smoke verification | Pending | - |

The in-app OAuth slice 0060 deferred: an admin connects QuickBooks (sandbox) from **Admin → QuickBooks**, the
callback persists `realmId` + encrypted tokens, and the page live-fetches and **displays** the sandbox company's
customers (no DB writes). "Done" = a clean OAuth round-trip, a transparently-refreshed access token, a rendered
customer list, and a working Disconnect — all behind `admin:access`.

## Code Anchors

| New code | Anchor (`path:line`) | Why this anchor |
|----------|---------------------|-----------------|
| `src/lib/db/schema/quickbooks-connection.ts` (singleton connection row) | `src/lib/db/schema/tax-rates.ts` | Small single-table schema; `bigIdentity` + `timestamps` mixins; edited-in-place row (not archived). |
| `src/lib/crypto/sealed-box.ts` (AES-256-GCM encrypt/decrypt) | *(none — new; Node `crypto`)* | No encryption helper exists in the repo. Keep minimal: `encrypt(plaintext)→string`, `decrypt(string)→plaintext`, key from `QBO_TOKEN_ENC_KEY`. Named `sealed-box` (not `secret-box`) to dodge the `*secret*` .gitignore catch-all. |
| `src/lib/quickbooks/client.ts` (token exchange + refresh + `fetchCustomers`) | `src/lib/boldsign/client.ts:21` + `scripts/import-from-quickbooks.ts:129` | `server-only` external-API client reading env config; mirror BoldSign's `client()`/result-type shape; lift the script's `fetchAllCustomers` query/pagination. |
| `src/app/auth/quickbooks/callback/route.ts` (code→token exchange) | `src/app/auth/callback/route.ts:17,29` | OAuth-code-exchange route handler — `resolveOrigin` + `GET`, read `code`/`state`/`realmId`, redirect back on success/error. |
| `src/features/quickbooks/actions.ts` (connect-initiation, disconnect) | `src/features/auth/actions.ts:13,36` | Admin-gated Server Action that builds an OAuth authorize redirect via the `siteUrl()` helper. |
| `src/app/(app)/admin/quickbooks/page.tsx` + feature component | `src/app/(app)/admin/send-test-msa/page.tsx:9` | Admin page shell: `await assertCan('admin:access')` → `PageHeader` + feature component. |
| nav item in `src/components/app/app-nav.tsx` | `src/components/app/app-nav.tsx:41` (`Send Test MSA` tab) | New sibling `ADMIN_TABS` entry `{ href: '/admin/quickbooks', label: 'QuickBooks' }`. |
| secret wiring in `deploy.sh` | `deploy.sh:207` (`ensure_secret boldsign-api-key`) | Sibling `ensure_secret` lines for `qbo-client-id` / `qbo-client-secret` / `qbo-token-enc-key`. |

**Conventions referenced:**
- `docs/wiki/auth.md` — admin gating: `assertCan('admin:access')` on the page + `ADMIN_PATHS` in `src/lib/supabase/middleware.ts:14` (already covers `/admin/*` — no middleware edit needed).
- `CLAUDE.md` → Conventions — **mutations are Server Actions; route handlers are for external callers only.** Connect/Disconnect = actions; the Intuit callback = route handler.
- `db-conventions` skill — **invoke before** writing the schema file + migration (Phase 1). ID/type defaults, audit columns, direct-vs-pooled migration rule.
- `docs/chunks/0060-quickbooks-integration/research.md` — OAuth flow, `realmId` gotcha, token lifetimes/rotation, sandbox host; `scripts/import-from-quickbooks.ts` — the existing hand-rolled QBO fetch to lift.

**Overall Progress:** 25% (1/4 phases complete)

**Note:**
- Each phase includes both implementation and tests.
- Integration/smoke verification comes last, after the flow is wired.
- **Owner-side prerequisite (parallel to Phase 1):** register the redirect URI(s) on the Intuit **sandbox** app
  (`http://localhost:3000/auth/quickbooks/callback` for dev + the deployed `SITE_URL` callback) and confirm the
  client ID/secret in Secret Manager are the **sandbox** pair. Capture in a `runbook.md` like 0060's.

### Phase Checklist

#### Phase 1: Connection storage + token crypto (db-conventions)
- [x] **Invoke `db-conventions`** before touching schema.
- [x] `src/lib/db/schema/quickbooks-connection.ts` — singleton row: `realmId text notNull`, `accessTokenEnc text`,
      `refreshTokenEnc text`, `accessTokenExpiresAt timestamptz`, `refreshTokenExpiresAt timestamptz`,
      `connectedById` (→ `authUsers`), `...timestamps`. Singleton enforced by a `singleton boolean` with a UNIQUE index + CHECK (true), upserted via `onConflictDoUpdate({ target: singleton })`.
- [x] Export from `src/lib/db/schema/index.ts`; generated `drizzle/0031_chubby_skrulls.sql` (clean — no stray `auth` schema DDL; journal `when` monotonic) and **applied to sandbox** (session pooler :5432).
- [x] `src/lib/crypto/sealed-box.ts` — AES-256-GCM `encrypt`/`decrypt` keyed by `QBO_TOKEN_ENC_KEY` (base64 32-byte; `v1.<base64(iv|tag|ct)>` format). Renamed from `secret-box` to dodge the `*secret*` .gitignore rule.
- [x] Unit test (`sealed-box.test.ts`): round-trip, fresh-IV, UTF-8/empty, tampered-ciphertext throws, missing-key + wrong-length errors.

#### Phase 2: OAuth connect / callback / refresh / disconnect + config
- [ ] `src/lib/quickbooks/client.ts` — config (`QBO_CLIENT_ID`/`QBO_CLIENT_SECRET`/`QBO_ENV` → sandbox host + endpoints),
      `buildAuthorizeUrl(state)`, `exchangeCode(code)`, `refreshTokens(refreshToken)`, `getValidAccessToken()`
      (refresh when expired, persist rotated refresh token), `revoke(token)`, `fetchCustomers()` (lift from script).
- [ ] `src/features/quickbooks/actions.ts` — `connectQuickbooks()` (admin-gated; set signed `state` cookie; redirect to
      authorize URL) and `disconnectQuickbooks()` (revoke + delete row).
- [ ] `src/app/auth/quickbooks/callback/route.ts` — validate `state` cookie, exchange `code`, capture `realmId`,
      write the encrypted connection row, redirect to `/admin/quickbooks` (error → an error query param on the page).
- [ ] Config: add `QBO_CLIENT_ID` / `QBO_CLIENT_SECRET` / `QBO_ENV` / `QBO_TOKEN_ENC_KEY` to `.env.example` (+ local `.env.local`);
      wire `ensure_secret` + grant + `--set-secrets`/env in `deploy.sh` (sandbox values; prod env-keying is a follow-up).
- [ ] Tests: token-exchange + refresh request shape (Basic-auth header, body, rotation persistence) mocked; `state` mismatch rejected.

#### Phase 3: Admin viewer page (read + display) + nav item
- [ ] `src/app/(app)/admin/quickbooks/page.tsx` — `await assertCan('admin:access')`; if no connection → Connect button
      (calls `connectQuickbooks`); if connected → status (realm, last-refresh), the customer list, and a Disconnect button.
- [ ] Feature component(s) under `src/features/quickbooks/` render the connect/disconnect controls + the customer table
      (company name, primary email/phone) from a server-side `fetchCustomers()` call. **No DB writes.**
- [ ] Add `{ href: '/admin/quickbooks', label: 'QuickBooks' }` to `ADMIN_TABS` in `src/components/app/app-nav.tsx`.
- [ ] Surface a friendly error state when the fetch 401s / connection is stale (prompt re-connect).

#### Phase 4: Tests + smoke verification
- [ ] Unit: `getValidAccessToken()` refreshes on expiry and re-stores the rotated refresh token; `fetchCustomers()` paginates.
- [ ] Unit: callback rejects a missing/forged `state`; stores realmId + encrypted (not plaintext) tokens.
- [ ] Smoke (web-test): `goto /admin/quickbooks`; expect heading "QuickBooks" + a `Connect to QuickBooks` button
      (disconnected state — the auth-injected admin will not have a live connection).
- [ ] Smoke (web-test): confirm the nav **Admin → QuickBooks** item is present and routes to `/admin/quickbooks`.
- [ ] Manual (owner, can't be auto-driven — leaves Intuit's domain): full Connect round-trip against the sandbox
      company → customer list renders → Disconnect. Record the run in `runbook.md`.

## Out of scope (later slices)
- Import/upsert QBO customers → `dealers` from the UI (stays the 0060 script); `external_account_links` table.
- Production keys + env-keyed prod secret wiring (BoldSign-style); nightly keep-alive refresh cron.
- Push direction (accepted Quote → QBO Estimate/Invoice) and any living webhook/CDC sync.
