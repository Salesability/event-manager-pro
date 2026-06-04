# 0060 — QuickBooks dealer import · plan

Derived from [`intent.md`](intent.md). Un-deferred 2026-06-03. Started: 2026-06-03.

**Scope of this plan:** the **one-time seed** slice only — pull QBO Customers into prod `dealers`
(+ staff contacts) via a script, using a manually-minted Playground access token. **No in-app OAuth
connection, no schema change, no living sync** — those stay as later phases (see *Out of scope* below).

## Decisions locked

- **One-time import** (Open Decision #1). Run the script once against prod; re-runnable if needed.
- **No `external_account_links` table for this slice.** Dealer idempotency comes from **name+address
  dedup** (same boundary as `scripts/import-from-sheets.ts`); contact idempotency from the existing
  `contact_identifiers (kind,value) WHERE archived_at IS NULL` partial unique. This keeps the prod touch
  **data-only** (no DDL through the prod connection). The external-link table is the right call when the
  *living sync* slice lands — deferred with it.
- **QBO Customer's person → `dealer_contacts(role='staff')`**, not `customer` (per `intent.md` vocabulary
  bridge — `customer` is the dealership's own car-buyers). `title` left null (QBO has no title field).
- **Token, not in-app OAuth.** A one-time run doesn't justify building the callback route + encrypted
  connection store. Mint a ~1h access token from Intuit's OAuth 2.0 Playground (production keys). The
  in-app OAuth connection is the first thing the *living sync* slice builds.
- **Auth/source-of-record on re-run:** import only *fills* — existing dealers matched by name+address are
  reused untouched (never clobbered). Matches "app is truth" for already-present rows.

## Mapping (implemented in `scripts/import-from-quickbooks.ts`)

| QBO `Customer` | App |
|---|---|
| `CompanyName` ?? `DisplayName` | `dealers.name` |
| `BillAddr` ?? `ShipAddr` (flattened to one line) | `dealers.address` |
| — | `dealers.status = 'active'`, `dealers.acquired_via = 'QuickBooks import'` |
| `GivenName` / `FamilyName` | `contacts.first_name` / `last_name` (only when a name exists) |
| `PrimaryEmailAddr.Address` (lowercased) | `contact_identifiers(email, is_primary)` |
| `PrimaryPhone` ?? `Mobile` (trimmed) | `contact_identifiers(phone, is_primary)` |
| person ↔ dealer | `dealer_contacts(role='staff', source='quickbooks-import')` |
| `Job` / `ParentRef` (sub-customer) | **skipped** for v1 (reported in output) |
| company with no person name | dealer created; **no** staff contact (company email/phone dropped, reported) |

Normalization matches the app's create path: email `.trim().toLowerCase()`, phone `.trim()` (the app does
**not** E.164-normalize — `src/features/people/actions.ts`), so dedup hits the same active-unique index.

## Phases

### Phase 1 — Intuit-side setup (owner) · `runbook.md`
- [ ] Create app at developer.intuit.com, scope `com.intuit.quickbooks.accounting`.
- [ ] Get **production** keys (needs EULA + Privacy Policy URLs — salesability.ca pages).
- [ ] Add the OAuth Playground redirect URI to the app's production Redirect URIs.
- [ ] OAuth Playground → **Production** → Accounting scope → authorize → pick the production company →
      copy **access_token** + **realmId**.
- **Status:** Not started — blocked on owner (Intuit login + consent are the owner's to do).

### Phase 2 — Dry run
- [x] Script written + lint-clean + module-loads smoke (`scripts/import-from-quickbooks.ts`).
- [x] **Sandbox dry-run GREEN (2026-06-03)** against EventPro (Sandbox) sample company: 29 fetched → 3
      jobs skipped → **26 dealers mapped**, 0 dropped channels. Validated address-flatten, job-skip,
      person-only customers, and the live QBO query/pagination path end-to-end.
- [ ] Production dry-run: `DATABASE_URL`=prod **session pooler (5432)**, `QBO_ENV=production`, no
      `IMPORT_WRITE` → review the printed plan against the real customer list.
- **Status:** Sandbox validated; production dry-run waits on a production token (Phase 1).

### Phase 3 — Live import + verify
- [ ] Re-run with `IMPORT_WRITE=1`; capture the inserted/reused/linked counts.
- [ ] Verify in-app (`/dealerships` shows the imported dealers; spot-check a few staff contacts).
- [ ] Note the run + counts in `CURRENT.md` History.
- **Status:** Not started.

## Out of scope (later slices — keep in `intent.md`/`research.md`)
- In-app OAuth connection (callback route + encrypted token store + refresh/keep-alive cron).
- `external_account_links` table (dealer↔QBO id) — needed for a *living* sync, not a one-time seed.
- Living sync (webhooks / CDC) and the push direction (accepted Quote → QBO Estimate/Invoice).

## Progress tracker
- Phase 1 — owner setup: **blocked on owner**
- Phase 2 — dry run: **script ready; awaiting token**
- Phase 3 — live import: **pending**
