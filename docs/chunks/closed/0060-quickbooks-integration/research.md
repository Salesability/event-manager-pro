# 0060 — QuickBooks Online integration · research

Technical findings from the 2026-05-29 conversation. Source: knowledge of the Intuit Developer platform
(QuickBooks Online API), cross-referenced against this repo's data model. Not yet verified against live
Intuit docs — **re-confirm endpoints + token lifetimes against developer.intuit.com when the plan is written.**

## Which QuickBooks APIs

QuickBooks Online (the web version) is served by the **Intuit Developer platform**:

- **QuickBooks Online Accounting API** — REST/JSON. Read/write `Customer`, `Invoice`, `Estimate`, `Item`,
  `Payment`, `Bill`, etc. This is the one we need (import reads `Customer`; later push writes `Estimate`/`Invoice`).
- **QuickBooks Payments API** — separate scope, for charging cards. Out of scope here.
- **QuickBooks Desktop SDK / Web Connector** — legacy desktop only. N/A (we're on QBO web).

## Auth — OAuth 2.0 + OpenID Connect

No API-key path for the accounting API; it's the full OAuth 2.0 **authorization-code grant**.

### One-time setup
Register the app at **developer.intuit.com** → `client_id` + `client_secret` + registered redirect URI(s).
Two key pairs: **Development (sandbox)** and **Production**.

### Flow
1. **Authorize redirect** → `https://appcenter.intuit.com/connect/oauth2`
   `?client_id=…&response_type=code&scope=com.intuit.quickbooks.accounting&redirect_uri=…&state=<csrf>`
   (add `openid profile email` for OIDC identity; `com.intuit.quickbooks.payment` is a separate scope).
2. **User consents** — logs into Intuit, **picks which company file** to connect, grants access.
3. **Redirect back** → `?code=…&state=…&realmId=<COMPANY_ID>`
   ⚠️ **`realmId` is the gotcha**: it identifies *which QBO company* was connected, is **not** in the token,
   arrives only as this query param, and scopes every later API call. **Persist it.**
4. **Token exchange** → POST `https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer`
   `grant_type=authorization_code, code, redirect_uri` + `Authorization: Basic base64(client_id:client_secret)`.
   Returns `access_token` (≈1h / 3600s), `refresh_token` (≈100 days, **rotates** on refresh), `x_refresh_token_expires_in`.
5. **API calls** → `Authorization: Bearer <access_token>`
   - Prod: `https://quickbooks.api.intuit.com/v3/company/{realmId}/…`
   - Sandbox: `https://sandbox-quickbooks.api.intuit.com/v3/company/{realmId}/…`
6. **Refresh** — access token dies hourly; refresh before a call / on 401. **Refresh token rotates** (persist
   whatever comes back) and expires after **~100 days idle** → idle connection forces a manual reconnect.

### What this means for our (single-tenant) stack
- **One connection**, not a per-user token table — the app serves one business → one QBO company.
- **Callback = route handler** `src/app/auth/quickbooks/callback/route.ts` — external caller. Validates `state`,
  exchanges the code, writes the connection.
- **Connect-initiation + import = Server Actions** (admin-gated) — our own UI per repo conventions.
- **Connection storage** — effectively a singleton row: `realm_id`, `access_token`, `refresh_token`,
  `access_token_expires_at`, `refresh_token_expires_at`. **Encrypt tokens at rest** (full write access to the books).
- **Keep-alive** — a nightly cron refresh keeps the ~100-day refresh token from lapsing on a low-use connection.
- **SDKs** — Intuit's **`intuit-oauth`** (URL build + token exchange + refresh-with-rotation) + **`node-quickbooks`**
  (Customer queries). Avoids hand-rolling the bearer-refresh logic.

## Data mapping — QBO Customer → app

| QBO `Customer` field | App destination |
|---|---|
| `CompanyName` (fallback `DisplayName`) | `dealers.name` |
| `BillAddr` (flattened to one string) | `dealers.address` |
| — | `dealers.status` = `'active'` (existing paying customers) |
| — | `dealers.acquired_via` = `"QuickBooks import"` |
| `Id` + `realmId` | **external link** (see schema gap) |
| `GivenName` / `FamilyName` | `contacts.first_name` / `last_name` → one `contacts` row |
| `PrimaryEmailAddr.Address` | `contact_identifiers(kind='email', is_primary)` |
| `PrimaryPhone.FreeFormNumber` | `contact_identifiers(kind='phone')` |
| — | `dealer_contacts(role='staff', title=…)` linking the contact to the dealer |
| `Job` / sub-customer | skip for v1 (no flat-model mapping) |

## Schema gap — the external-ID link

`dealers` today has only `id`, `public_id`, `name`, `address`, `status`, `acquired_via` (+ mixins) — **no
external-id column**, so a re-import can't tell update-existing from create-new. Two options:

- **Simple (v1):** nullable `quickbooks_customer_id text` on `dealers` + store `realm_id` once on the connection
  row. Fast, but bakes in single-provider.
- **Clean (recommended):** `external_account_links` table — `(provider, realm_id, external_id, dealer_id)`,
  UNIQUE on `(provider, realm_id, external_id)`. QBO entity IDs are **only unique within a realm**, so realm
  must be part of the key. Generalizes to Stripe / e-sig provider links later; matches the repo's normalized-table
  preference. **Run through the `db-conventions` skill.**

## Idempotency / dedup (mostly free)

- `contact_identifiers` already has a **partial unique on `(kind, value) WHERE archived_at IS NULL`** — the
  documented match-or-create dedup boundary ([`../../../wiki/data-model.md`](../../../wiki/data-model.md) §contact_identifiers).
  Two QBO customers sharing a contact email won't double-create the person.
- The external-link table gives dealer-level idempotency.
- Net: import is safe to run repeatedly — exactly what an ongoing sync needs.

## Mechanics

- **Backfill (first slice)** — model on the existing **`scripts/import-from-sheets.ts`** (already a bulk
  match-or-create importer); the QBO version is the same shape with a different source adapter. Read scope only
  (`com.intuit.quickbooks.accounting`).
- **Pagination + rate limits** — QBO query API pages at **max 1000 rows** (`STARTPOSITION` / `MAXRESULTS`) and
  throttles (~500 req/min, ~40 concurrent). For a non-trivial customer list, run as a **background job**, not a
  blocking Server Action.
- **Ongoing sync (later, gated by Open Decision #1)** — QBO **webhooks** (Customer create/update → route handler
  → upsert) and/or **CDC** (`Customer WHERE Metadata.LastUpdatedTime > lastSync`).
- **Push direction (later slice)** — app→QBO write: accepted Quote → `Estimate`/`Invoice`, `dealer` → `Customer`,
  billing adjustments (0059) → invoice line adjustments. Same OAuth connection, opposite data flow.

## References (verify when planning)

- Intuit Developer portal — app registration, sandbox company, OAuth playground.
- OIDC discovery: `https://developer.api.intuit.com/.well-known/openid_configuration` (prod) /
  `…/openid_sandbox_configuration` (sandbox).
- Token revoke: `https://developer.api.intuit.com/v2/oauth2/tokens/revoke`.
- npm: `intuit-oauth`, `node-quickbooks`.
- Repo precedent: `scripts/import-from-sheets.ts`; data model [`../../../wiki/data-model.md`](../../../wiki/data-model.md);
  commercial spine [`../../../wiki/commercial-spine.md`](../../../wiki/commercial-spine.md).
