# Quote → QBO Estimate Push (Slice 3) — Plan

**Intent:** [`intent.md`](intent.md)
**Started:** 2026-06-09

## Progress Tracker

| Phase | Status | Commit |
|-------|--------|--------|
| 1: Schema — `quotes.quickbooks_estimate_id` + unique partial index + migration | Done | `0f4a1df` |
| 2: `client.ts` Estimate helpers (`createEstimate` / `updateEstimate` / `fetchEstimateById`) | Done | `788ea03` |
| 3: `quote-push.ts` — pre-flight link check + `mapQuoteToEstimate` + `pushQuoteToQuickbooks` core | Done | `d2cc9c7` |
| 4: Server Action + gate-matrix row + quote-page button + flash | Done | `9a589fb` |
| 5: Tests + smoke verification + wiki ingest | Done | `25090fd` |

**Slice 3 (final build slice) of the bidirectional QuickBooks effort.** Push a quote → QBO **Estimate** on demand, reusing 0070's `CustomerRef` (`dealers.quickbooks_id`) + 0071's `ItemRef` (`service_items.quickbooks_id`). Mirrors the 0070 dealer-push shape (read-before-write SyncToken on update, guarded create-then-backfill) but for the quote→Estimate mapping, gated behind a pre-flight check that **every** line SKU + the dealer are QBO-linked. "Done" = the column ships to sandbox; a fully-linked quote creates/updates a matching Estimate; the pre-flight fails closed otherwise; chunk-end `/eval` PASS. Sandbox-first (prod push gated on a prod catalog pull).

## Code Anchors

For each new file or method below, the builder reads the anchor first and matches its shape (length, error handling, naming, query style). For modifications to an existing file, the anchor is the nearest sibling method in that same file.

| New code | Anchor (`path:line`) | Why this anchor |
|----------|---------------------|-----------------|
| `quickbooks_estimate_id` col + unique partial index in `src/lib/db/schema/quotes.ts` | `src/lib/db/schema/dealers.ts:38-52` (`quickbooks_id` + `uniqueIndex … WHERE … IS NOT NULL`); `service-items.ts` (the 0071 repeat) | the proven 0069/0071 partial-unique-index idiom |
| New migration `drizzle/0034_*.sql` | `drizzle/0033_*.sql` (0071 `service_items.quickbooks_id`) | same generate → **verify journal `when`** ([[project_drizzle_journal_when_gotcha]]) → apply-to-sandbox flow |
| `QboEstimate` + `createEstimate` / `updateEstimate` / `fetchEstimateById` in `src/lib/quickbooks/client.ts` | `src/lib/quickbooks/client.ts` `createCustomer`/`updateCustomer`/`fetchCustomerById` + `readCustomerResponse` (0070) | identical create/sparse-update/read-by-id shape, `/estimate` instead of `/customer`; reuse the 401/error handling |
| `src/lib/quickbooks/quote-push.ts` → `checkQuotePushReadiness` / `mapQuoteToEstimate` / `pushQuoteToQuickbooks` | `src/lib/quickbooks/dealer-push.ts` (whole module — map + push core + read-before-write SyncToken + guarded backfill + executor-injection) | the app→QBO push pattern this mirrors |
| `mapQuoteToEstimate` line mapping | `src/lib/quotes/pricing.ts:92` (`effectiveUnit`) + `quote_line_items` (snapshot `code`/`label`/`unitPrice`/`overrideUnitPrice`/`qty`) | the canonical per-line price the PDF/totals already use |
| `pushQuoteToQuickbooks` Server Action in `src/features/quickbooks/actions.ts` | `src/features/quickbooks/actions.ts` `pushDealerToQuickbooks` (0070) | sibling admin-gated push action: Zod `quoteId` → `assertCan` → load → `getValidAccessToken` → core → `revalidatePath`+`redirect(?qbpush)` |
| Gate-matrix row | `src/features/__tests__/action-gate-matrix.ts` `pushDealerToQuickbooks` row (ADMIN_ONLY) | same admin-only matrix entry |
| "Push to QuickBooks" button + link-state + flash on the quote page | `src/app/(app)/dealerships/[id]/page.tsx` (0070 dealer-page button + `?qbpush=` flash) applied to `src/app/(app)/quotes/[id]/page.tsx` (loads `loadQuote`@queries.ts:203, renders `QuoteComposer`) | reuse the no-JS `<form action>` button + connection-gated render + flash decode |

