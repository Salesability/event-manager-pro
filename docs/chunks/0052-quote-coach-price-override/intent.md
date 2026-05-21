# Quote Coach Price Override — Intent

**Created:** 2026-05-15

## Problem

The quote composer's **Summary** table renders unit prices straight from the service-items catalogue (with the existing travel + tax overrides as the only escape hatches). Coaches frequently want to nudge specific line prices for a given prospect — a discount on `additional-contact`, a rounded-up travel rate, a courtesy reduction on `record-retrieval` — without permanently editing the house catalogue or rebuilding a quote from scratch. Today the only options are "edit the catalogue globally" (wrong blast radius) or "send the quote as-is" (gives up the deal).

## Desired outcome

On the Summary section, a coach can opt into per-line price tuning for one quote. The **house quote** — what the composer persists as the canonical computation — retains the catalogue-derived unit prices as a reference. The **prospect-facing artifact** (PDF, email, share view) renders the coach's tuned numbers. Subtotal / tax / total in the composer and on the PDF reflect the tuned amounts. The coach can see both the original and the override side-by-side while editing, so the discount is legible to the coach but invisible to the prospect.

## Non-goals

- **No new line items.** The composer stays a calculator, not a line-item picker. Override is unit-price-only on the lines the catalogue already computed.
- **No discount math or % discount UI.** Coach types a tuned dollar amount; we do not separately persist a "discount $ / %" pair.
- **No audit trail UI.** The original price is preserved in the JSONB snapshot; whether/how to surface a delta report is a follow-up.
- **No catalogue edits.** This chunk does not change `service_items` or its admin UI.
- **No per-line override on travel or tax.** Those already have their own override paths; the Summary override applies to the *computed* line rows.
- **No prospect-visible "was/now" presentation.** Prospect sees the tuned price only.

## Success criteria

- Composer Summary has a coach-only toggle ("Override unit prices") above the line-item table.
- When toggled on, each Unit-price cell becomes editable; the original catalogue price is visible alongside as a dim/struck reference.
- Subtotal / tax (if not manually overridden) / total recompute from the overridden unit prices.
- The persisted `quotes.lineItems` JSONB carries **both** the canonical `unitPrice` and an optional `overrideUnitPrice` per row, so the original is recoverable.
- The PDF emitted by `sendQuote` renders override prices when present; otherwise falls back to the canonical `unitPrice`.
- Toggling override off clears all per-line overrides and snaps totals back to the catalogue computation.

## Open questions

- Does turning the toggle off **clear** overrides, or just **hide** them? (Leaning clear — preserves the "original = canonical" invariant.)
- Should the PDF carry a tiny "tuned for client" footnote, or is the override invisible to the prospect entirely? (Leaning invisible.)
- Tax: when override prices are set, does the existing `taxOverride` field stay coach-typed, or recompute from override subtotal? (Leaning: leave `taxOverride` exactly as today — if the coach already typed a tax dollar amount, respect it; otherwise tax is recomputed from the override subtotal.)

## Why now

Sales motion has hit cases where a small per-line nudge would close a deal, and the only path today is asking the coach to edit the catalogue (which mutates every future quote) or fudge the travel amount as a hidden discount line. Adding a clean override on the Summary table closes that gap without touching the catalogue or the line-item shape.
