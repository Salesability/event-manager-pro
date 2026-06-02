# Quote Line-Item Picker — Intent

**Created:** 2026-06-01
**Supersedes:** [`0053-quote-line-items-table`](../0053-quote-line-items-table/plan.md) — that chunk (0% built) normalized JSONB → `quote_line_items` while *keeping the calculator*. This chunk folds in the same table migration but pivots the composer to a picker, so 0053's relational table becomes the picker's backing store. 0053 moved to `closed/` as superseded.
**Reverses:** the locked "composer is a calculator, not a line-item picker" decision from [`closed/0035-quote-composer`](../0035-quote-composer/plan.md) (plan.md:92, :146). That was a deliberate v1 bet; this chunk is the v2 the same plan anticipated in OQ #8.

## Problem

The business owner's words: *"I think we need to simplify the Quote page. It should be a form that allows user to select from a list and we can build the items separately and have them stored on system like VIP EVENT with Description… I will build library of SKU's … load the price in on every quote separately. The preloaded is too complicated and buggy."*

Today the quote composer is a **parametric calculator**, not a picker. The coach fills in structured inputs — audience size, event days, BDC/letter/digital counts, record-retrieval bracket, travel $ — and `computeQuote()` (`src/lib/quotes/pricing.ts:174-251`) **auto-derives** the line items from hardcoded rules (`additional-contact qty = max(0, audienceSize − 500)`, etc.) bound to 8 hardcoded catalogue codes.

The acute disconnect: `services-admin` (`src/features/services/actions.ts:79` `createServiceItem`) already lets the owner create arbitrary SKUs with free-form `code`, `label`, `description`, `unitPrice` — and `service_items.description` already exists (`src/lib/db/schema/service-items.ts:25`, so "VIP EVENT with Description" is *already storable*). But a SKU created that way **can never appear on a quote**, because `computeQuote()` only emits the 8 known codes. The catalogue is a price-list feeding a formula, not a menu the coach picks from. That gap — plus the implicit, in-the-coach's-head pricing rules — is what reads as "too complicated and buggy."

## Desired outcome

The Quote composer becomes a **line-item picker**:

- The coach adds lines by picking a SKU from the catalogue (a real dropdown over `service_items`), sets a quantity, and gets a price **prefilled from the catalogue but editable on that quote**.
- The owner maintains the SKU library in `services-admin` — any SKU added (e.g. "VIP EVENT", with a description) immediately shows up in the picker. No code change needed to add a product.
- The line items the coach assembles are the source of truth: they persist as `quote_line_items` rows, render on the PDF (label + description + qty + price + line total), and roll up to subtotal/tax/total.
- The accepted quote's stored line rows **are the contract** (per [`commercial-spine.md`](../../wiki/commercial-spine.md)) — invoicing later sums those rows directly, no recompute-from-inputs cleverness required.

## Non-goals

- **No invoice schema / payment surface.** This lays the relational line-item floor; it does not stand up `invoices`/`invoice_line_items` (that stays 0025 Phase 7.3).
- **No decoupling or removal of `audience_source_id` or the `quotes.inputs` columns.** They stay on the schema, untouched, so the production export, reports, and calendar readers keep working (the 0037 Phase 4 deferral, [`commercial-spine.md`](../../wiki/commercial-spine.md) "Scope narrowed"). The composer simply stops *driving pricing* from them. Rehoming those readers is a later chunk.
- **No catalogue redesign.** `service_items` stays; we only loosen its coupling to the calculator (the `unit`/`range` machinery and the 8 load-bearing codes stop being load-bearing). `unitPrice` becomes the picker's seed price.
- **No new line types.** A line is `pick SKU → qty → price`. No bundles, no percentage discounts, no auto-derived quantities.
- **No prospect-visible discount math.** The PDF renders the tuned (effective) price only; the catalogue original is composer-side context for the coach, never shown to the prospect.

## Success criteria

- `quote_line_items` table exists (`id`, `quote_id` FK cascade, `service_item_id` FK / `code`, `label`, `description`, `qty`, `unit_price`, `override_unit_price`, `line_total`, `display_order`, timestamps), backfilled from the existing `quotes.line_items` JSONB.
- The composer renders **no** audience/days/counts inputs and **no** computed-read-only table. In their place: an "Add line" picker over the catalogue, with per-line qty + editable price + remove.
- Picking a SKU prefills `unit_price` from the catalogue; editing the price on the quote sets `override_unit_price`; `effectiveUnit(line) = override_unit_price ?? unit_price` drives line totals, the PDF, and roll-ups (reuses the 0052 mechanic).
- A SKU freshly created in `services-admin` (with a description) is selectable in the picker on the next composer load and renders its description on the PDF.
- `setQuoteInputs` delete-and-inserts `quote_line_items` from the picked lines; `subtotal/tax/total` land on `quotes.*` as today.
- `sendQuote` renders the picked lines (label + description + qty + effective price + line total) to the PDF.
- `quotes.line_items` JSONB column dropped; `computeQuote()` and the structured-input derivation are retired (or made provably dead).
- `quotes.inputs` / `audience_source_id` columns still present; production/reports/calendar smoke green (unchanged).
- `docs/wiki/` updated: `data-model.md` (new table, dropped column), `architecture.md` (flip the "calculator, not a picker" subsection), `commercial-spine.md` (composer flow), `log.md` entry.

## Open questions

- **0053 sequencing.** 0053 is 0% built (its tracker shows all Pending). Lean: **fold** 0053's Phase 1 table migration into this chunk's Phase 1 and move 0053 → `closed/` as superseded, rather than running both. (Resolved in `plan.md` — this chunk owns the migration.)
- **`code` vs `service_item_id` as the line's catalogue link.** A SKU can be archived/renamed after a quote is sent; the line is a snapshot. Lean: store **both** — `service_item_id` (FK, `ON DELETE SET NULL`) for "which SKU did they pick" reporting, and a denormalized `code`/`label`/`description`/`unit_price` snapshot so the line is self-contained even if the catalogue row changes. (Matches the existing snapshot intent of `quotes.line_items`.)
- **`quoteNotes` home.** `quoteNotes` lives in the `inputs` JSONB today and renders on the PDF. It's a genuine composer field, not a pricing input. Lean: keep a "Quote notes" textarea in the composer that continues to write `inputs.quoteNotes` (the one part of `inputs` the composer still touches). `travelNotes` retires (travel becomes an ordinary SKU line).
- **Unique constraint.** `(quote_id, code)` was unique under the calculator (one line per code). A picker could legitimately want two lines of the same SKU. Lean: **drop the uniqueness** — key on `(quote_id, display_order)` instead, or no unique beyond `id`. (Resolved in `plan.md`.)
- **Empty-quote guard.** A picker quote can have zero lines. `sendQuote` should refuse to send a $0 / empty quote. Capture as a Phase 6 guard.

## Why now

The owner has used the current composer and called it out directly as "too complicated and buggy" — the calculator's implicit rules and the can't-pick-my-own-SKU disconnect are live friction, not a hypothetical. The architecture is already drifting this way (0052 shipped per-line price overrides; 0053 was about to normalize line items into a table), so the pivot rides existing momentum rather than fighting it. `CURRENT.md` has no active plan, so the runway is clear.
