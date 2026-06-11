# QuickBooks Tax-Code Mapping (QB-derived tax lookup) — Plan

**Intent:** [`intent.md`](intent.md)
**Started:** 2026-06-11 (scaffolded — phases not yet started)

## Progress Tracker

| Phase | Status | Commit |
|-------|--------|--------|
| 1: Row-model decision + any schema (db-conventions) — GATE | Done | - |
| 2: QBO-codes loader + per-province mapping view-model (suggestion via demoted matcher) | Done | - |
| 3: `/admin/lookups` mapping UI + `assignProvinceTaxCode` action (+ gate-matrix) | Done | - |
| 4: `refreshTaxRates` action + retire the heuristic "Pull tax codes" button (+ gate-matrix) | Done | - |
| 5: Unmapped-province quote guard (message corrected; silent-$0 moot per keep-rows) | Done | - |
| 6: Tests + smoke + group-code (QC/BC) Estimate-push verification + wiki | Done | - |

Replace 0075's fragile auto-apply name heuristic with an **explicit, in-app province → QB-tax-code mapping** on `/admin/lookups` (single + group codes; rate adopted from QB via the group-aware `resolveCodeRatePct`), retire the "Pull tax codes" button, add a "Refresh rates" sync that never re-maps, and guard quotes in unmapped provinces. "Done" = a province can be mapped to its QB code (incl. QC's GST+QST group) from the UI, rates adopt correctly, the heuristic is suggestion-only, unmapped provinces are flagged not silently $0, a group-code Estimate push computes both components live, and chunk-end `/eval` PASS. **Phase 1 is a decision gate** (row model: keep seeded-13 vs QB-derived) — Phases 2–6 firm up once it lands.

## Code Anchors

| New code | Anchor (`path:line`) | Why this anchor |
|----------|---------------------|-----------------|
| Tax-mapping section component `src/features/tax-rates/tax-rate-mapping.tsx` | `src/features/schedule/lookup-admin.tsx` (per-row lookup editor with controls + server-action call) | same layer/shape: an `/admin/lookups` editor with per-row control calling a Server Action |
| `assignProvinceTaxCode` + `refreshTaxRates` Server Actions in (recreated) `src/features/tax-rates/actions.ts` | `src/features/schedule/actions.ts:556` `updateCampaignStyle` (`capabilityClient('lookup:edit')` + `safeParse`) · `src/features/quickbooks/actions.ts:149` `pullTaxCodesFromQuickbooks` (QBO fetch + `db.transaction`) | reuse the gated-action + QBO-fetch+tx shapes; `lookup:edit` capability already exists |
| QBO-codes loader + mapping view-model + per-province suggestion `src/features/tax-rates/mapping.ts` (or extend `queries.ts`) | `src/lib/quickbooks/tax-sync.ts:54` `resolveProvinceLinksByName` / `:26` `resolveCodeRatePct` (reuse as suggester; group-aware) · `src/lib/quickbooks/client.ts:548` `fetchTaxCodes` / `:584` `fetchTaxRates` | demote the matcher to a *suggestion*; fetch codes for the dropdown; `resolveCodeRatePct` already sums group components |
| Split `applyTaxCodeSync` → explicit assign + rate-only refresh | `src/lib/quickbooks/tax-sync.ts:151` `applyTaxCodeSync` / `:104` `planTaxRateWrites` | extend the existing resolve→plan→execute split; "refresh" = rate-only writes for already-linked provinces |
| Lookups page wire (re-add the section 0075 removed) | `src/app/(app)/admin/lookups/page.tsx:8` `LookupsPage` | the page to render the mapping section on; mirror how 0072 restored a read-only list |
| Retire the auto-apply "Pull tax codes" button | `src/features/quickbooks/quickbooks-admin.tsx:301` "Tax rates" section + `src/features/quickbooks/actions.ts:149` `pullTaxCodesFromQuickbooks` | remove/repurpose the heuristic auto-apply; mapping moves to `/admin/lookups` |
| Optional `tax_rates` schema/seed change (row model) | `src/lib/db/schema/tax-rates.ts` + the `db-conventions` skill | same migration shape **only if** Phase 1 picks a column/seed change (leaning: none) |
| Unmapped-province quote guard | `src/lib/quickbooks/quote-push.ts` (0074 pre-flight) · `src/features/tax-rates/queries.ts` `dealerTaxRatePct` + its callers in `src/features/quotes/actions.ts` | dovetail with the existing push pre-flight + the quote tax-computation path |
| Gate-matrix rows for the new actions | `src/features/__tests__/action-gate-matrix.ts:213` (the slot 0075 vacated) | every gated Server Action needs a matrix row (the source-scan suite enforces it) |
| Editor-shape reference (partially restoring what 0075 deleted) | `docs/chunks/closed/0075-quickbooks-tax-rate-source/` (deleted `tax-rates/actions.ts` + `tax-rates-admin.tsx`) | the editor we're reviving as a *mapping* surface; mirror its structure, not its free-rate-edit |

