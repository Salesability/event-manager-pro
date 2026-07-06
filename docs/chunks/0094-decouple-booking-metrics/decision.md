# 0094 — Decision record (Phase 1)

Resolves the five Open Questions in [`intent.md`](intent.md). Decided 2026-07-06 with the owner. Grounded in a code recon pass over the SKU catalogue, the campaign metric columns, the accept path, and the reporting/production consumers.

## D1 — SKU → delivery-metric mapping

The four campaign delivery columns are derived from an accepted quote's `quote_line_items` (`code` + `qty`), keyed off the 8-code catalogue seeded in `drizzle/0013_seed_service_items.sql`:

| Campaign column | Derivation |
|-----------------|------------|
| `qtyRecords` (`qty_records`) | `500 × Σ base-event.qty` + `Σ additional-contact.qty` |
| `smsEmail` (`sms_email`) | `Σ digital-record.qty` |
| `letters` | `Σ letter-postage.qty` |
| `bdc` | `Σ bdc-call.qty` |

- `base-event` "includes 500 records"; `additional-contact` is the per-record uplift above the base — so audience = base 500 (per base-event unit) + each additional-contact. The `500 × Σ base-event.qty` form (not `500 × line-count`) treats a qty-N base line as N×500; qty is 1 in practice, so the normal case is unaffected.
- **No metric field:** `additional-day` (scheduling), `record-retrieval` (a service, not a volume), `travel` (dollars). These contribute nothing.
- A SKU may legitimately appear on multiple lines (rows are delete-and-reinserted, no `(quote_id, code)` unique) — hence **Σ over lines**, not "first match."
- The mapping lives in a pure, DB-free module so both the accept-time write (D2) and the backfill (D3) share one source of truth.

## D2 — When to derive: snapshot at accept

Derive **once, at quote-accept**, writing the four numbers straight onto the `campaigns` columns (a snapshot), **not** a lazy read-time join.

- Every consumer already reads the raw `campaigns.{qtyRecords,smsEmail,letters,bdc}` columns (Production list + CSV, event-detail card, confirmation emails) or layers `billing_adjustments` on top (Reports). A snapshot keeps all of them unchanged — a lazy derive would mean rewriting every consumer to join `quotes`/`quote_line_items`.
- Matches how `billing_adjustments` (0059) already works: a persisted value the admin can override.
- The write also sets **`campaigns.acceptedQuoteId`** (the campaign→accepted-quote link declared on the schema since 0093 but written by nothing today) so the campaign records which quote delivered it.
- **All four columns are written unconditionally** (a quote with no `bdc-call` line ⇒ `bdc = 0`), so the campaign row deterministically reflects its accepted quote's scope rather than a mix of derived + stale values.
- Hook point: the `acceptQuote` action's post-transition block (alongside the existing audit + prospect-promotion side effects), **inside `if (result.transitioned)`** so only the real `sent → accepted` transition writes. (An earlier revision ran it on every confirmed-accepted call for "self-healing"; the chunk-end Codex review flagged that a re-accept of an *older* accepted quote would then regress the campaign off its latest quote — so the write is transition-gated. A failed snapshot is re-drivable via the Phase-5 backfill.) A future public accept route must replicate it, same as it must the MSA gate + audit.
- **Cross-dealer write guard.** The campaign UPDATE is scoped to `campaigns.dealerId = quote.dealerId` (not just `campaigns.id = quote.campaignId`). `setQuoteDealer` swaps a draft quote's `dealerId` without reconciling its `campaignId`, so a quote can point at another dealer's campaign; the guard makes a stale cross-dealer link a 0-row no-op instead of an overwrite. The backfill query carries the same `c.dealer_id = q.dealer_id` guard. Both surfaced by the chunk-end Codex review (2 High); root fix (reconcile `campaignId` on dealer-swap) parked as **0094-c**.

## D3 — Existing campaigns: backfill all

One-time backfill: **every campaign that has an accepted quote gets all four metrics overwritten** from that quote's line items (+ `acceptedQuoteId` populated).

