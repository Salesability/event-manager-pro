# QuickBooks as Tax-Rate Source of Truth — Plan

**Intent:** [`intent.md`](intent.md)
**Started:** 2026-06-10 (scaffolded — **Phase 1 is a research/decision gate (jurisdiction-matching strategy); do not build implementation phases until it's resolved**)

## Progress Tracker

| Phase | Status | Commit |
|-------|--------|--------|
| 1: Research/decide — jurisdiction-matching strategy + open questions (GATE) | Done | - |
| 2: Name-heuristic matcher (replaces the rate matcher) — pure, no migration | Done | - |
| 3: `applyTaxCodeSync` adopts QB's rate into `tax_rates.rate` (pure write-planner + execute) | Done | - |
| 4: Remove the in-app tax-rate editor entirely (QB-managed) | Done | - |
| 5: Smoke (ON adoption) + wiki ingest | Done | - |

Make **QuickBooks the source of truth for tax rates** (owner decision 2026-06-10). Extends [0074](../closed/0074-quickbooks-tax-alignment/plan.md): pull QB's rate per province and **adopt it into `tax_rates.rate`**, matching by **jurisdiction** (not rate), and make the in-app rate editor **read-only** (QB-managed) — the tax-rate analogue of 0071 making QB the item master. "Done" = ON's rate is QB-sourced on the CA sandbox, the editor is read-only, unmapped provinces keep a flagged fallback, chunk-end `/eval` PASS. **Phase 1 gate:** the jurisdiction-matching strategy (manual mapping vs name heuristic vs hybrid) is an owner decision; Phases 2–5 are provisional until it lands. **Blocker:** the CA sandbox only has Ontario — multi-province alignment is verified on prod (or a fuller sandbox).

## Code Anchors

| New / changed code | Anchor (`path:line`) | Why this anchor |
|--------------------|---------------------|-----------------|
| `codeNamesProvince` + `resolveProvinceLinksByName` (replace `matchProvinceTaxCode` / `resolveProvinceLinks`) in `src/lib/quickbooks/tax-sync.ts` | `tax-sync.ts:44` `matchProvinceTaxCode` / `:70` `resolveProvinceLinks` (0074, rate-based) | the rate matcher being replaced — name-token/full-name match keyed on jurisdiction, not rate |
| `planTaxRateWrites` (pure) + `applyTaxCodeSync` writes `tax_rates.rate` (not just the code id) | `tax-sync.ts:102` `applyTaxCodeSync` (0074) | split the executor: pure write-planner (testable, no DB) + thin execute; adopt QB's rate on `linked` |
| QB rate per code (reused) | `client.ts:25` `resolveCodeRatePct` lives in `tax-sync.ts:25`; `client.ts:584` `fetchTaxRates` | already resolve a code's summed sales rate → the rate to adopt; **keep** |
| Flash + section copy (matching→adoption) | `src/app/(app)/admin/quickbooks/page.tsx:68` flash; `src/features/quickbooks/quickbooks-admin.tsx:301` "Tax codes" section | copy says "map by rate" → update to "adopt rate, match by name" |
| **No** `tax_rates` schema change | `src/lib/db/schema/tax-rates.ts` | decision: infer "managed" from `quickbooks_tax_code_id IS NOT NULL` — **no new column, no migration** |
| Remove the tax-rate editor entirely | `src/features/tax-rates/{actions.ts (`updateTaxRate`), tax-rates-admin.tsx, tax-rate-schema.ts, tax-rate-schema.test.ts}` + render at `src/app/(app)/admin/lookups/page.tsx:5,30` + gate-matrix row `src/features/__tests__/action-gate-matrix.ts:18,214` | delete (mirror 0071's CRUD removal); **keep `queries.ts`** (`loadTaxRates`/`dealerTaxRatePct`/`taxRateForProvince` — quote-composer + quote-actions path) |
| The "QB is master → remove in-app editing" precedent | `docs/chunks/closed/0071-quickbooks-item-pull/` (removed `services/actions.ts` + `services-admin.tsx` + lookups editor + 3 gate-matrix rows) | mirror its removal approach + gate-matrix update; `lookup:edit` capability STAYS (schedule lookups still use it) |
| Per-province override UI — **DEFERRED** (decision 3) | — | not built this chunk; ambiguous/unmatched provinces are flagged + stay app-managed |

**Conventions referenced:**
- `docs/wiki/data-model.md` — `tax_rates` (0065 + the 0074 `quickbooks_tax_code_id`), the QBO links.
- Memory: [[project_qbo_realms]] (CA sandbox `9341457252668239`, ON-only) · [[project_drizzle_journal_when_gotcha]] · [[project_prod_db]] (sandbox-first 5432) · [[feedback_no_yup]] (Zod).
- Precedent: [`../closed/0071-quickbooks-item-pull/plan.md`](../closed/0071-quickbooks-item-pull/plan.md) (QB-as-master + editor removal) · [`../closed/0074-quickbooks-tax-alignment/decision.md`](../closed/0074-quickbooks-tax-alignment/decision.md) (the rate-matcher being replaced).

**Overall Progress:** 100% (5/5 phases complete) — **all phases shipped 2026-06-10: gate + name-matcher + rate adoption (ON live-verified) + editor removal + wiki ingest. Chunk-end `/eval` pending. See [`decision.md`](decision.md).**

**Note:** Matching = **name heuristic** (auto, no manual map). Editor **removed entirely** (not read-only). Per-province override **deferred**. **No migration** (managed = `quickbooks_tax_code_id IS NOT NULL`). Unmatched/ambiguous provinces keep their app rate, flagged unmanaged.

### Phase Checklist

#### Phase 1: Research/decide — jurisdiction-matching strategy (GATE) — research, no code
- [x] **Probed the bridge problem (2026-06-10):** QB tax codes have **no province field**, and the CA customers have **no `DefaultTaxCodeRef`** (so we can't source a dealer's code from QB's customer record) — but customers **do** carry a province (`BillAddr.CountrySubDivisionCode`). → A pure "delete + mirror QB, no province" model is **not** possible (nothing links a code to who pays it); the province stays the key.
- [x] **Matching strategy → NAME HEURISTIC (auto), not manual mapping** (owner steer 2026-06-10 — "don't map, just sync"): match each province to a QB code whose **name** encodes the jurisdiction ("HST ON" → ON) on every pull; adopt QB's rate. No manual mapping table/UI. **Caveat:** clean for HST provinces (single "HST XX" code — all the CA sandbox has); **fragile for GST+PST/QST** (BC/QC use multiple/grouped codes) → auto-match the confident ones, **flag the ambiguous/unmatched** for a one-off per-province override (the only manual touch, and only for the tricky provinces).
- [x] **Finalized (owner, 2026-06-10):** unmatched/ambiguous → **keep app rate + unmanaged flag** (not block); editor **removed entirely** (not read-only); **infer** "managed" from `quickbooks_tax_code_id` (no new column → no migration); **keep** the 0074 rate-drift guard; per-province override **deferred**. See [`decision.md`](decision.md).
- [x] **Wrote `decision.md`; rewrote Phases 2–5** (name-matcher + pure write-planner rate adoption + editor removal + deferred override).

#### Phase 2: Name-heuristic matcher (replaces the rate matcher) — pure, no migration
- [x] In `tax-sync.ts`, added `codeNamesProvince(name, province)` — true when the code name carries the jurisdiction: the 2-letter province code as a **word token** (`\bON\b`) or the full province name (`CA_PROVINCE_NAMES`), case-insensitive. Federal-only names ("GST", "Exempt") match nothing.
- [x] Added `resolveProvinceLinksByName(appRates, qboCodes, rateById)` → `{ province, taxCodeId, ratePct, status }[]` (new `ProvinceTaxLink` type). Confident 1:1 (one active, rate-resolvable code names the province) → `linked` w/ `ratePct`; zero → `unmatched`; >1 → `ambiguous`. **Kept** `resolveCodeRatePct`. *(Old rate-matcher `matchProvinceTaxCode`/`resolveProvinceLinks` kept alive this phase — still wired into `applyTaxCodeSync`; deleted in Phase 3 when the executor swaps over, keeping tsc green per phase.)*
- [x] Unit tests (`tax-sync.test.ts`, +8): name token match (HST ON → ON, ratePct 13), full-name match (Ontario/Quebec), federal-only/substring → no match (GST/Exempt/Non-taxable/shared HST), ambiguous (two codes name ON), unresolvable-rate code filtered → unmatched, inactive ignored.

#### Phase 3: Adopt QB rate — pure write-planner + execute
- [x] Added pure `planTaxRateWrites(appRows, links)` → minimal `{ id, quickbooksTaxCodeId, rate? }[]`: `linked` adopts QB's rate (`ratePct.toFixed(3)`) + sets the code id; unmanaged clears a stale code id only (keeps the app rate — `rate` omitted, column is NOT NULL); no-ops omitted.
- [x] Rewired `applyTaxCodeSync` to resolve (`resolveProvinceLinksByName`) → plan → execute; deleted the old rate-matcher (`matchProvinceTaxCode`/`resolveProvinceLinks`/types) + its unit tests; updated the module header + the `pullTaxCodesFromQuickbooks` action comment. Updated the `/admin/quickbooks` flash ("Adopted province tax rates … managed/unmatched/ambiguous") + the QB-admin section ("Tax rates", adopt **from** QB, matched **by name**). `TaxCodeSyncResult` shape unchanged (`linked` now = managed + rate adopted).
- [x] Unit tests for `planTaxRateWrites` (5): adopts rate+code (`"13.000"`), code-only when rate aligned, no-op when already in state, unmanaged clears code + keeps rate, already-unmanaged untouched. **Integration test rewritten** (`tests/integration/tax-sync.test.ts`) — forces ON→11.000, syncs "HST ON", asserts ON adopts **13.000** + code `5`; BC stale link cleared, BC rate kept. **Live-verified on the CA sandbox** (DB integration ran + passed in the serial suite).

#### Phase 4: Remove the in-app tax-rate editor entirely
- [x] Deleted `tax-rates/{actions.ts, tax-rates-admin.tsx, tax-rate-schema.ts, tax-rate-schema.test.ts}`. **Kept** `tax-rates/queries.ts` (quote-composer `quotes/new`+`quotes/[id]` read `loadTaxRates`; quote actions read `dealerTaxRatePct`).
- [x] Removed `TaxRatesAdmin` import + render + `loadTaxRates` import from `admin/lookups/page.tsx` (description now says service items **and** tax rates are QB-mastered); dropped the `updateTaxRate` row + `taxRatesActions` import from `action-gate-matrix.ts` (source-scan assertion stays consistent — action + row both gone). `lookup:edit` capability STAYS (schedule lookups use it). tsc clean, gate-matrix 295/295.

#### Phase 5: Smoke + wiki ingest
- [x] `tsc` clean + `pnpm test` green serially (1089 passed / 2 skipped, 72 files); gate-matrix 295/295.
- [x] Smoke delegated to the chunk-end `/eval` (web-test): `/admin/lookups` no longer shows a tax-rate editor; `/admin/quickbooks` "Tax rates" section + "Pull tax codes" present, copy reflects rate adoption by name. Live ON-rate adoption already verified by the DB integration test (CA sandbox); multi-province deferred — blocker.
- [x] Ingested into `docs/wiki/data-model.md` (`tax_rates.rate` now QB-sourced; editor removed; managed = `quickbooks_tax_code_id IS NOT NULL`) + a new `docs/wiki/log.md` entry; noted the deferred override + the prod multi-province dependency.