**Conventions referenced:**
- `docs/wiki/data-model.md` — `tax_rates` (`quickbooks_tax_code_id`, managed-inference), `quotes` tax model + the Estimate push.
- `db-conventions` skill — any schema/migration/seed change (sandbox-first; verify journal `when`).
- Memory: [[project_qbo_realms]] (prod realm `193514766730959`) · [[feedback_no_yup]] (Zod) · [[project_prod_db]].
- Precedent: [`../0075-quickbooks-tax-rate-source/decision.md`](../0075-quickbooks-tax-rate-source/decision.md) (the matcher being demoted) · [`../0074-quickbooks-tax-alignment/decision.md`](../0074-quickbooks-tax-alignment/decision.md) (per-line `TaxCodeRef`).

**Overall Progress:** 100% (6/6 phases complete) — **all phases shipped 2026-06-11 (live group-code QC push deferred to owner/prod). Chunk-end `/eval` next. See [`decision.md`](decision.md).**

**Note:**
- **Phase 1 is a decision gate** — the row model (keep the 13 seeded rows vs QB-derived rows) shapes Phases 2–6; resolve it (write `decision.md`) before building. Leaning: keep rows, drive "usable" off the mapping + the unmapped-province guard, **no migration**.
- **Group codes are first-class:** `resolveCodeRatePct` already sums multi-component codes (QC GST+QST, BC GST+PST) — the UI/loader must list and adopt them, not just single codes.
- The interim `scripts/0075-tax-map.mjs` override stays usable until Phase 3/4 ship the UI.
- The group-code Estimate-push verification (Phase 6) needs the owner to set up Quebec (or a GST+PST province) in QB first.

### Phase Checklist

#### Phase 1: Row-model decision + any schema (GATE)
- [x] **Decided (owner-locked 2026-06-11):** keep the 13 seeded `tax_rates` rows; **managed ⇔ `quickbooks_tax_code_id IS NOT NULL`**; quote path unchanged; unmapped provinces keep their seeded rate + are guarded at quote time. The "QB-derived lookup" is a presentation layer (managed vs unmanaged), not a physical row model. See [`decision.md`](decision.md).
- [x] **No schema/seed change** → no `db-conventions` work (managed is inferred; no new column/migration).
- [x] Wrote `decision.md`; Phases 2–6 already match (UI presents managed/unmanaged; actions set/clear the code; guard keys off `quickbooks_tax_code_id IS NULL`).

#### Phase 2: QBO-codes loader + mapping view-model
- [x] `src/features/tax-rates/mapping.ts` (server; client imports types only): `buildTaxCodeOptions(qboCodes, qboRates)` → `TaxCodeOption[]` (every active code + its summed group-aware rate via `resolveCodeRatePct`, `"name — rate%"` label, n/a when unresolvable). `loadTaxRatesForMapping()` added to `queries.ts` (rows incl. `quickbooks_tax_code_id`). *(The live QB fetch loader lands in Phase 3 with the page.)*
- [x] `buildProvinceMappingRows(appRows, qboCodes, qboRates)` → `ProvinceMappingRow[]`: managed flag, current code name/rate, **drift** (linked code rate ≠ app rate), **brokenLink** (mapped id absent from live set), and a **suggestion** (demoted `resolveProvinceLinksByName` — pre-select only, never auto-applied).
- [x] Unit tests (`mapping.test.ts`, +6): group-code summing (BC 5+7=12) surfaces; unresolvable → n/a; inactive dropped; managed/unmanaged; drift; broken link; suggestion pre-select.

