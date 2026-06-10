# QuickBooks as Tax-Rate Source of Truth — Plan

**Intent:** [`intent.md`](intent.md)
**Started:** 2026-06-10 (scaffolded — **Phase 1 is a research/decision gate (jurisdiction-matching strategy); do not build implementation phases until it's resolved**)

## Progress Tracker

| Phase | Status | Commit |
|-------|--------|--------|
| 1: Research/decide — jurisdiction-matching strategy + open questions (GATE) | Pending | - |
| 2: Jurisdiction matcher (replace the rate matcher) + any mapping storage | Pending | - |
| 3: `applyTaxCodeSync` adopts QB's rate into `tax_rates.rate` | Pending | - |
| 4: Make the tax-rate editor read-only (QB-managed) | Pending | - |
| 5: Tests + smoke (ON alignment) + wiki | Pending | - |

Make **QuickBooks the source of truth for tax rates** (owner decision 2026-06-10). Extends [0074](../closed/0074-quickbooks-tax-alignment/plan.md): pull QB's rate per province and **adopt it into `tax_rates.rate`**, matching by **jurisdiction** (not rate), and make the in-app rate editor **read-only** (QB-managed) — the tax-rate analogue of 0071 making QB the item master. "Done" = ON's rate is QB-sourced on the CA sandbox, the editor is read-only, unmapped provinces keep a flagged fallback, chunk-end `/eval` PASS. **Phase 1 gate:** the jurisdiction-matching strategy (manual mapping vs name heuristic vs hybrid) is an owner decision; Phases 2–5 are provisional until it lands. **Blocker:** the CA sandbox only has Ontario — multi-province alignment is verified on prod (or a fuller sandbox).

## Code Anchors

| New / changed code | Anchor (`path:line`) | Why this anchor |
|--------------------|---------------------|-----------------|
| Jurisdiction matcher (replaces `matchProvinceTaxCode`) in `src/lib/quickbooks/tax-sync.ts` | `tax-sync.ts` `matchProvinceTaxCode` / `resolveProvinceLinks` (0074, rate-based) | the function being rethought — same shape, jurisdiction key instead of rate |
| `applyTaxCodeSync` writes `tax_rates.rate` (not just the code id) | `tax-sync.ts` `applyTaxCodeSync` (0074) | extend the existing executor-injected sync |
| QB rate per code | `client.ts` `fetchTaxRates` + `resolveCodeRatePct` (0074) | already resolve a code's rate; reuse |
| Optional `tax_rates` schema change (`is_qb_managed`/`source`, or none) | `src/lib/db/schema/tax-rates.ts` (`quickbooks_tax_code_id` add, 0074) + the partial-index idiom | same db-conventions migration shape if a column is added |
| Read-only tax-rate editor | `src/features/tax-rates/{actions.ts (`updateTaxRate`, gated `lookup:edit`), tax-rates-admin.tsx, tax-rate-schema.ts}` rendered on `src/app/(app)/admin/lookups/page.tsx` | the editor to disable/remove |
| The "QB is master → remove in-app editing" precedent | `docs/chunks/closed/0071-quickbooks-item-pull/` (removed `services/actions.ts` + `services-admin.tsx` + lookups editor + gate-matrix rows) | mirror its removal/read-only approach + gate-matrix update |
| Manual-mapping UI (if Phase 1 picks (a)) | `src/features/quickbooks/quickbooks-admin.tsx` "Pull items"/"Pull tax codes" sections (0071/0074) | the admin-surface pattern for a per-province code picker |

**Conventions referenced:**
- `docs/wiki/data-model.md` — `tax_rates` (0065 + the 0074 `quickbooks_tax_code_id`), the QBO links.
- Memory: [[project_qbo_realms]] (CA sandbox `9341457252668239`, ON-only) · [[project_drizzle_journal_when_gotcha]] · [[project_prod_db]] (sandbox-first 5432) · [[feedback_no_yup]] (Zod).
- Precedent: [`../closed/0071-quickbooks-item-pull/plan.md`](../closed/0071-quickbooks-item-pull/plan.md) (QB-as-master + editor removal) · [`../closed/0074-quickbooks-tax-alignment/decision.md`](../closed/0074-quickbooks-tax-alignment/decision.md) (the rate-matcher being replaced).

**Overall Progress:** 0% (0/5 phases complete) — **scaffold only; Phase 1 gate unresolved.**

**Note:** Phases 2–5 are provisional. Phase 1's matching decision restructures them — e.g. manual mapping adds a per-province code-picker UI + a mapping store; a name heuristic keeps it code-only.

### Phase Checklist

#### Phase 1: Research/decide — jurisdiction-matching strategy (GATE) — research, no code
- [x] **Probed the bridge problem (2026-06-10):** QB tax codes have **no province field**, and the CA customers have **no `DefaultTaxCodeRef`** (so we can't source a dealer's code from QB's customer record) — but customers **do** carry a province (`BillAddr.CountrySubDivisionCode`). → A pure "delete + mirror QB, no province" model is **not** possible (nothing links a code to who pays it); the province stays the key.
- [x] **Matching strategy → NAME HEURISTIC (auto), not manual mapping** (owner steer 2026-06-10 — "don't map, just sync"): match each province to a QB code whose **name** encodes the jurisdiction ("HST ON" → ON) on every pull; adopt QB's rate. No manual mapping table/UI. **Caveat:** clean for HST provinces (single "HST XX" code — all the CA sandbox has); **fragile for GST+PST/QST** (BC/QC use multiple/grouped codes) → auto-match the confident ones, **flag the ambiguous/unmatched** for a one-off per-province override (the only manual touch, and only for the tricky provinces).
- [ ] Finalize: provinces with no confident QB-name match → keep app rate + "unmanaged" flag (vs block); editor read-only (not removed — admins still need to *see* rates); infer "managed" from `quickbooks_tax_code_id` (no new column); keep the 0074 rate-drift guard as a safety net.
- [ ] Write `decision.md`; **rewrite Phases 2–5** to match (name-matcher + rate adoption + read-only editor + per-province override for ambiguous).

#### Phase 2: Jurisdiction matcher (provisional)
- [ ] Replace/augment `matchProvinceTaxCode` with jurisdiction matching per Phase 1; add a mapping store if manual (extend `tax_rates`, or a small table). Migration via `db-conventions`, sandbox-first, **verify journal `when`** if a column is added.
- [ ] Unit tests for the matcher (jurisdiction match, ambiguity, no-code).

#### Phase 3: Adopt QB rate (provisional)
- [ ] Extend `applyTaxCodeSync` to write `tax_rates.rate` = the matched code's QB rate (+ set/clear the managed flag). Executor-injected.
- [ ] Integration test (rolled-back tx): ON adopts QB's rate; an unmapped province keeps its app rate + unmanaged.

#### Phase 4: Read-only editor (provisional)
- [ ] Make the tax-rate editor read-only (disable/remove `updateTaxRate`; `TaxRatesAdmin` shows rates + "managed by QuickBooks", unmanaged provinces flagged) — mirror 0071's removal. Update the gate-matrix (drop/adjust the `lookup:edit` tax-rate row).

#### Phase 5: Tests + smoke + wiki (provisional)
- [ ] Unit + integration green; gate-matrix updated.
- [ ] Smoke (web-test): `/admin/lookups` tax-rates section is read-only ("managed by QuickBooks"); `/admin/quickbooks` pull adopts ON's rate. (Live ON-rate-adoption verified on the CA sandbox; multi-province deferred — blocker.)
- [ ] Ingest into `docs/wiki/data-model.md` (`tax_rates` now QB-sourced) + `docs/wiki/log.md`; note the editor is read-only + the prod multi-province dependency.
