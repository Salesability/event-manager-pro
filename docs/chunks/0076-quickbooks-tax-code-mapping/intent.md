# QuickBooks Tax-Code Mapping (QB-derived tax lookup) — Intent

**Created:** 2026-06-11

## Problem

[0075](../closed/0075-quickbooks-tax-rate-source/plan.md) made QuickBooks the source of truth for province tax rates, but it did so with a **name heuristic** ("HST ON" → ON) auto-applied by a **"Pull tax codes" button** — and removed the in-app tax editor entirely. Real prod data (QBO realm `193514766730959`) breaks the heuristic:

- **Nova Scotia has two active codes** — `HST NS` (15%, the pre-2025 rate) and `HST NS 2025` (14%, current). The trailing-token matcher picks the **stale** `HST NS` → would set NS to 15% (over-charge).
- **NB/NL/PE share one `HST Atlantic 15%` code** that names no single province → the matcher can't link them at all.
- **Quebec/BC/SK/MB** need **group codes** (GST + QST / GST + PST) that QBO supports but the company hasn't set up yet — and a group code's name won't always trailing-token-match its province.

So the heuristic both **mis-maps** (NS) and **can't map** (Atlantic/group) the real data, and clicking "Pull tax codes" would silently corrupt the rates. There's also no in-app way to *see* or *correct* the mapping (0075 removed the editor). The interim `scripts/0075-tax-map.mjs` sets the mapping by hand, but that's a script, not a surface.

## Desired outcome

A **province → QB-tax-code mapping** managed in-app on `/admin/lookups`, where:

- Each province maps to its QBO tax code **explicitly** (a dropdown of live QBO codes), single **or group** (the rate is adopted from the code — `resolveCodeRatePct` already sums group components, e.g. QC's 5% + 9.975% = 14.975%).
- The `tax_rates` lookup is **QB-derived**: a row is meaningful only when mapped to a QB code; an **"Add province"** action maps a province to an available code, and new QB codes become mappable later.
- The name heuristic is **demoted to a suggestion** (pre-selects the likely code; admin confirms) — never auto-applied. The auto-apply "Pull tax codes" button is **retired**.
- A **"Refresh rates"** action re-syncs the rates of already-mapped provinces from QB (never re-maps), and surfaces drift / broken links / available-but-unmapped codes read-only.
- **Quebec's dual GST+QST schema works**: mapping QC → the group code; the app preview shows the correct flat 14.975% (non-compound since 2013), and the Estimate push stamps the group `TaxCodeRef` so QBO computes + posts GST and QST to their **separate GL accounts** at invoice time.
- A dealer in an **unmapped** province is **flagged** at quote time ("not set up for tax — add it in QB + map it"), never charged a silent $0.

The principle: **the app pushes the *code*, not a tax amount; QB computes + posts the tax. Mapping the right code is what guarantees GL correctness — the rate in `tax_rates` is only the customer-facing preview.**

## Non-goals

- **Switching the QB company to Automated Sales Tax (AST).** Stays manual sales tax (per-line `TaxCodeRef`), as verified on prod.
- **Per-customer `DefaultTaxCodeRef` as the source of truth.** The API returns it, but the live data is sparse + wrong (two NB dealers point at NS codes) — the centralized province→code map is the reliable key.
- **Setting up the missing provincial codes *in QuickBooks*** (Quebec, BC/SK/MB group codes). That's an owner/bookkeeper task in QB; this chunk makes the app *map* them once they exist.
- **Cleaning up the existing wrong per-customer defaults in QB** (a bookkeeping fix, surfaced separately).
- **Re-opening a free-form rate editor.** Rates are QB-adopted; the only in-app control is the *mapping* (which code), not the rate value.

## Success criteria

- `/admin/lookups` shows a "Sales Tax Rates" section: per province, its app rate + a dropdown of live QBO codes + a "managed by QuickBooks" badge when mapped; the heuristic pre-selects a suggestion but the admin confirms.
- Assigning a code sets `tax_rates.quickbooks_tax_code_id` + adopts that code's (summed) rate — **including group codes** (QC maps to 14.975%).
- "Refresh rates" updates only already-mapped provinces' rates; it never changes a code link, and it flags a deleted/deactivated linked code instead of clearing it.
- The auto-apply "Pull tax codes" button is gone; nothing can silently re-map provinces.
- A quote for a dealer in an unmapped province is blocked/flagged (not silent $0), consistent with the 0074 push pre-flight.
- A **group-code (QC or BC) Estimate push** computes both tax components on a real Estimate (0074 only live-tested single-rate ON).
- `tsc` + tests green; chunk-end `/eval` PASS.

## Open questions

- **Row model (Phase-1 decision):** keep the 13 seeded `tax_rates` rows and treat "managed ⇔ `quickbooks_tax_code_id` set" (likely **no migration**), or truly delete-and-derive rows from QB mappings? The quote path reads `tax_rates[dealer.province]`, so absent rows need a defined behavior. **Leaning: keep the rows, drive "usable" off the mapping + the unmapped-province guard — minimal schema churn.**
- **Quote PDF for QC:** show GST + QST as two lines (more correct/professional) or keep the single combined "Tax 14.975%" line? (Optional nicety; the total is identical either way.)
- **Per-line vs total tax rounding:** QB computes tax per line; the app computes on the subtotal — can differ by a cent or two on the preview vs the QB invoice. Make the preview compute per-line to match exactly, or accept the cent? (Not a GL issue.)

## Why now

We just deployed 0073/0074/0075 to prod and connected the real prod QBO company, and the first hands-on probe revealed the heuristic would corrupt NS (and can't map Atlantic/group provinces). The mapping needs to be explicit and in-app before anyone pushes real quotes → Estimates with tax, and before the owner sets up Quebec/BC/SK/MB in QB.

## Relationship to prior work

- **[0075](../closed/0075-quickbooks-tax-rate-source/plan.md)** — established QB-as-tax-rate-source + the name matcher; this chunk replaces its auto-apply heuristic with explicit mapping and restores an (mapping) editor. Reuses `resolveCodeRatePct` (group-aware) and demotes `resolveProvinceLinksByName` to a suggester.
- **[0074](../closed/0074-quickbooks-tax-alignment/plan.md)** — the per-line `TaxCodeRef` push + pre-flight; this chunk feeds it correct mappings and adds the group-code push verification.
- **0072** — the read-only service-items list precedent (restoring a view on an admin page after a CRUD removal).
- Interim: `scripts/0075-tax-map.mjs` (staged ON/NS/NB/NL/PE override) unblocks pushes until this UI ships.
