# Remove the per-quote tax override — Intent

**Created:** 2026-06-15

## Problem

The quote composer lets a coach set a **manual per-quote tax override** (the "Override" link on the
Tax field → an editable amount; `quotes.tax_override`, 0065). That made sense when the app owned tax
rates, but **QuickBooks is now the tax authority**:

- 0075/0076 made QB the source of truth for province tax **rates** — each province's rate is adopted
  from the mapped QBO `TaxCode` into `tax_rates`, and the in-app rate editor was removed.
- The Estimate push (0073/0074) lets **QB compute the tax** on the Estimate via per-line `TaxCodeRef`.

So the per-quote override is now (a) **redundant** with the auto, QB-sourced province rate, and
(b) a **footgun**: `quote-push.ts:97` already rejects any quote carrying a manual override
(*"This quote has a manual tax override, which can't be pushed to QuickBooks yet"*). A coach can set
an override, then discover the quote won't push to QB. Owner decision (2026-06-15): **remove it.**

## Desired outcome

On the quote composer, the Tax field is **display-only**: it shows the auto, QB-sourced province-rate
tax + the `auto · <Province> X%` pill, with **no "Override" link and no editable override input**.
Tax is always `round(subtotal × province_rate)`; there is no per-quote manual path. The "no province
set" hint state is unchanged. Quotes can no longer enter the QB-push-blocking override state.

## Non-goals

- Changing how QB computes tax on the Estimate, or the Estimate-push flow itself (0073/0074).
- Changing the province → QB-tax-code mapping or the rate-adoption path (0075/0076).
- Touching the `tax_rates` table or how the auto rate is derived.
- Adding any new tax-exemption / zero-rated mechanism (if a customer is tax-exempt, that's handled in
  QB at invoicing — not re-introduced as an app-side per-quote field).

## Success criteria

- The composer Tax field shows only the auto province-rate value + pill; the **Override** link and
  the override-mode input are gone.
- A new/edited quote never persists a non-null `tax_override`; `tax` is always the auto computation.
- `setQuoteTax` (the action that only existed to set the override) is retired, and `createQuote` /
  `setQuoteInputs` no longer read a manual `tax` field.
- The `computePickedTotals` `override` parameter is gone; callers pass only `{ ratePct }`.
- The QB-push override-rejection guard is dead-but-harmless (no quote can be in that state) — kept as
  defensive or removed per the implementation decision.
- Existing quotes behave per the **Open question** decision below (no silent change to already-sent
  quote totals unless explicitly chosen).
- Static + browser smoke green; chunk-end `/eval` PASS.

## Open questions

1. **The `quotes.tax_override` column + existing overridden quotes — keep or drop?** This is the
   load-bearing decision and must be made from **prod** data (sandbox is throwaway).
   - **Data-impact check (Phase 1, needs `gcloud auth login` — prod token expired 2026-06-15):**
     count prod quotes with `tax_override IS NOT NULL`, broken down by status. *Sandbox already shows
     5 overridden quotes — 3 `sent` + 2 `accepted` (all terminal/customer-facing) — so the risk is
     real on that DB; prod is the one that decides.*
   - **Option A — keep the column (expand→contract, db-conventions):** stop reading/writing
     `tax_override`; the composer + actions ignore it. **Preserves the historical tax on
     already-sent/accepted quotes** (their `tax`/`total` columns are already persisted snapshots, but
     if any read path recomputes from `tax_override`, keeping the column avoids a silent change).
     Drop the column in a later migration once verified. **No migration now.** Safest.
   - **Option B — drop the column now (migration):** cleaner schema, but any historically-overridden
     quote loses the override record; if a read/render path recomputes tax, those quotes' displayed
     tax shifts to the auto province rate. Only acceptable if the prod count is **0** (or all-draft).
   - **Sub-question:** does any *read/render* path (PDF re-render, queries projection) recompute
     `tax` from `tax_override` live, or is `tax` a persisted snapshot that's immune? If `tax` is
     always a stored snapshot on `quotes`, removing the override write-path can't retroactively change
     a sent quote — which makes Option A trivially safe and Option B safe-modulo-the-column-drop.

## Why now

The owner reviewed the Tax field and flagged the override as unnecessary now that QB manages tax
(2026-06-15). It directly follows the 0075/0076 "QB owns tax rates" work and removes a live footgun
(override → can't push to QB). Small, focused cleanup; lands on the just-shipped 0078 quote surface.
