# Decouple campaign delivery metrics from booking — Plan

**Intent:** [`intent.md`](intent.md) · **Decisions:** [`decision.md`](decision.md)
**Started:** 2026-07-06 (un-parked; 0093 shipped + closed)

> **Un-parked 2026-07-06.** Follow-up to [`0093-calendar-quote-msa-status`](../closed/0093-calendar-quote-msa-status/plan.md). Phase 1 decisions locked with the owner — see [`decision.md`](decision.md). Phases 2–5 below re-derived from those decisions.

## Progress Tracker

| Phase | Status | Commit |
|-------|--------|--------|
| 1: Decision — SKU→field mapping + snapshot-at-accept + backfill-all | Done | `7ed18ea` |
| 2: Quote → campaign delivery-number derivation (at quote accept) | Done | `9201b0c` |
| 3: Remove metric fields from the Book Event dialog | Done | `906f990` |
| 4: Override-surface decision — Reports-only, no new code (D6) | Done | _docs_ |
| 5: Tests + backfill + smoke verification | Done | `b2e2625` · `0b1c58d` |

The Book Event dialog captures `qtyRecords / smsEmail / letters / bdc` — operational **delivery** numbers consumed by Production + Reports — at the *scheduling* step, before the quote that actually owns that scope exists, so they sit blank and double-entered with no sync. This chunk moves their ownership to the **accepted quote**: booking schedules, the quote scopes (derive the delivery numbers from its line items), production overrides where real delivery differs (the existing `billing_adjustments` role). "Done" = booking has no commercial/scope fields, and a campaign's delivery numbers reflect its accepted quote.

## Code Anchors

| New code | Anchor (`path:line`) | Why this anchor |
|----------|---------------------|-----------------|
| Quote→campaign derivation (on accept) | `src/features/quotes/lifecycle.ts` (`markQuoteAccepted`) + `src/features/schedule/queries.ts:711-` (the `billing_adjustments` overlay that already maps `qty_records`/`sms_email`/… ) | Hook the derivation where accept already runs; reuse the field-mapping the billing overlay defines |
| SKU→metric mapping | `src/lib/quotes/pricing.ts` (catalogue SKUs: `base-event`, `bdc-call`, …) + `quote_line_items` rows | The line-item store is the scope source to map from |
| Strip metric fields from booking | `src/app/(app)/calendar/booking-form.tsx` (the Qty/SMS/Letters/BDC `<Field>` grid) | Remove the grid + the FormData entries; keep date/dealer/contact/coach/notes |
| Override surface | `src/app/(app)/production/` (production-admin) + `billing_adjustments` (0059) | Production already overrides these for reporting — extend it as the delivery-vs-quote override home |

**Conventions referenced:**
- `docs/wiki/commercial-spine.md` — "quote = commercial source of truth, campaign = operational delivery" + the 0093 calendar-status section.
- `docs/wiki/data-model.md` — `campaigns` metric columns, `quote_line_items`, `billing_adjustments`.

**Overall Progress:** 100% (5/5 phases complete)

### Phase Checklist

#### Phase 1: Decision (resolve `intent.md` Open questions) — Done
- [x] SKU→field mapping — **D1**: `bdc`←Σ`bdc-call`, `letters`←Σ`letter-postage`, `smsEmail`←Σ`digital-record`, `qtyRecords`←`500×Σbase-event.qty`+Σ`additional-contact`; `additional-day`/`record-retrieval`/`travel` map to nothing.
- [x] Derive at accept vs lazy — **D2**: snapshot written onto the `campaigns` columns at accept (consumers keep reading raw columns); accept also sets `campaigns.acceptedQuoteId`.
- [x] Existing-campaign stance — **D3**: backfill-all (every campaign with an accepted quote gets all 4 metrics overwritten + `acceptedQuoteId` populated).
- [x] Event Format / Data Source — **D4**: keep both on booking (no SKU derives them; Format feeds the gcal invite).
- [x] Escape hatch — **D5**: fully defer; no volume fields on booking. (See [`decision.md`](decision.md).)

#### Phase 2: Quote → campaign derivation
- [x] New pure module `src/lib/quotes/delivery-metrics.ts` — `deriveDeliveryMetrics(lines: {code, qty}[]) → {qtyRecords, smsEmail, letters, bdc}` per D1 (Σ over lines; unconditional all-four)
- [x] Impure accept-time writer `src/features/quotes/campaign-delivery.ts` (`applyAcceptedQuoteToCampaign`): loads the accepted quote's `quote_line_items`, derives, `UPDATE campaigns` (4 columns + `acceptedQuoteId`) for `quotes.campaignId`. Wired into `acceptQuote` **outside** the `transitioned` guard → idempotent + self-healing (re-drivable by re-accept or the Phase-5 backfill).
- [x] Unit tests for the mapping (`delivery-metrics.test.ts`: dup-code sum, base-500, base×qty, no-line ⇒ 0, non-mapping/unknown SKUs ignored, NaN-qty coercion)

#### Phase 3: Strip metric fields from booking
- [x] Removed the Qty/SMS/Letters/BDC `<Field>` grid from `booking-form.tsx` — **kept** Event Format + Data Source
- [x] Dropped `qtyRecords/smsEmail/letters/bdc` from `booking-schema.ts` (+ dead `optNonNegVolume`/`MAX_PG_INT`) and the `CampaignInput` type + `parseCampaignInput` in `validators.ts`; the `createCampaign`/`updateCampaign` `...input` spread now omits them (insert ⇒ NULL, update ⇒ untouched → the derived numbers survive an edit). Updated `validators.test.ts`.
- [x] Confirmed Production / Reports / event-detail / emails still read the raw `campaigns` columns (unchanged; tsc green) — now quote-sourced / blank-until-accept

#### Phase 4: Override-surface decision — Reports-only (D6), no new code
- [x] Owner picked **Option 1**: override stays a billing/invoice concern on `/reports`; Production keeps showing the raw (quote-derived) numbers. No new override surface built.
- [x] Confirmed the existing `billing_adjustments` + `BillingCell` overlay composes with quote-derived defaults with zero change (`reports-columns.tsx:129-131`: `override ?? campaign[field]`, and `campaign[field]` is now quote-sourced).
- [x] `bdc`-not-aggregated gap in the by-dealer/coach/month rollups (`queries.ts`) is pre-existing (0059-era) + out of scope → parked as **0094-a** (not fixed in-chunk).

#### Phase 5: Tests + backfill + smoke verification
- [x] Backfill script `scripts/backfill-campaign-delivery-metrics.ts` (dry-run default + `--write`, one tx, idempotent, reuses the pure mapping; most-recently-accepted quote wins per campaign) — D3. **Read-only prod count still owed before the prod `--write`** (sandbox DB paused; run via `with-prod-db.sh`).
- [x] Integration `tests/integration/campaign-delivery.test.ts`: calls the real `applyAcceptedQuoteToCampaign` with a tx (injectable `Executor`) inside a rolled-back tx — derives + overwrites the campaign + sets `acceptedQuoteId`; zero-line ⇒ 0; no-campaign ⇒ no-op. _(Runs when the sandbox DB is up; currently skipped-by-outage like the other integration files.)_
- [~] Smoke (web-test): booking dialog no longer shows the metric fields; event-detail/production reflect the derived numbers — **deferred to the chunk-end `/eval` browser smoke** (two-tier gate).
- [x] Wiki ingest: `commercial-spine.md` (new "Delivery metrics" subsection + accept bullet), `data-model.md` (`campaigns` walkthrough + `accepted_quote_id` writer), `log.md` entry.
