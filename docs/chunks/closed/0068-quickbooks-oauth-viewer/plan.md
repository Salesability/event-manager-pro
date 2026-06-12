# 0068 — QuickBooks in-app OAuth viewer · plan

**Intent:** [`intent.md`](intent.md)
**Started:** 2026-06-08

## Progress Tracker

| Phase | Status | Commit |
|-------|--------|--------|
| 1: Connection storage + token crypto (db-conventions) | Done | `177ebfa` |
| 2: OAuth connect / callback / refresh / disconnect + config | Done | `a678ca6` |
| 3: Admin viewer page (read + display) + nav item | Done | `aa199eb` |
| 4: Tests + smoke verification | Done | `0338e63` |

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
| `src/lib/quickbooks/connection.ts` (singleton persistence + `getValidAccessToken`) | `src/features/reports/actions.ts:62` (upsert idiom) + `src/lib/crypto/sealed-box.ts` | Drizzle singleton upsert via `onConflictDoUpdate({ target: singleton })`; encrypt tokens at rest. Split from `client.ts` so HTTP stays DB-free + unit-testable. |
| `src/app/auth/quickbooks/callback/route.ts` (code→token exchange) | `src/app/auth/callback/route.ts:17,29` | OAuth-code-exchange route handler — `resolveOrigin` + `GET`, read `code`/`state`/`realmId`, redirect back on success/error. |
| `src/features/quickbooks/actions.ts` (connect-initiation, disconnect) | `src/features/auth/actions.ts:13,36` | Admin-gated Server Action that builds an OAuth authorize redirect via the `siteUrl()` helper. |
| `src/app/(app)/admin/quickbooks/page.tsx` + feature component | `src/app/(app)/admin/send-test-msa/page.tsx:9` | Admin page shell: `await assertCan('admin:access')` → `PageHeader` + feature component. |
| `src/features/quickbooks/quickbooks-admin.tsx` (viewer UI) | `src/features/msa/send-test-msa-form.tsx` (admin feature component) + catalyst `Table`/`Button`/`Badge` | Server component using `<form action={serverAction}>` (no client JS); catalyst design-system table for the customer list. |
| nav item in `src/components/app/app-nav.tsx` | `src/components/app/app-nav.tsx:41` (`Send Test MSA` tab) | New sibling `ADMIN_TABS` entry `{ href: '/admin/quickbooks', label: 'QuickBooks' }`. |
| secret wiring in `deploy.sh` | `deploy.sh:207` (`ensure_secret boldsign-api-key`) | Sibling `ensure_secret` lines for `qbo-client-id` / `qbo-client-secret` / `qbo-token-enc-key`. |

**Conventions referenced:**
- `docs/wiki/auth.md` — admin gating: `assertCan('admin:access')` on the page + `ADMIN_PATHS` in `src/lib/supabase/middleware.ts:14` (already covers `/admin/*` — no middleware edit needed).
- `CLAUDE.md` → Conventions — **mutations are Server Actions; route handlers are for external callers only.** Connect/Disconnect = actions; the Intuit callback = route handler.
- `db-conventions` skill — **invoke before** writing the schema file + migration (Phase 1). ID/type defaults, audit columns, direct-vs-pooled migration rule.
- `docs/chunks/closed/0060-quickbooks-integration/research.md` — OAuth flow, `realmId` gotcha, token lifetimes/rotation, sandbox host; `scripts/import-from-quickbooks.ts` — the existing hand-rolled QBO fetch to lift.

