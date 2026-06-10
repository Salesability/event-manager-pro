# QuickBooks Tax Alignment — Plan

**Intent:** [`intent.md`](intent.md)
**Started:** 2026-06-10 (scaffolded — **Phase 1 is a research/decision gate; do not build implementation phases until the Canadian-sandbox blocker is resolved**)

## Progress Tracker

| Phase | Status | Commit |
|-------|--------|--------|
| 1: Research/decide — Canadian-sandbox blocker + AST/tax-code shape (GATE) | Done | (research — [decision.md](decision.md)) |
| 2: `client.ts` — `fetchTaxCodes` / `fetchTaxRates` (+ types) | Done | `3bb47b4` |
| 3: Tax-code mapping + storage (province ↔ QBO `TaxCode`, pulled rate) | Done | `4ae5708` |
| 4: Wire `mapQuoteToEstimate` — set `TaxCodeRef`, drop the `TotalTax` override | Done | `19e0c5f` |
| 5: Reconcile rate so Estimate total == quote total | Done | `fac9d26` |
| 6: Tests + Canadian smoke + wiki | Done | `9507372` |

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
- Evidence: [`../0073-quote-estimate-push/eval-2026-06-10-0911.md`](../0073-quote-estimate-push/eval-2026-06-10-0911.md) addendum (the confirmed tax-dropped smoke).

**Overall Progress:** 100% (6/6 phases complete) — code + tests + wiki shipped. **Live CA Estimate-with-tax smoke is user-gated (deferred);** prod needs the prod `TaxPrefs`/AST check ([decision.md](decision.md) residual).

**Note:** Phase 1 settled the approach (manual sales tax → set **txn-level** `TxnTaxDetail.TxnTaxCodeRef`, mapped province→`TaxCode.Id`; the AST-would-have-broken-it risk is retired *for the sandbox*). Phase-checklist summaries below reflect the decided shape. Residual to confirm before prod: the **prod** company's `TaxPrefs` (if AST, revisit Phase 4).

### Phase Checklist

