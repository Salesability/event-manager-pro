# QuickBooks Tax-Code Mapping (QB-derived tax lookup) — Plan

**Intent:** [`intent.md`](intent.md)
**Started:** 2026-06-11 (scaffolded — phases not yet started)

## Progress Tracker

| Phase | Status | Commit |
|-------|--------|--------|
| 1: Row-model decision + any schema (db-conventions) — GATE | Done | - |
| 2: QBO-codes loader + per-province mapping view-model (suggestion via demoted matcher) | Done | - |
| 3: `/admin/lookups` mapping UI (province → code dropdown, "managed by QB" badge, Add province) | Pending | - |
| 4: Server actions — `assignProvinceTaxCode` + `refreshTaxRates`; retire heuristic; gate-matrix | Pending | - |
| 5: Unmapped-province quote guard (+ optional QC per-line PDF breakdown) | Pending | - |
| 6: Tests + smoke + group-code (QC/BC) Estimate-push verification + wiki | Pending | - |

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
- Precedent: [`../closed/0075-quickbooks-tax-rate-source/decision.md`](../closed/0075-quickbooks-tax-rate-source/decision.md) (the matcher being demoted) · [`../closed/0074-quickbooks-tax-alignment/decision.md`](../closed/0074-quickbooks-tax-alignment/decision.md) (per-line `TaxCodeRef`).

**Overall Progress:** 33% (2/6 phases complete) — **Phase 1 gate + Phase 2 mapping view-model shipped 2026-06-11. See [`decision.md`](decision.md).**

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

#### Phase 3: `/admin/lookups` mapping UI
- [ ] `tax-rate-mapping.tsx`: per-province row — label · app rate · QB-code `<select>` (live codes; suggestion pre-selected) · "managed by QuickBooks" badge when mapped · "unmanaged" when not.
- [ ] "Add province" affordance (map a not-yet-mapped province to an available code). Connection-dependent: disconnected → read-only rates + mappings + "connect QuickBooks to change mappings" hint.
- [ ] Render on `admin/lookups/page.tsx` (re-add the section 0075 removed; update the page description).
- [ ] Smoke (web-test): `goto /admin/lookups`; "Sales Tax Rates" section renders with per-province code `<select>` + "managed by QuickBooks" badges.

#### Phase 4: Mapping + refresh Server Actions; retire heuristic
- [ ] `assignProvinceTaxCode` (Zod: province + taxCodeId): explicit override → set `quickbooks_tax_code_id` + adopt the code's summed rate. `lookup:edit`, `safeParse`.
- [ ] `refreshTaxRates`: re-sync rates of already-linked provinces only (rate-only `planTaxRateWrites`); never re-maps; flag (don't clear) a broken linked code. `lookup:edit`.
- [ ] Retire the auto-apply "Pull tax codes" button on `/admin/quickbooks` (remove or repurpose to `refreshTaxRates`); demote `resolveProvinceLinksByName` to suggestion-only (no auto-apply caller).
- [ ] Add gate-matrix rows for the new actions; integration test (rolled-back tx): assign adopts a group code's rate; refresh updates rate only.

#### Phase 5: Unmapped-province quote guard
- [ ] At quote save/push, a dealer in a province with no mapping → flag/block ("province not set up for tax — add it in QB + map it"), not a silent $0; align with `quote-push.ts` pre-flight.
- [ ] Unit/integration test for the guard.
- [ ] (Optional) Quote PDF: GST + QST as two lines for QC (group code) instead of one combined Tax line — mark optional/owner-driven.

#### Phase 6: Tests + smoke + group-code push verification + wiki
- [ ] Unit + integration green; gate-matrix updated.
- [ ] Smoke (web-test): mapping UI on `/admin/lookups`; "Pull tax codes" gone from `/admin/quickbooks`.
- [ ] **Live verification:** after Quebec (or a BC GST+PST) code is set up in QB, push a quote for that province → Estimate and confirm QBO computes **both** tax components (0074 only live-tested single-rate ON). Capture the Estimate breakdown.
- [ ] Ingest into `docs/wiki/data-model.md` (`tax_rates` now QB-mapped via `/admin/lookups`; group codes; managed-inference) + `docs/wiki/log.md`; note the retired heuristic + the unmapped-province guard.