**Overall Progress:** 100% (4/4 phases complete) — browser smoke + Codex run in the chunk-end `/eval`; the owner round-trip is manual.

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
- [x] `src/lib/quickbooks/client.ts` — pure HTTP: `qboConfig()`, `buildAuthorizeUrl`, `exchangeCodeForTokens`, `refreshTokens`, `revokeToken`, `fetchCustomers` (lifted from the script), `verifyState` (constant-time CSRF). Shared `QBO_STATE_COOKIE` / `QBO_CALLBACK_PATH` / `quickbooksRedirectUri` so authorize + token-exchange use a byte-identical `redirect_uri`.
- [x] `src/lib/quickbooks/connection.ts` — **new module** (persistence + lifecycle split out of client.ts): `getConnection`/`saveConnection`/`deleteConnection` (singleton upsert, tokens encrypted via `sealed-box`), `getValidAccessToken()` (refresh-on-expiry + rotate-persist), pure `computeExpiry`/`accessTokenFresh`.
- [x] `src/features/quickbooks/actions.ts` — `connectQuickbooks()` (admin-gated; random `state` in httpOnly+lax cookie; redirect to authorize URL) and `disconnectQuickbooks()` (revoke + delete row, then `revalidatePath` in place — no redirect). Added both to the action-gate matrix (`src/features/__tests__/action-gate-matrix.ts`, ADMIN_ONLY).
- [x] `src/app/auth/quickbooks/callback/route.ts` — `verifyState` cookie vs param (constant-time), `exchangeCodeForTokens`, capture `realmId`, `saveConnection` (encrypted), `isAdmin()` defense-in-depth, redirect to `/admin/quickbooks` (`?connected=1` / `?error=…`).
- [x] Config: added `QBO_CLIENT_ID`/`QBO_CLIENT_SECRET`/`QBO_ENV`/`QBO_TOKEN_ENC_KEY` to `.env.example`. ~~deploy.sh secret-wiring~~ **deferred to stage-deploy time** — not needed for local sandbox validation (localhost redirect URI), and `deploy.sh` carries an unrelated pre-existing uncommitted edit; QBO secret-wiring will land in a dedicated commit when the viewer is deployed.
- [x] Tests (`client.test.ts`): authorize-URL params, exchange/refresh request shape (Basic-auth + body + rotation), `fetchCustomers` pagination/Bearer/sandbox-host/401→`QboAuthError`, `verifyState`. (`connection.test.ts`): `computeExpiry` + `accessTokenFresh`. (getValidAccessToken refresh-and-persist with a mocked DB is a Phase 4 unit.)

#### Phase 3: Admin viewer page (read + display) + nav item
- [x] `src/app/(app)/admin/quickbooks/page.tsx` — `await assertCan('admin:access')`; reads `getConnection()`, then for a
      live connection calls `getValidAccessToken()` + `fetchCustomers()`; decodes `?connected=1` / `?error=…` into a notice.
- [x] `src/features/quickbooks/quickbooks-admin.tsx` (server component) renders the connect/disconnect controls (`<form action={serverAction}>`, no client JS) + the customer table (company / email / phone) from the page's server-side fetch. **No DB writes.**
- [x] Added `{ href: '/admin/quickbooks', label: 'QuickBooks' }` to `ADMIN_TABS` in `src/components/app/app-nav.tsx`.
- [x] Friendly error state — a 401/stale fetch surfaces an amber "Couldn't load customers" card with a **Reconnect** button; the callback's `?error=` lands as a red banner.

#### Phase 4: Tests + smoke verification
- [x] Unit (`connection.test.ts`): `getValidAccessToken()` returns the stored token when fresh, and on expiry refreshes + persists the ROTATED refresh token **encrypted** (decrypt round-trip asserted); throws when not connected. `fetchCustomers()` pagination is covered in `client.test.ts` (Phase 2).
- [x] Unit (`callback/route.test.ts`): rejects forged/missing `state` and non-admin (no exchange, no save); on a valid admin callback exchanges the code with the exact `redirect_uri` and calls `saveConnection({ realmId, tokens, connectedById })` → `?connected=1`; token-exchange failure → `?error=`.
- [ ] Smoke (web-test): `goto /admin/quickbooks`; expect heading "QuickBooks" + a `Connect to QuickBooks` button (disconnected state — the auth-injected admin has no live connection). **→ runs in the chunk-end `/eval`.**
- [ ] Smoke (web-test): confirm the nav **Admin → QuickBooks** item is present and routes to `/admin/quickbooks`. **→ runs in the chunk-end `/eval`.**
- [ ] Manual (owner — can't be auto-driven, leaves Intuit's domain): full Connect round-trip against the sandbox company → customer list renders → Disconnect. Prereq: owner adds the sandbox `QBO_CLIENT_ID`/`QBO_CLIENT_SECRET` + a generated `QBO_TOKEN_ENC_KEY` to `.env.local`. **→ owner-pending.**

## Post-close fixes
- **`640110a`** `fix(quickbooks): hide Connect until creds configured` — owner manual smoke hit a raw server-error overlay when clicking **Connect** with no `QBO_CLIENT_ID`/`QBO_CLIENT_SECRET` (`qboConfig()` throws in `buildAuthorizeUrl`). Fix: added non-throwing `qboConfigured()`, and the disconnected panel now hides the Connect button and shows an amber "add creds to `.env.local`" hint until configured (so the throw is unreachable from the UI). Verified in-browser: unconfigured page shows the hint, no Connect button.

## Out of scope (later slices)
- Import/upsert QBO customers → `dealers` from the UI (stays the 0060 script); `external_account_links` table.
- Production keys + env-keyed prod secret wiring (BoldSign-style); nightly keep-alive refresh cron.
- Push direction (accepted Quote → QBO Estimate/Invoice) and any living webhook/CDC sync.
