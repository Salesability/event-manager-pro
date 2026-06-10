# QuickBooks Tax Alignment — Plan

**Intent:** [`intent.md`](intent.md)
**Started:** 2026-06-10 (scaffolded — **Phase 1 is a research/decision gate; do not build implementation phases until the Canadian-sandbox blocker is resolved**)

## Progress Tracker

| Phase | Status | Commit |
|-------|--------|--------|
| 1: Research/decide — Canadian-sandbox blocker + AST/tax-code shape (GATE) | In Progress | - |
| 2: `client.ts` — `fetchTaxCodes` / `fetchTaxRates` (+ types) | Pending | - |
| 3: Tax-code mapping + storage (province ↔ QBO `TaxCode`, pulled rate) | Pending | - |
| 4: Wire `mapQuoteToEstimate` — set `TaxCodeRef`, drop the `TotalTax` override | Pending | - |
| 5: Reconcile rate so Estimate total == quote total | Pending | - |
| 6: Tests + Canadian smoke + wiki | Pending | - |

The QBO tax-alignment slice — make a pushed Estimate's tax correct + matching, by pulling QBO `TaxCode`/`TaxRate` and setting a real `TaxCodeRef` on the Estimate instead of the (dropped) `TxnTaxDetail.TotalTax` override. Fixes the confirmed 0073 finding (pushed Estimates omit tax; total = pre-tax subtotal). **Phase 1 is a gate:** the connected sandbox is US (California) while prod is Canadian (GST/HST/PST), so the Canadian tax-code shape + mapping can't be built/verified against the current sandbox — the owner picks the Phase-1 path (Canadian sandbox / defer-to-prod / inspect-prod-setup) before Phases 2–6 are committed. Phases 2–6 are **provisional** and will be rewritten once Phase 1 lands.

## Code Anchors

| New code | Anchor (`path:line`) | Why this anchor |
|----------|---------------------|-----------------|
| `fetchTaxCodes` / `fetchTaxRates` + `QboTaxCode`/`QboTaxRate` types in `src/lib/quickbooks/client.ts` | `client.ts:364` `fetchItems` (+ `fetchCustomers` `:209`) — paginated `SELECT *`, Bearer, `401 → QboAuthError`, `QueryResponse` envelope | identical read-pull shape, `TaxCode`/`TaxRate` entities instead of `Item` |
| Tax-code pull → mapping/upsert core (`src/lib/quickbooks/tax-sync.ts`?) | `src/lib/quickbooks/item-sync.ts` (classify → upsert, executor-injection) + `dealer-sync.ts` | the proven pull→reconcile pattern |
| Province ↔ QBO-tax-code storage | `src/lib/db/schema/tax-rates.ts` (`tax_rates`: `province` `caProvince` unique + `rate` numeric(6,3), 0065) + the `quickbooks_id` partial-unique-index idiom (0071 `service_items`) | extend the existing province tax model with a QBO link rather than a parallel table |
| `mapQuoteToEstimate` → emit `TaxCodeRef` (txn/line) instead of `TotalTax` | `src/lib/quickbooks/quote-push.ts:106-112` (the current `TxnTaxDetail.TotalTax` + `GlobalTaxCalculation: TaxExcluded` block, 0073) | the exact lines being replaced |
| Reconciliation against the app's quote tax | `src/lib/quotes/pricing.ts` (tax computation) + `src/features/tax-rates/queries.ts` `loadTaxRates`/`taxRateForProvince`/`dealerTaxRatePct` (0065) | where quote tax is computed; must equal QBO's computed tax |
| Pull trigger (admin action + button) | `src/features/quickbooks/actions.ts` `pullItemsFromQuickbooks` (0071) + `/admin/quickbooks` page | a sibling admin "Pull tax codes" action if a pull UI is needed |

**Conventions referenced:**
- `docs/wiki/data-model.md` — `tax_rates` (0065), the QBO `quickbooks_id` links (0069–0073), `quotes.tax_pct`/`tax_override`.
- Memory: [[project_prod_db]] (sandbox-first 5432 · prod QBO realm `193514766730959` is Canadian) · [[project_drizzle_journal_when_gotcha]] (verify journal `when` on any schema) · [[feedback_no_yup]] (Zod) · [[project_msa_structure]].
- Evidence: [`../closed/0073-quote-estimate-push/eval-2026-06-10-0911.md`](../closed/0073-quote-estimate-push/eval-2026-06-10-0911.md) addendum (the confirmed tax-dropped smoke).

**Overall Progress:** 0% (0/6 phases complete) — **scaffold only; Phase 1 gate unresolved.**

