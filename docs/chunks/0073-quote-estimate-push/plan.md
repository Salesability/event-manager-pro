# Quote → QBO Estimate Push (Slice 3) — Plan

**Intent:** [`intent.md`](intent.md)
**Started:** 2026-06-09

## Progress Tracker

| Phase | Status | Commit |
|-------|--------|--------|
| 1: Schema — `quotes.quickbooks_estimate_id` + unique partial index + migration | Done | `0f4a1df` |
| 2: `client.ts` Estimate helpers (`createEstimate` / `updateEstimate` / `fetchEstimateById`) | Pending | - |
| 3: `quote-push.ts` — pre-flight link check + `mapQuoteToEstimate` + `pushQuoteToQuickbooks` core | Pending | - |
| 4: Server Action + gate-matrix row + quote-page button + flash | Pending | - |
| 5: Tests + smoke verification + wiki ingest | Pending | - |

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

**Overall Progress:** 20% (1/5 phases complete)

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
- [ ] `QboEstimate` type (Id, SyncToken?, CustomerRef, Line[], TxnTaxDetail?, TotalAmt?, …) + `QboEstimateInput` write type.
- [ ] `fetchEstimateById` (GET `/v3/company/{realm}/estimate/{id}`), `createEstimate` (POST `/estimate`), `updateEstimate` (sparse POST with `Id`+`SyncToken`) — reuse the `readCustomerResponse`-style 401/error handling (generalize it or add a sibling).
- [ ] Unit test request shaping (URL `/estimate`, Bearer, sparse flag, SyncToken) with `fetch` mocked — mirror the customer-helper tests.

#### Phase 3: `quote-push.ts` — pre-flight + map + push core
- [ ] `checkQuotePushReadiness(quote, lines, dealer)` → `{ ok: true } | { ok: false, reason }`: dealer must have `quickbooks_id`; every line's `service_items.quickbooks_id` must be set (load the SKUs' link state). Clear messages: "dealer not linked — Sync dealers first" / "items not linked: <codes> — Pull items first". (Resolve the `quotes.fee`/`quotes.travel` vs line-items question here.)
- [ ] `mapQuoteToEstimate(quote, lines, dealer)` → `QboEstimateInput`: `CustomerRef.value = dealer.quickbooks_id`; one `Line` per row (`DetailType: SalesItemLineDetail`, `ItemRef.value = sku.quickbooks_id`, `Qty`, `UnitPrice = effectiveUnit`, `Amount`); tax via `TxnTaxDetail.TotalTax` (quote computed tax) + `GlobalTaxCalculation: TaxExcluded`.
- [ ] `pushQuoteToQuickbooks(quote, lines, dealer, realmId, accessToken, exec=db)` core: pre-flight → on fail throw a typed `QuotePushNotReadyError`; linked (`quickbooks_estimate_id`) → `fetchEstimateById` for SyncToken → `updateEstimate`; unlinked → `createEstimate` → guarded backfill `UPDATE quotes SET quickbooks_estimate_id=? WHERE id=? AND quickbooks_estimate_id IS NULL`. Executor-injection.
- [ ] Unit test `checkQuotePushReadiness` (linked/unlinked dealer, linked/unlinked SKUs) + `mapQuoteToEstimate` (CustomerRef, line ItemRefs/qty/price, tax override) — pure, no network/DB.

#### Phase 4: Server Action + gate-matrix + quote-page button + flash
- [ ] `pushQuoteToQuickbooks(formData)` Server Action in `src/features/quickbooks/actions.ts`: `assertCan('admin:access')` → Zod `quoteId` → load quote + lines + dealer → `getValidAccessToken()` → push core → `revalidatePath('/quotes/<id>')` → `redirect('/quotes/<id>?qbpush=created|updated')`. A `QuotePushNotReadyError` → redirect `?qberror=<message>` (friendly, since the pre-flight is a user-actionable state, unlike the propagate-rationale for connection errors). Register in `action-gate-matrix.ts` (ADMIN_ONLY).
- [ ] Quote page (`src/app/(app)/quotes/[id]/page.tsx`): load the QBO connection + the quote's `quickbooks_estimate_id`; render a "Push to QuickBooks" `<form action>` button (admin-only, only when connected) + the link-state ("Estimate #N" / not pushed); decode `?qbpush=`/`?qberror=` into a notice. Mirror the dealer-page button.
- [ ] No-JS server component + `<form action>`.

#### Phase 5: Tests + smoke verification + wiki ingest
- [ ] Integration test (`tests/integration/quote-push.test.ts`, rolled-back txns, QBO Estimate calls mocked): **create path** — fully-linked quote → `createEstimate` returns `Id` → assert `quickbooks_estimate_id` backfilled; **update path** — linked quote → `fetchEstimateById` + `updateEstimate` with the read SyncToken; **pre-flight fail** — unlinked dealer / unlinked SKU → `QuotePushNotReadyError`, no write, no `createEstimate` call.
- [ ] Unit (Phase 2/3) cover map + readiness + request shaping.
- [ ] Smoke (web-test, gated): seed/choose a sandbox quote whose dealer + SKUs are QBO-linked (sandbox items are linked post-pull); `goto /quotes/<id>` → expect the "Push to QuickBooks" button + link-state. **Do not click** (writes a real Estimate to the sandbox QBO company). Fixture script if needed (`scripts/0073-quote-push-smoke.ts`).
- [ ] Ingest `quotes.quickbooks_estimate_id` + the Estimate-push path into `docs/wiki/data-model.md` + `docs/wiki/log.md`; note the dealer+items link prerequisite.