**Conventions referenced:**
- `docs/wiki/data-model.md` — `quotes` shape, `quote_line_items` snapshot discipline, the QBO `quickbooks_id` links (0069–0071).
- `CLAUDE.md` → Conventions — mutations are Server Actions; invoke `db-conventions` before schema/migrations.
- Memory [[project_drizzle_journal_when_gotcha]] · [[project_prod_db]] (sandbox-first 5432) · [[feedback_no_yup]] (Zod) · [[project_msa_structure]] (accepted Quote IS the contract).

**Overall Progress:** 100% (5/5 phases complete)

**Note:**
- Each phase includes its own tests; the `applyItemSync`-style DB integration test (the backfill write) comes in Phase 5 against a real DB in rolled-back transactions, with the QBO Estimate calls mocked.

### Phase Checklist

#### Phase 1: Schema — `quotes.quickbooks_estimate_id` + unique partial index + migration
- [x] ~~Invoke `db-conventions`~~ — already loaded this session for 0071's identical schema work; same partial-unique-index idiom + journal-`when` gotcha + sandbox-first-on-5432 rules applied.
- [x] Added `quickbooksEstimateId: text('quickbooks_estimate_id')` (nullable) to `quotes` with a comment (QBO `Estimate.Id` link; set only by the push; idempotency).
- [x] Added unique partial index `quotes_quickbooks_estimate_id_idx` on `(quickbooks_estimate_id) WHERE quickbooks_estimate_id IS NOT NULL`.
- [x] `pnpm db:generate` → `drizzle/0034_pale_blue_shield.sql` (clean `ADD COLUMN` + `CREATE UNIQUE INDEX … WHERE`, no stray auth statements). **Journal `when` verified ascending** (0034 `1781095215115` > 0033 `1781027979333`).
- [x] Applied to **sandbox** (5432 pooler `aws-1-us-west-2`); verified col (`text`, nullable) + partial index via `pg_indexes`. (Prod deferred.)

#### Phase 2: `client.ts` Estimate helpers
- [x] `QboEstimate` + `QboEstimateLine` (read) + `QboEstimateInput` (write) types.
- [x] `fetchEstimateById` / `createEstimate` / `updateEstimate` (sparse POST with `Id`+`SyncToken`) + a `readEstimateResponse` sibling (401→QboAuthError, !ok→throw, returns `json.Estimate`; no 6240 — estimates have no name-uniqueness).
- [x] Unit test request shaping (URL `/estimate`, Bearer, no-Id-on-create, sparse+Id+SyncToken on update, 401) — 4 cases in `client.test.ts`.