- 0094's premise is that booking-time numbers are premature guesses; making the quote authoritative retroactively is the point.
- Preferred over blanks-only because the hand-entered numbers are booking-time scope guesses, not verified actuals — a true production difference is re-recorded via the Phase 4 override.
- The backfill touches **only the base `campaigns` columns**. It does not read or write `billing_adjustments`, so any existing invoice-time override still wins in Reports. (It *does* change what Production and the event-detail card show, since those read raw columns with no overlay.)
- Candidate set is found from the `quotes` side (`status='accepted'` with a `campaign_id`), since `campaigns.acceptedQuoteId` isn't populated pre-0094. Idempotent (re-running derives the same numbers). Blast radius is small today — `quotes.campaign_id` only arrived with 0093 — so few prod campaigns have an accepted quote yet. Run a read-only count against prod before the write.

## D4 — Event Format + Data Source: keep on booking

`campaigns.styleId` (Event Format) and `campaigns.audienceSourceId` (Data Source) **stay on the Book Event dialog**. Only the four *volume* fields leave.

- No SKU maps to either, so a quote cannot derive them.
- Event Format feeds the Google Calendar invite body (`Format:`), which is pushed at booking time — it must be known at scheduling.
- Data Source is a scheduling-time pick. (`quotes.audienceSourceId` exists too, but it's not composer-driven; moving ownership there would mean composer + migration work for no gain.)

## D5 — Blank window: fully defer

No volume fields on booking at all. A campaign shows blank `qtyRecords/smsEmail/letters/bdc` from booking until its quote is accepted.

- The confirmation emails already null-safe these (`fmtNum(null)` → blank, `bdc || 'TBD'`), and they're a manual `status='booked'` action, not fired at booking.
- Production / event-detail render blank until accept; real production differences are handled by the Phase 4 override surface (`billing_adjustments`).
- Rejected keeping a collapsed "rough numbers" box on booking — it re-introduces exactly the double-entry 0094 removes.

## D6 — Phase 4 override surface: Reports-only (Option 1)

The delivery-vs-quote override stays a **billing/invoice concern on `/reports`**; the `/production` page keeps showing the raw (now quote-derived) campaign numbers. **No new override surface is built** on Production.

- The override mechanism already exists in full: `billing_adjustments` (0059) + the inline-editable `BillingCell` on the Reports → Full Production Report tab (`reports:edit-billing`). It reads `override ?? campaign[field]`, and `campaign[field]` is now the quote-derived value (D2) — so the override composes with the new defaults with **zero code change** (verified at `reports-columns.tsx:129-131`).
- Owner decision (2026-07-06): the override is a billing truing-up, not a production-team edit — "since billing for the delivery, no need to reflect those changes back to the production page." So Production = "what the accepted quote scoped," Reports = "what we bill (quote value, or an admin correction)."
- Rejected: applying the overlay to the Production read path (Option 2) or adding a second edit surface on Production (Option 3) — both expand an outward-facing surface the owner doesn't want.
- **Phase 4 therefore ships no code** — it records this decision and confirms the composition. The recon-surfaced `bdc`-not-aggregated gap in the by-dealer/coach/month rollups (`queries.ts` builds `adj_records/adj_sms/adj_letters` but no `adj_bdc`) is **pre-existing (0059-era), out of 0094's scope, and left as a parked follow-up (0094-a)** rather than fixed in-chunk.

## Consequences for later phases

- **Phase 2** — new pure module `src/lib/quotes/delivery-metrics.ts` (`deriveDeliveryMetrics(lines)`); impure accept-time writer hooked into `acceptQuote` (writes the 4 columns + `acceptedQuoteId`); unit tests for the mapping.
- **Phase 3** — strip Qty/SMS/Letters/BDC from `booking-form.tsx` + `booking-schema.ts` + `validators.ts` + `createCampaign`/`updateCampaign` parse; **keep** Event Format + Data Source.
- **Phase 4** — no code (D6): override stays Reports-only; confirm the existing `billing_adjustments`/`BillingCell` overlay composes with quote-derived defaults; park the `bdc`-aggregation gap as 0094-a.
- **Phase 5** — backfill script (D3, dry-run + `--write`), integration test (accept → campaign reflects line items), web-test smoke (booking has no volume fields), wiki ingest (`commercial-spine.md`, `data-model.md`).
