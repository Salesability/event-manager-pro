# 0068 — QuickBooks in-app OAuth viewer · intent

**Created:** 2026-06-08

> Sibling slice of [`../0060-quickbooks-integration/`](../0060-quickbooks-integration/intent.md). 0060 shipped the
> **one-time seed** (a script using a hand-minted Playground access token — no client secret, no in-app flow;
> 146 customers → 137 dealers on prod 2026-06-05). 0060's plan explicitly listed *"In-app OAuth connection
> (callback route + encrypted token store + refresh)"* as a **later slice — out of scope**. **This chunk is
> that slice**, scoped to a **read-only viewer** against the Intuit **sandbox** (per owner decision 2026-06-08).

## Problem

Reading QuickBooks customers from inside the app today means hand-minting a ~1-hour access token in Intuit's
OAuth Playground and running `scripts/import-from-quickbooks.ts` from a terminal. There is **no in-app way** for
an admin to connect QuickBooks and see the live customer list — and the client ID + secret the business just
loaded into Google Secret Manager (the credentials a real OAuth flow needs, which the Playground-token path did
**not**) are currently unused. We want a first-class, self-service connection.

## Desired outcome

- An **Admin → QuickBooks** menu item opens a page where an admin clicks **Connect to QuickBooks**, completes
  the Intuit OAuth consent in a redirect, and lands back on the page **connected**.
- Once connected, the page **fetches and displays the QBO customer list** (company name + primary email/phone),
  proving the live read works end-to-end against the **sandbox** company.
- The connection **persists** across reloads and **survives access-token expiry** (the ~1h token is refreshed
  on demand; the rotating refresh token is re-stored each time).
- Tokens are **encrypted at rest** — they grant full read access to the books.
- An admin can **Disconnect**, which revokes the token at Intuit and drops the stored connection.

## Non-goals

- **No DB writes from this tool** — it does not import/upsert customers into `dealers`. That stays the 0060
  script. This slice is read-and-display only.
- **No `external_account_links` table** — no dealer↔QBO id linkage is needed for a viewer (that's an import
  concern, deferred with the living-sync slice in 0060/research.md).
- **No production keys / env-keyed prod wiring** — sandbox only this chunk. Productionizing (real keys, prod
  redirect URI, env-keyed secrets like BoldSign) is a follow-up.
- **No nightly keep-alive cron** — refresh-on-demand only. A low-use sandbox connection lapsing after the ~100-day
  idle window just means re-consent; the cron belongs with the living-sync slice.
- **No push direction** (accepted Quote → QBO Estimate/Invoice) — that's the 0060 "later" commercial-spine slice.
- **No Intuit SDK dependency** (`intuit-oauth` / `node-quickbooks`) unless hand-rolling proves painful — the
  existing script already hand-rolls the QBO REST/Bearer calls; this chunk hand-rolls the token exchange/refresh
  the same way. Revisit only if rotation handling gets fiddly.

## Already settled (carried from 0060/research.md — re-confirm against developer.intuit.com when building)

- **Auth is OAuth 2.0 authorization-code grant** — no API-key path for the Accounting API. Scope
  `com.intuit.quickbooks.accounting` (read is enough; no `openid` needed — we don't need Intuit identity).
- **Callback is a route handler** (`src/app/auth/quickbooks/callback/route.ts`) — external caller. Connect-initiation
  and Disconnect are **Server Actions** (admin-gated) per repo conventions.
- **`realmId` is the gotcha** — it identifies which QBO company was connected, is **not** in the token, arrives
  only as a callback query param, and scopes every API call. **Persist it on the connection row.**
- **Single-tenant → one connection** — a singleton row, not a per-user token table.
- **Token exchange** → POST `oauth.platform.intuit.com/oauth2/v1/tokens/bearer` with
  `Authorization: Basic base64(client_id:client_secret)`. Access token ≈1h; refresh token ≈100 days and
  **rotates** on every refresh (always persist whatever comes back).
- **Sandbox API host** is `https://sandbox-quickbooks.api.intuit.com` (vs prod `quickbooks.api.intuit.com`) —
  the existing script already branches on this (`scripts/import-from-quickbooks.ts:95`).

## Success criteria

- [ ] **Admin → QuickBooks** nav item appears for admins; the page is gated `admin:access` (page + middleware).
- [ ] Connect runs the full OAuth round-trip against sandbox; the callback stores realmId + encrypted tokens.
- [ ] After connect, the page lists the sandbox company's customers (live fetch, no DB write).
- [ ] An expired access token is transparently refreshed (rotated refresh token re-stored) — no re-consent within
      the refresh-token window.
- [ ] Tokens are encrypted at rest; the raw values never hit the DB in plaintext or the page HTML.
- [ ] Disconnect revokes at Intuit and removes the row.
- [ ] No schema change ships without going through the `db-conventions` skill.

## Open questions

- **Token encryption key** — new dedicated secret (`QBO_TOKEN_ENC_KEY`, 32-byte AES-256-GCM) vs. deriving from an
  existing app secret. (Plan resolves — lean new dedicated secret; no encryption helper exists in the repo yet.)
- **CSRF `state` storage** — signed/HMAC cookie set at connect-initiation vs. a short-lived DB row. (Plan resolves
  — lean cookie; no row needed.)
- ~~**Local-dev redirect URI**~~ — **RESOLVED 2026-06-08** (owner screenshot of the Intuit app's Redirect URIs tab):
  the **Development** environment (= sandbox keys) accepts **HTTP or HTTPS**, so `http://localhost:3000/auth/quickbooks/callback`
  is registered and valid (matches `next dev`'s default `:3000`; the path matches the planned
  `src/app/auth/quickbooks/callback/route.ts`). Caveat from the same screen: the URI **can't be a raw IP** —
  use `localhost`, not `127.0.0.1`. Optional second Development URI for testing on deployed stage:
  `https://event-manager-pro-sandbox-485010152235.us-east4.run.app/auth/quickbooks/callback`. (The **Production**
  tab is HTTPS-only — out of scope this chunk.)

## Why now

The owner has loaded the sandbox client ID + secret into Secret Manager and wants to move QuickBooks off the
manual Playground-token workflow toward a real in-app connection. A read-only viewer is the smallest slice that
exercises the whole OAuth + token-refresh + live-read spine, de-risking the eventual import/sync slices without
touching production data.