#### Phase 3: `quote-push.ts` — pre-flight + map + push core
- [x] `checkQuotePushReadiness(dealer, lines)` (pure) → `{ ok }`/`{ ok:false, reason }`: dealer `quickbooksId` required; every line `itemQuickbooksId` required (else names the unlinked `code`s); empty-quote guard. Messages reference "Sync dealers" / "Pull items". Lines carry a resolved `itemQuickbooksId` (the Server Action resolves it from `service_items`), keeping the pure fns DB-free.
- [x] `mapQuoteToEstimate(quote, lines, dealer)` → `QboEstimateInput`: `CustomerRef.value = dealer.quickbooksId`; one `SalesItemLineDetail` `Line` per row (`ItemRef.value = itemQuickbooksId`, `Qty`, `UnitPrice = effectiveUnit`, `Amount = lineTotal`); tax via `TxnTaxDetail.TotalTax` (quote computed tax) + `GlobalTaxCalculation: TaxExcluded` (omitted when tax = 0). **Note: `quotes.fee`/`travel` are already represented as `quote_line_items` rows by the 0062 composer, so no separate top-level Estimate lines needed** (line mapping covers them).
- [x] `pushQuoteToQuickbooks(quote, lines, dealer, realmId, accessToken, exec=db)` core: pre-flight → throw `QuotePushNotReadyError` on fail; linked → `fetchEstimateById` (fresh SyncToken) → `updateEstimate`; unlinked → `createEstimate` → guarded backfill `UPDATE quotes SET quickbooks_estimate_id WHERE id=? AND … IS NULL`. Executor-injection (default `db`, like dealer-push — single guarded update, no blanket destructive op).
- [x] Unit test `checkQuotePushReadiness` (linked/unlinked dealer, unlinked-SKU-naming, empty) + `mapQuoteToEstimate` (CustomerRef, ItemRef/qty/override-unit/amount, tax override + omit-on-zero) — 6 cases, pure. (`quote-push.test.ts`)

#### Phase 4: Server Action + gate-matrix + quote-page button + flash
- [x] `pushQuoteToQuickbooks(formData)` Server Action: `assertCan('admin:access')` → Zod `quoteId` → `loadQuoteEstimatePushData` (new assembly loader in `quotes/queries.ts`: quote + dealer link + lines with each SKU's `service_items.quickbooks_id` left-joined) → **status gate** (only `accepted`/`sent` → else `?qberror`) → `getValidAccessToken` → core (imported aliased `pushQuoteToEstimate`) → `revalidatePath` + `redirect(?qbpush=created|updated)`. `QuotePushNotReadyError` → `?qberror=<msg>` (user-actionable); connection/transport errors propagate. Registered in `action-gate-matrix.ts` (ADMIN_ONLY, passes 7 roles).
- [x] Quote page (`quotes/[id]/page.tsx`): added `quickbooksEstimateId` to `loadQuote` (additive — Quote type/projection/mapRow), loaded `getConnection()`, gated a **"Push to QuickBooks"** `<form action>` button on **QBO-connected + `can(profile,'admin:access')`** (the page admits coaches, so a fresh admin check), with link-state ("Estimate #N" / not pushed) + `?qbpush`/`?qberror` flash. Drive-by: added `quickbooksEstimateId: null` to the `status-display.test.ts` Quote fixture (new required field).
- [x] No-JS server component + `<form action>`.

#### Phase 5: Tests + smoke verification + wiki ingest
- [x] Integration test (`tests/integration/quote-push.test.ts`, rolled-back txns, QBO Estimate calls mocked): **create path** (seed dealer+quote → `createEstimate` → assert `quickbooks_estimate_id` backfilled + payload `CustomerRef`/`ItemRef`); **update path** (linked quote → `fetchEstimateById` + `updateEstimate` with the read SyncToken, no `createEstimate`); **pre-flight fail** (unlinked dealer / unlinked SKU → `QuotePushNotReadyError`, no `createEstimate`, row untouched). 3 cases, green against sandbox.
- [x] Unit (Phase 2/3): client request shaping + readiness/map covered.
- [x] Smoke (web-test, gated) → **PASS** (chunk-end `/eval`, `eval-2026-06-10-0911.md`): `/quotes/3` (accepted) renders the QuickBooks section + "Push to QuickBooks" button (admin-gated) + "Not in QuickBooks yet" link-state. Did not click (writes a real Estimate). Screenshot `/tmp/web-test-0073-quote-push.png`.
- [x] Ingested `quotes.quickbooks_estimate_id` + the Estimate-push path into `docs/wiki/data-model.md` (`quotes` row) + `docs/wiki/log.md` (2026-06-10), noting the dealer+items link prerequisite + the remaining tax-alignment slice.
