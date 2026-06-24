# Decouple campaign delivery metrics from booking — source from the accepted quote — Intent

**Created:** 2026-06-24

## Problem

The **Book Event** dialog captures four campaign metric fields — **Qty Records / SMS-Email / Letters / BDC** (plus Event Format + Data Source) — as part of *scheduling a date*. These are real, load-bearing **operational delivery numbers**: they're consumed by the **Production** surface (`/production` columns + export — what the team actually produces/sends), the **Reports** surface (with the 0059 `billing_adjustments` overlay), the event-detail card, and the campaign confirmation emails.

But chunk 0093 made the **quote the commercial source of truth** for an event, which exposes two problems with capturing these at booking time:

1. **Wrong moment (premature double-entry).** These are *scope / volume* numbers that the **quote** now owns — its line items price exactly this (a `bdc-call` SKU, audience size, per-channel counts). At booking (the date-grab step, *before* any quote exists) the coach usually doesn't know them yet, so they sit **blank** and get re-entered later when the quote is built. The owner spotted this directly: the fields "seem stale with [the] integrated quote."
2. **No sync (silent divergence).** There is **zero** linkage between a quote's line items and these campaign numbers today — they're typed independently. So the *priced scope* and the *delivery numbers* can drift apart with nothing reconciling them; only `billing_adjustments` patches reporting after the fact.

## Desired outcome

Booking captures only **scheduling** (date / dealer / day-of contact / coach / notes). The **delivery numbers are sourced from the accepted quote** (derived from its line items) — the quote is the single source for scope; the campaign carries *operational delivery*, defaulted from the quote and overridable for true production differences (the role `billing_adjustments` already plays). Net: **booking schedules, the quote scopes, production delivers** — which is exactly the "quote = commercial source of truth, campaign = operational delivery" split the commercial spine already describes.

## Non-goals

- Redesigning the quote composer or its line-item model (we *read* its line items, not rebuild them).
- Replacing the `billing_adjustments` overlay (0059) — reuse it as the override mechanism for delivery-vs-quote differences.
- Touching the 0093 quote/MSA *status* surface (this is the sibling concern: scope/metrics, not commercial status).
- Removing the Production / Reports consumers of these numbers — they stay; only the *entry point* moves.

## Open questions

- **SKU → field mapping.** Which quote line-item SKUs map to `qtyRecords` / `smsEmail` / `letters` / `bdc`? (`bdc-call` → `bdc` is clean; audience size → `qtyRecords`; SMS/Email + Letters mapping needs the catalogue checked.) Some fields may have no SKU and stay manual.
- **When to derive.** At quote **accept** (write the campaign numbers once, like a snapshot) vs. **lazily** at read time (always reflect the latest accepted quote)? Snapshot is simpler + matches how `billing_adjustments` overrides work.
- **Existing campaigns.** What happens to the manually-entered numbers on already-booked campaigns? Leave as-is (forward-only), or backfill from their accepted quote where one exists?
- **Event Format / Data Source.** Do these belong with scheduling (keep on booking) or with scope (move too)? They feel more like booking metadata than quote scope — likely keep, but confirm.
- **Quick-entry escape hatch.** Should booking keep an optional collapsed "rough numbers" entry for the no-quote-yet case, or fully defer? (Lean: fully defer — the whole point is the quote owns them.)

## Why now

Surfaced while the owner was trying the 0093 flow on the dev server (2026-06-24): with the quote integrated into the event lifecycle, the booking form's metric fields read as stale/premature. Captured as a follow-up so 0093 (quote/MSA *visibility*) ships clean; this chunk handles the *scope-ownership* half. **Un-defer trigger:** owner picks it up after 0093 is validated/shipped.