#### Phase 3: `/admin/lookups` mapping UI + `assignProvinceTaxCode`
- [x] `tax-rate-mapping.tsx`: per-province row — label · app rate · QB-code `<select>` (live codes; the name-match **suggestion** annotated "(suggested)" on an unmanaged province, not auto-applied) · status badge (managed / unmanaged / ⚠ drift / ⚠ broken-link). On select → `assignProvinceTaxCode` via transition + toast + refresh. Disconnected → read-only list + "connect QuickBooks to change mappings" hint.
- [x] ~~"Add province" affordance~~ — collapsed into the table: with all 13 seeded rows shown (per the Phase-1 decision), "adding a province to QB" = picking a code for an **unmanaged** row (no separate INSERT/button).
- [x] `assignProvinceTaxCode` Server Action (`actions.ts` recreated; `lookup:edit`, `safeParse`): empty `taxCodeId` unmaps (clears link, keeps rate); a set id is **re-validated against the live company** + the code's group-aware rate adopted into `tax_rates.rate`. Gate-matrix row re-added (`taxRatesActions` import restored). `loadTaxMappingAdmin` loader (connected → view-model + options; disconnected/QBO-error → read-only).
- [x] Render on `admin/lookups/page.tsx` (re-added the section + refreshed the page description). *(Smoke deferred to the chunk-end `/eval`.)*

#### Phase 4: `refreshTaxRates` action + retire the heuristic
- [x] Pure `planRateRefresh(appRows, qboCodes, qboRates)` (in `mapping.ts`) — rate-only writes for mapped provinces whose linked code rate changed; **never** touches a code link; reports a missing linked code as `broken` (leaves it). `refreshTaxRates` action (`lookup:edit`) executes the writes in a tx; gate-matrix row added. "Refresh rates" button added to the mapping UI (toast: "Refreshed N rates · M broken links").
- [x] Retired the auto-apply heuristic: removed `pullTaxCodesFromQuickbooks` (+ its `fetchTaxCodes`/`fetchTaxRates`/`applyTaxCodeSync`/`encodeTaxSyncSummary` imports), its gate-matrix row, the QB-admin "Tax rates" section + `Pull tax codes` button, and the `taxsynced` flash + `decodeTaxSyncSummary` import. The name matcher (`resolveProvinceLinksByName`) survives **as a suggestion only** (no auto-apply caller). *(`applyTaxCodeSync`/encode-decode remain in `tax-sync.ts` — still unit + integration tested; unwired in prod.)*
- [x] Unit tests for `planRateRefresh` (`mapping.test.ts`, +4): changed-rate write, aligned no-op, unmapped ignored, broken link reported (never cleared), group-code rate-only write. *(Full action integration test deferred — the existing `tests/integration/tax-sync.test.ts` still exercises the DB write path; the assign/refresh actions need live QBO + auth, covered by the chunk-end smoke.)*

#### Phase 5: Unmapped-province quote guard
- [x] **Silent-$0 is moot under the keep-rows decision** — every province always has a seeded `tax_rates.rate`, so `dealerTaxRatePct` never returns a surprise $0 for an unmapped province (it uses the seeded/fallback rate). The real guard is at PUSH time and **pre-existed (0074)**: `checkQuotePushReadiness` already blocks a taxed quote whose province has no `quickbooks_tax_code_id`. Updated its now-stale message ("run Pull tax codes first" → "map it under Sales Tax Rates on the Lookup Admin page first") since 0076 retired the pull. Updated the asserting unit test.
- [x] ~~Quote PDF: GST + QST two-line breakdown for QC~~ — **deferred** (optional/owner-driven; the single combined Tax line is correct to the cent; the dual GST/QST split happens authoritatively in QuickBooks at invoice time).

#### Phase 6: Tests + smoke + group-code push verification + wiki
- [x] Unit + integration green throughout (1109 serial); gate-matrix updated (+`assignProvinceTaxCode`/`refreshTaxRates`, −`pullTaxCodesFromQuickbooks`).
- [x] Smoke (web-test) — **delegated to the chunk-end `/eval`**: mapping UI renders on `/admin/lookups`; "Pull tax codes" gone from `/admin/quickbooks`.
- [ ] ⏳ **Live group-code push verification DEFERRED** — needs Quebec (or a BC GST+PST) tax set up in the prod QB company first (an owner/bookkeeper task). Until then 0074's single-rate ON push is the only live-verified path. **Un-defer:** once QC is added in QB → push a QC quote → Estimate and confirm both GST+QST components.
- [x] Ingested into `docs/wiki/data-model.md` (`tax_rates` now mapped on `/admin/lookups`; group codes; managed-inference; retired heuristic; unmapped guard) + a new `docs/wiki/log.md` entry.
