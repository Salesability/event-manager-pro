# Quote Line Items Table (with Price Overrides) — Intent

**Created:** 2026-05-15
**Supersedes:** [`0052-quote-coach-price-override`](../0052-quote-coach-price-override/plan.md) — the JSONB-only override approach.

> **Superseded + closed 2026-06-01** — folded into [`0062-quote-line-item-picker`](../../0062-quote-line-item-picker/intent.md). See the plan for context. This chunk bakes the override columns into the relational schema instead, in one combined move.

## Problem

`quotes.lineItems` is a JSONB snapshot today (see `src/lib/db/schema/quotes.ts:78` + the comment at lines 28–32 calling out the v1 decision). That worked while line items were a write-once read-many artifact, but two pressures are now stacking up:

1. **Per-line coach price overrides** (the 0052 ask) — currently a JSONB field extension. The override is data that *should* be queryable: "show me every quote where a coach discounted travel" is a report we'll want, and `jsonb_path_query` for that is a sharp edge.
2. **Invoicing (Phase 7.3 of the 0025 quote-to-payment umbrella)** — the existing schema comment explicitly defers normalization "to 7.3 if invoicing needs per-line reporting." Invoicing turning each line into an invoice line item makes the table-vs-JSONB question move from "nice-to-have" to "load-bearing".

Doing the table migration *and* the override columns in one chunk avoids a future double-migration (JSONB → JSONB+override → table) and keeps the override feature shipped on the same relational shape every downstream consumer will speak.

## Desired outcome

`quote_line_items` is a first-class relational table — one row per computed line per quote — and is the source of truth that the composer, PDF renderer, and `sendQuote` action read from. Each row carries the canonical catalogue `unit_price` *and* an optional `override_unit_price`, plus a stored `line_total` derived from `(override_unit_price ?? unit_price) * qty`. The composer Summary section toggles per-line overrides exactly as the closed 0052 plan described, but the toggle now binds to a real column. The `quotes.line_items` JSONB column is dropped at the end of the chunk; the pre-existing roll-up columns (`subtotal`, `tax`, `total`) stay — they're the only relational totals we need today.

## Non-goals

- **No invoice schema work.** This chunk lays the relational floor that 7.3 will build on; it does not stand up `invoices` / `invoice_line_items` or wire any payment surface.
- **No catalogue redesign.** `service_items` remains the source of `unit_price`; `quote_line_items.unit_price` is still a per-quote snapshot of the catalogue at compute time.
- **No new line types.** The composer stays a calculator. The override is unit-price-only.
- **No prospect-visible discount math.** PDF renders the tuned price; original is not shown to the prospect.
- **No new audit shape.** The existing `quote.edited` / `quote.sent` audit rows continue to capture state changes; we don't add a `quote_line_item.changed` row per line.
- **No JSONB fallback after the column drops.** The migration backfills then deletes; no "read from JSONB if table empty" defensive code.

## Success criteria

- `quote_line_items` table exists with columns: `id`, `quote_id` (FK, cascade), `code`, `label`, `unit`, `qty`, `unit_price`, `override_unit_price`, `line_total`, `display_order`, timestamps.
- Unique constraint on `(quote_id, code)` — `computeQuote()` emits unique codes per line.
- Composer load path reads from the table and rehydrates the existing `ComputedLine[]` shape (with `overrideUnitPrice` as the new optional field) — UI code below the persistence layer is unchanged in shape.
- `setQuoteInputs` delete-and-inserts the table on every save; the recomputed `subtotal/tax/total` continue to land on `quotes.*`.
- `quotes.lineItems` JSONB column dropped at the end of the chunk; one migration creates the table + backfills from JSONB, a second migration drops the column.
- Override toggle + per-line editable Unit input ship on the composer Summary section, bound to the new column.
- `sendQuote` renders `effectiveUnit(line) = override_unit_price ?? unit_price` to the PDF.
- `docs/wiki/data-model.md` updated to reflect the new table and the dropped column.

## Open questions

- **JSONB column lifecycle.** Drop in the same chunk (cleanest), or keep one release with parallel writes? Lean drop — the chunk is one feature branch, no production rollout split, and the PDF in GCS already snapshots the "at-send" view independently.
- **Unique constraint or not.** `(quote_id, code)` is unique today because `computeQuote()` emits unique codes; the constraint matches that invariant. Lean **add the constraint** — cheaper to drop later than to add over dirty data.
- **`display_order`: stored or derived.** Stored integer column from `ComputedLine` array index is simplest; derived sort by `code` couples display order to alphabetical accident. Lean stored.
- **`override_unit_price` precision.** Match `unit_price` (`numeric(10,2)`)? Or wider to support per-line absurdities? Lean match.
- **Override toggle persistence.** A `quotes.prices_overridden boolean` flag, or derive on read (`exists(override_unit_price)`)? Lean derive — single source of truth, one fewer column to keep in sync.
- **`hashLineItems` digest** (`src/features/quotes/actions.ts:164`). Today it hashes the JSONB blob to detect no-op saves. Swap to hashing the post-write table rows ordered by `display_order` — same idea, table-rooted.

## Why now

Pulled forward from the schema comment's "deferred to 7.3" position by two converging asks: (a) the same-session 0052 override feature, which would otherwise extend JSONB shape we already know is on the chopping block; (b) the 0025 quote-to-payment umbrella's 7.3 invoice phase being the next non-trivial commercial-spine slot, where relational line items unblock invoice-line-item modeling. Combining the two avoids shipping override on JSONB then immediately re-shipping on the table.