#### Phase 1: Research/decide — Canadian-sandbox blocker + tax-code shape (GATE) — research, no code
- [x] ~~Resolve the Canadian-vs-US blocker~~ — **DECIDED: path (a)** (2026-06-10). Owner created a **Canadian QBO sandbox, Company ID `9341457252668239`** (vs the US sample sandbox `9341457209207248`; prod Canadian `193514766730959`). Build+verify against the CA sandbox.
- [x] **Connected the app to the CA sandbox** (owner did the OAuth 2026-06-10; `quickbooks_connection.realm_id` now `9341457252668239`). ⚠️ Existing dealer/item `quickbooks_id` links are now **STALE** (hold the US company's entity ids) — fine for tax-code research; before a CA Estimate smoke (Phase 6) re-sync dealers + re-pull items against the CA company.
- [x] Inspect the CA company's tax model (read-only `scripts/0074-tax-probe.mjs`) → **[decision.md](decision.md)**. Findings: **manual sales tax, NOT AST** (`TaxPrefs = {UsingSalesTax:true}`, no `PartnerTaxEnabled`) → QBO honors a supplied tax code; **txn-level** `TxnTaxDetail.TxnTaxCodeRef` is the unit; the taxable code is **"HST ON" #5 = 13%** (sandbox is an Ontario company — only HST ON configured); QBO HST ON 13% matches the app's ON rate.
- [x] Design Qs answered (see [decision.md](decision.md)): (1) manual not AST; (2) txn-level `TxnTaxCodeRef`; (3) pull `TaxCode` (Id = ref, rate from its `SalesTaxRateList`); (4) map province→`TaxCode.Id`, fail-closed when none; (5) validate app-rate↔QBO-rate parity; (6) `tax_override` → flag/skip for v1. **Residual: verify prod's `TaxPrefs` (AST?) before prod.**
- [x] ~~Determine the **prod** company's tax model~~ — **DEFERRED residual** (can't probe prod — gated; verify `TaxPrefs` at prod cutover, decision.md #1).
- [x] ~~txn vs line `TaxCodeRef`~~ → **txn-level** (decision.md #2).
- [x] ~~rate reconciliation~~ → **validate parity** app↔QBO (decision.md #5).
- [x] ~~`tax_override` handling~~ → **flag/skip for v1** (decision.md #6).
- [x] Wrote [`decision.md`](decision.md); phase summaries below reflect the decided shape.

#### Phase 2: `client.ts` tax-entity reads
- [x] `QboTaxCode` / `QboTaxRate` / `QboTaxRateDetail` types; `fetchTaxCodes` / `fetchTaxRates` (paginated `SELECT * FROM TaxCode|TaxRate`, Bearer, 401→`QboAuthError`) mirroring `fetchItems`.
- [x] Unit-tested request shaping (query text, URL, Bearer, returns the list, 401→`QboAuthError`) with `fetch` mocked — 3 cases in `client.test.ts`.

#### Phase 3: Mapping + storage
- [x] Added `tax_rates.quickbooks_tax_code_id` (nullable text), migration `0035_nebulous_sumo` (sandbox-applied; journal `when` ascends 0035 > 0034). Same db-conventions idiom as 0073/0071.
- [x] `tax-sync.ts`: `resolveCodeRatePct` (sum a code's referenced `TaxRate`s) + `matchProvinceTaxCode` (unambiguous rate-match, pure) + `applyTaxCodeSync` (executor-injected; sets each province's link or null, clears stale) + `encode/decodeTaxSyncSummary`. **Match strategy: by summed rate, unambiguous-only** — rate-collision provinces (e.g. the 15% HST group) won't auto-link (→ manual-mapping follow-up). 10 matcher unit tests.
- [x] Admin action `pullTaxCodesFromQuickbooks` (admin-gated, `fetchTaxCodes`+`fetchTaxRates` → `db.transaction(applyTaxCodeSync)` → `?taxsynced=` flash) + gate-matrix row + "Pull tax codes" button on `/admin/quickbooks` + the flash decode.

#### Phase 4: Wire the Estimate push
- [x] `mapQuoteToEstimate` now emits `TxnTaxDetail.TxnTaxCodeRef = { value: quote.taxCodeId }` (QBO computes the tax) instead of the dropped `TotalTax`/`TaxExcluded`; omitted when untaxed. `QboEstimate(Input).TxnTaxDetail` type extended with `TxnTaxCodeRef`.
- [x] Pre-flight (`checkQuotePushReadiness(quote, dealer, lines)`): a **manual `tax_override`** fails closed (v1 — can't represent as a code); a **taxed quote with no mapped province code** fails closed ("run Pull tax codes"). `loadQuoteEstimatePushData` now left-joins `tax_rates` on the dealer's province → `taxCodeId` + selects `taxOverride`. 0073 unit + integration tests updated for the new signature/fields.

#### Phase 5: Reconciliation
- [x] Parity is enforced two ways: (1) the matcher links a province→code only on **rate equality** (Phase 3), so the link implies parity; (2) a push-time **rate-drift guard** — `quoteTaxMatchesRate(subtotal, tax, rate)` fails closed when the quote's snapshotted `tax` ≠ `round(subtotal × current province rate)` (catches a rate edit between quote-save and push). Loader now carries `subtotal` + `provinceRatePct` (`tax_rates.rate`).
- [x] Unit tests: `quoteTaxMatchesRate` (match incl. QST rounding; mismatch) + a readiness drift case. (`quote-push.test.ts`)

#### Phase 6: Tests + Canadian smoke + wiki
- [x] Integration tests: `tax-sync.test.ts` (`applyTaxCodeSync` links the 13% province ON → HST ON, leaves others unmatched, clears a stale link — real seeded `tax_rates`, rolled-back tx) + extended the push integration create test to assert `payload.TxnTaxDetail = { TxnTaxCodeRef: { value: '5' } }`.
- [ ] **Live CA smoke — USER-GATED (deferred, like 0073's).** Needs the CA sandbox's dealers re-synced + items re-pulled (stale US links), then **Pull tax codes**, then push an **Ontario** quote → Estimate and confirm the QBO **tax line = 13% and the total matches**. Steps handed to the owner; the chunk-end `/eval` verifies the "Pull tax codes" button renders.
- [x] Ingested into `docs/wiki/data-model.md` (`tax_rates` + the Estimate-push tax behavior) + `docs/wiki/log.md` (2026-06-10) — the override→`TxnTaxCodeRef` switch + the pre-flight guards.
