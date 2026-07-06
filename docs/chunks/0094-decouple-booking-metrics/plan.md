# Decouple campaign delivery metrics from booking — Plan

**Intent:** [`intent.md`](intent.md) · **Decisions:** [`decision.md`](decision.md)
**Started:** 2026-07-06 (un-parked; 0093 shipped + closed)

> **Un-parked 2026-07-06.** Follow-up to [`0093-calendar-quote-msa-status`](../closed/0093-calendar-quote-msa-status/plan.md). Phase 1 decisions locked with the owner — see [`decision.md`](decision.md). Phases 2–5 below re-derived from those decisions.

## Progress Tracker

| Phase | Status | Commit |
|-------|--------|--------|
| 1: Decision — SKU→field mapping + snapshot-at-accept + backfill-all | Done | _pending_ |
| 2: Quote → campaign delivery-number derivation (at quote accept) | Pending | - |
| 3: Remove metric fields from the Book Event dialog | Pending | - |
| 4: Production-setup override surface (reuse `billing_adjustments`) | Pending | - |
| 5: Tests + backfill + smoke verification | Pending | - |

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

**Overall Progress:** 20% (1/5 phases complete)

### Phase Checklist

#### Phase 1: Decision (resolve `intent.md` Open questions) — Done
- [x] SKU→field mapping — **D1**: `bdc`←Σ`bdc-call`, `letters`←Σ`letter-postage`, `smsEmail`←Σ`digital-record`, `qtyRecords`←`500×Σbase-event.qty`+Σ`additional-contact`; `additional-day`/`record-retrieval`/`travel` map to nothing.
- [x] Derive at accept vs lazy — **D2**: snapshot written onto the `campaigns` columns at accept (consumers keep reading raw columns); accept also sets `campaigns.acceptedQuoteId`.
- [x] Existing-campaign stance — **D3**: backfill-all (every campaign with an accepted quote gets all 4 metrics overwritten + `acceptedQuoteId` populated).
- [x] Event Format / Data Source — **D4**: keep both on booking (no SKU derives them; Format feeds the gcal invite).
- [x] Escape hatch — **D5**: fully defer; no volume fields on booking. (See [`decision.md`](decision.md).)

#### Phase 2: Quote → campaign derivation
- [ ] New pure module `src/lib/quotes/delivery-metrics.ts` — `deriveDeliveryMetrics(lines: {code, qty}[]) → {qtyRecords, smsEmail, letters, bdc}` per D1 (Σ over lines; unconditional all-four)
- [ ] Impure accept-time writer: on the `acceptQuote` `result.transitioned` path, load the accepted quote's `quote_line_items`, derive, and `UPDATE campaigns` (4 columns + `acceptedQuoteId`) for `quotes.campaignId`
- [ ] Unit tests for the mapping (dup-code sum, base-500, no-line ⇒ 0, non-mapping SKUs ignored)

#### Phase 3: Strip metric fields from booking
- [ ] Remove Qty/SMS/Letters/BDC `<Field>`s from `booking-form.tsx` (lines 401–436) — **keep** Event Format + Data Source
- [ ] Drop `qtyRecords/smsEmail/letters/bdc` from `booking-schema.ts` + `validators.ts` parse + the `createCampaign`/`updateCampaign` insert/update spread
- [ ] Confirm Production / Reports / event-detail / emails still read the campaign columns (now quote-sourced / blank-until-accept)

#### Phase 4: Production-setup override
- [ ] Surface the delivery numbers (quote-derived) with a `billing_adjustments`-backed override on the production side (note the `bdc`-not-aggregated gap in `queries.ts` rollups — decide whether to close it)

#### Phase 5: Tests + backfill + smoke verification
- [ ] Backfill script (`scripts/backfill-campaign-delivery-metrics.ts`, dry-run + `--write`, idempotent) — D3; read-only prod count first
- [ ] Integration: accept a quote → its campaign's delivery numbers reflect the line items (+ `acceptedQuoteId` set)
- [ ] Smoke (web-test): booking dialog no longer shows the metric fields; event-detail/production reflect the derived numbers
- [ ] Wiki ingest: `commercial-spine.md` + `data-model.md`
