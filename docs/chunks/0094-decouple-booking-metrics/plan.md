# Decouple campaign delivery metrics from booking — Plan

**Intent:** [`intent.md`](intent.md)
**Started:** _deferred — parked follow-up to 0093_

> **Parked 2026-06-24.** Follow-up to [`0093-calendar-quote-msa-status`](../0093-calendar-quote-msa-status/plan.md). Not started. **Un-defer trigger:** owner picks it up after 0093 is validated/shipped. Phases below are a first sketch — re-derive from `intent.md` (esp. the Open questions) when activated.

## Progress Tracker

| Phase | Status | Commit |
|-------|--------|--------|
| 1: Decision — SKU→field mapping + derive-at-accept vs lazy + backfill stance | Pending | - |
| 2: Quote → campaign delivery-number derivation (at quote accept) | Pending | - |
| 3: Remove metric fields from the Book Event dialog | Pending | - |
| 4: Production-setup override surface (reuse `billing_adjustments`) | Pending | - |
| 5: Tests + smoke verification | Pending | - |

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

**Overall Progress:** 0% (0/5 phases complete) — **parked, not started**

### Phase Checklist

#### Phase 1: Decision (resolve `intent.md` Open questions)
- [ ] SKU→field mapping table (`bdc-call`→`bdc`, audience→`qtyRecords`, SMS/Letters mapping — check the catalogue; flag fields with no SKU)
- [ ] Derive at quote **accept** (snapshot) vs lazy at read — pick one (lean: snapshot, matches `billing_adjustments`)
- [ ] Existing-campaign stance: forward-only vs backfill from accepted quote
- [ ] Event Format / Data Source: keep on booking (scheduling) or move (confirm)

#### Phase 2: Quote → campaign derivation
- [ ] On `markQuoteAccepted`, write the derived delivery numbers onto the campaign (the accepted quote's campaign, via `quotes.campaignId`)
- [ ] Unit tests for the mapping + the accept-time write

#### Phase 3: Strip metric fields from booking
- [ ] Remove Qty/SMS/Letters/BDC from `booking-form.tsx` + the create/update FormData parse
- [ ] Confirm Production / Reports / event-detail / emails still read the campaign columns (now quote-sourced)

#### Phase 4: Production-setup override
- [ ] Surface the delivery numbers (quote-derived) with a `billing_adjustments`-backed override on the production side

#### Phase 5: Tests + smoke verification
- [ ] Integration: accept a quote → its campaign's delivery numbers reflect the line items
- [ ] Smoke (web-test): booking dialog no longer shows the metric fields; production shows the derived numbers
- [ ] Wiki ingest: `commercial-spine.md` + `data-model.md`