**Note:** Phases 2–6 are provisional. Phase 1's decision (Canadian sandbox vs defer vs inspect-prod) may restructure them — e.g. if AST ignores supplied tax codes, the approach changes from "set `TaxCodeRef`" to "configure the customer's tax setup," and the schema/mapping phases shift accordingly.

### Phase Checklist

#### Phase 1: Research/decide — Canadian-sandbox blocker + tax-code shape (GATE) — research, no code
- [x] ~~Resolve the Canadian-vs-US blocker~~ — **DECIDED: path (a)** (2026-06-10). Owner created a **Canadian QBO sandbox, Company ID `9341457252668239`** (vs the US sample sandbox `9341457209207248`; prod Canadian `193514766730959`). Build+verify against the CA sandbox.
- [ ] **Connect the app to the CA sandbox** — `/admin/quickbooks` → Disconnect (US `…209207248`) → Connect → pick Company ID `…252668239` (owner does the OAuth). ⚠️ **Reconnecting changes the realm → existing dealer/item `quickbooks_id` links (US company ids) go STALE.** Fine for tax-code research; before a full CA Estimate smoke, re-sync dealers + re-pull items from the CA company.
- [ ] Inspect the CA company's tax model (read-only): list its `TaxCode`/`TaxRate` (GST/HST/PST per province), AST on/off, the customer default tax code / exempt flag. This answers the design Qs below.
- [ ] Determine the prod (Canadian) QBO company's tax model: **Automated Sales Tax on/off?** manual tax codes? the customer-level default tax code / exempt flag?
- [ ] Determine which `TaxCodeRef` QBO honors for Canadian GST/HST: **txn-level** (`TxnTaxDetail.TxnTaxCodeRef`) vs **line-level** (`SalesItemLineDetail.TaxCodeRef`).
- [ ] Decide rate reconciliation: **QBO rate as source of truth** (pull → drive quote tax) vs **validate the 0065 province rate matches**.
- [ ] Decide `tax_override` handling when QBO computes tax (keep the `TotalTax` path for tax-exempt/manual edge cases?).
- [ ] Write `decision.md`; **rewrite Phases 2–6** to match the chosen path before building.

#### Phase 2: `client.ts` tax-entity reads (provisional)
- [ ] `QboTaxCode` (+ `QboTaxRate`) types; `fetchTaxCodes` / `fetchTaxRates` (paginated `SELECT * FROM TaxCode|TaxRate`, Bearer, 401→`QboAuthError`) mirroring `fetchItems`.
- [ ] Unit-test request shaping (URL/entity, Bearer, 401) with `fetch` mocked.

#### Phase 3: Mapping + storage (provisional)
- [ ] Province ↔ QBO `TaxCode` link (extend `tax_rates` with a `quickbooks_tax_code_id` + the pulled rate, or a small mapping table — decided in Phase 1). Migration via `db-conventions`, sandbox-first, **verify journal `when`**.
- [ ] Pull → upsert core (`tax-sync.ts`?) with executor-injection; admin "Pull tax codes" action + button if a pull UI is warranted.

#### Phase 4: Wire the Estimate push (provisional)
- [ ] Replace `mapQuoteToEstimate`'s `TxnTaxDetail.TotalTax`/`GlobalTaxCalculation: TaxExcluded` block with the resolved `TaxCodeRef` (txn/line per Phase 1).
- [ ] Pre-flight: a quote whose province has no mapped QBO tax code fails *closed* with a clear message (mirror 0073's readiness check). Handle `tax_override` per Phase 1.

#### Phase 5: Reconciliation (provisional)
- [ ] Ensure the app's quote tax and QBO's computed tax use the **same rate** so the Estimate total equals the quote total (adopt or validate per Phase 1).
- [ ] Unit tests over the reconciliation (rate parity, total parity).

#### Phase 6: Tests + Canadian smoke + wiki (provisional)
- [ ] Integration tests (QBO calls mocked) for the tax-code pull + the push's `TaxCodeRef` mapping.
- [ ] **Live smoke against a Canadian QBO company** (per Phase 1): push a quote → Estimate, confirm the QBO **tax line is non-zero and equals the quote tax**, and the **total matches**. (A US-sandbox pass is necessary but not sufficient — see the blocker.) Fixture: extend `scripts/0073-quote-push-smoke.ts`.
- [ ] Ingest the tax-code link + the corrected Estimate-tax behavior into `docs/wiki/data-model.md` + `docs/wiki/log.md`; update the 0073 "tax omitted" caveat to "resolved".
