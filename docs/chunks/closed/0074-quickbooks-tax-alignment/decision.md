# 0074 — Phase 1 research findings + decision

**Date:** 2026-06-10
**Source:** read-only probe (`scripts/0074-tax-probe.mjs`) against the **CA sandbox** (realm `9341457252668239`), connected via `/admin/quickbooks`.

## What the CA company's tax setup actually is

**`Preferences.TaxPrefs`:** `{ "UsingSalesTax": true }` — **no `PartnerTaxEnabled`** flag.
→ **Manual sales tax, NOT Automated Sales Tax (AST).** This is the critical answer: QBO will **honor a tax code we supply** on the transaction. (Under AST, QBO computes from the customer's address and ignores supplied codes — which would have forced a different approach.)

**`TaxCode` (5):**
| Id | Name | Notes |
|----|------|-------|
| 2 | Exempt | GST ES (0%) |
| 3 | Zero-rated | GST/HST ZR (0%) |
| 4 | GST/HST Adjustment | (adjustment, no sales rate) |
| **5** | **HST ON** | **the taxable code — HST Ontario 13%** |
| 6 | Out of Scope | NOTAXS (0%) |

**`TaxRate` (14):** the only non-zero taxable rate is **HST ON / HST (ITC) ON = 13%** (#11/#12); everything else is 0% (GST EP/ES/ZR, line adjustments, NOTAXP/NOTAXS).

The sandbox is an **Ontario** company, so **only HST ON (13%) is configured**. Other provinces' codes (BC GST+PST, AB GST, QC GST+QST, the other HST provinces) are **not present** — they'd need to be added in the QBO company to test/use them.

## Decisions (answers the intent open-Qs)

1. **AST vs manual** → **manual** in this CA sandbox; the tax-code approach works. ⚠️ **Residual: verify the PROD Canadian company's `Preferences.TaxPrefs` before prod** — if prod has AST on, the approach changes (configure the customer's tax setup instead of supplying a code). Can't probe prod here (gated); do it during the prod cutover.
2. **Txn-level vs line-level `TaxCodeRef`** → **CORRECTED by the live smoke (2026-06-10): LINE-level.** The initial build used txn-level `TxnTaxDetail.TxnTaxCodeRef`, but pushing a real Ontario Estimate to the CA company returned **QBO error 6000 — "Make sure all your transactions have a GST/HST rate before you save."** QBO Canada requires the tax code on **every line** (`SalesItemLineDetail.TaxCodeRef = { value: <TaxCode.Id> }`); a transaction-level code alone is rejected. A line-level code also overrides a non-taxable item's default (the CA sample items are all `Taxable=false`). Fixed at `8cead78`: `mapQuoteToEstimate` now sets per-line `TaxCodeRef` and no `TxnTaxDetail`.
3. **What to pull** → `fetchTaxCodes` is the unit we reference (its `Id` is the `TxnTaxCodeRef.value`; its `SalesTaxRateList → TaxRate.RateValue` gives the rate). `fetchTaxRates` is secondary (rate lookup/validation). Store per the mapping below.
4. **Province → TaxCode mapping** → map the app's `tax_rates.province` to a QBO `TaxCode.Id` (e.g. ON → #5 "HST ON"). Resolve by name/rate at sync time; persist the link (extend `tax_rates` with `quickbooks_tax_code_id` + the QBO rate, or a small mapping table). A province with no active QBO tax code → **pre-flight fails closed** (mirror 0073's readiness check), rather than pushing an untaxed Estimate.
5. **Rate reconciliation** → QBO HST ON (13%) matches the app's Ontario rate (0065). **Decision: validate parity at sync time** (app `tax_rates.rate` vs the QBO code's rate) and surface a mismatch; the Estimate uses QBO's code (QBO computes), so as long as the rates match the total equals the quote. (Adopting QBO's rate as source-of-truth is a possible later refinement.)
6. **`tax_override`** → when a quote has a manual `tax_override`, QBO's code-computed tax may differ. Keep it simple for v1: if `tax_override` is set, **flag/skip** the code path (or document the divergence); revisit if real quotes need manual tax + push together.

## Consequence for the build (rewrites Phases 2–6)

- **Phase 2** — `fetchTaxCodes` (+ `fetchTaxRates`) in `client.ts`, mirroring `fetchItems`. ✅ shape verified by the probe.
- **Phase 3** — pull + map province → `TaxCode.Id` (+ rate), persist the link; admin "Pull tax codes" if a UI is warranted.
- **Phase 4** — `mapQuoteToEstimate`: replace the `TotalTax`/`TaxExcluded` block with `TxnTaxDetail.TxnTaxCodeRef = { value: mappedTaxCodeId }`; pre-flight fails closed if the quote's province has no mapped active code.
- **Phase 5** — validate app-rate vs QBO-rate parity; assert Estimate total == quote total.
- **Phase 6** — CA-sandbox smoke (after re-syncing dealers + re-pulling items from the CA company so a quote's dealer/SKUs are CA-linked): push an **Ontario** quote → Estimate, confirm tax line = 13% and total matches.

## Caveats carried forward

- **CA sandbox has only Ontario (HST ON).** Multi-province verification needs more tax codes added in the QBO company, or relies on prod having them.
- **CA sandbox dealer/item links are stale** (they hold the US sample company's entity ids from before the reconnect). A full Estimate smoke needs a re-sync (dealers) + re-pull (items) against the CA company first. See [[project_qbo_realms]].
- **Prod tax model unverified** — prod may be AST (decision #1 residual).
