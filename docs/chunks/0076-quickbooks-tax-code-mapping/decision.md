# 0076 Decision — Row model: keep seeded rows, QB-managed via the mapping

**Date:** 2026-06-11
**Status:** Accepted (owner-locked — "lock and build", recommended option)

## Decision

Keep the **13 seeded `tax_rates` rows**. A province is **"QB-managed" ⇔ `quickbooks_tax_code_id IS NOT NULL`** (inferred — **no new column, no migration, no seed change**).

The "QB-derived tax lookup" the owner wants is a **presentation + semantics** layer, not a physical row model:

- The quote path (`dealerTaxRatePct` → `tax_rates[dealer.province]`) is **unchanged** — every province always has a row, so there is no "missing-row" failure mode to handle across the read callers.
- The `/admin/lookups` mapping UI presents provinces as **managed** (mapped to a QB code — "the rows currently in QB") vs **unmanaged** (no code). The **"Add province"** action = *assign a QB code to a not-yet-mapped province* (moving it into the managed set), **not** a row INSERT.
- The **rate is adopted from the mapped code** (group-aware `resolveCodeRatePct`); an unmanaged province keeps its seeded rate as a visible fallback.
- A dealer in an **unmanaged** province is flagged/guarded at quote time (Phase 5) — never silently $0.

## Rationale

- **Minimal churn:** no migration, no quote-path rewrite. The managed-flag + the quote guard already express "only QB-mapped provinces are usable" without physically deleting rows.
- **Keeps the quote read simple:** physically deleting rows would force every `tax_rates[province]` caller to handle an absent row, for no functional gain.
- **Owner intent preserved:** "the lookup should only show rows currently in QB" is satisfied at the **presentation** layer (the managed list); "add a row when a QB code is added later" maps to the "Add province → assign code" action.

## Alternative considered (rejected)

- **QB-derived rows (delete seed; INSERT on map, DELETE on unmap).** Rejected — complicates the quote read path (absent-province handling) and the seed/migration, with no benefit over the managed-flag + guard. The semantics are identical from the user's view.

## Consequences for Phases 2–6

- **Phase 1:** no `db-conventions` schema work (no migration). ✅
- **Phase 3 UI:** present **managed vs unmanaged** provinces; "Add province" = assign a code to an unmanaged one.
- **Phase 4 actions:** `assignProvinceTaxCode` sets `quickbooks_tax_code_id` + adopts the code's summed rate; `refreshTaxRates` re-syncs rates of mapped provinces only. No DELETE/INSERT of rows.
- **Phase 5 guard:** "unmanaged province" = `quickbooks_tax_code_id IS NULL` → flag at quote save/push (aligns with the 0074 pre-flight).

## References

- [`intent.md`](intent.md) · [`../closed/0075-quickbooks-tax-rate-source/decision.md`](../closed/0075-quickbooks-tax-rate-source/decision.md) (managed-inference precedent; the matcher being demoted).
