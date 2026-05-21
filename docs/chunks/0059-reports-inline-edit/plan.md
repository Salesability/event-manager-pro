# Editable Report Tab for Billing — Plan

**Intent:** [`intent.md`](intent.md)
**Started:** _Not started — scaffolded 2026-05-21 (owner-tagged "nice to have" — lower priority than 0055–0058)_

> **Phase 1 is a data-model decision, not code.** Where billing adjustments persist (override columns vs a `billing_adjustments` table) must be settled with the owner + the `db-conventions` skill before the UI is built. Don't skip to Phase 3.

## Progress Tracker

| Phase | Status | Commit |
|-------|--------|--------|
| 1: Decide persistence model for billing adjustments | Pending | - |
| 2: Schema + migration (db-conventions) | Pending | - |
| 3: Editable cells + persist action on the report | Pending | - |
| 4: Totals reflect adjustments; original recoverable | Pending | - |
| 5: Tests + smoke verification | Pending | - |

This chunk lets the owner adjust billing-relevant report figures inline so invoice numbers match intent, without destroying the underlying campaign data. "Done" looks like: editable billing cells on the report, adjustments that persist and recompute totals, and the original computed value still recoverable.

## Code Anchors

| New code | Anchor (`path:line`) | Why this anchor |
|----------|---------------------|-----------------|
| Editable cell input on a report column | `src/features/quotes/quote-composer.tsx:703-716` (per-line override editable Unit cell) | The repo's established inline-edit-with-original-visible pattern |
| Report tab wiring | `src/features/reports/reports-tabs.tsx` (read-only `<DataTable>` tabs) | Where editable columns slot in (likely the Full Production Report tab) |
| Report columns | `src/features/reports/reports-columns.tsx` | Column defs to make editable |
| Persist action | `src/features/quotes/actions.ts:setQuoteInputs` (guarded-UPDATE override persistence) | Same optimistic-lock + recompute shape for a billing-adjustment write |
| Aggregate recompute | `src/features/schedule/queries.ts` (`loadCampaignsByDealer` / `loadFullProductionReport`) | Aggregates must read adjusted values once adjustments exist |
| Schema (if columns/table added) | follow `db-conventions` + a recent migration as the prose template | New billing-adjustment storage |

**Conventions referenced:**
- `db-conventions` skill — **invoke before** writing the billing-adjustment schema/migration.
- `docs/wiki/data-model.md` — campaigns + reporting aggregates; update when adjustment storage lands.
- `CLAUDE.md` → **Conventions** — the adjustment write is a Server Action.

**Overall Progress:** 0% (0/5 phases complete)

**Note:**
- Reports are *derived* today — making them editable means introducing a persisted adjustment layer. Resolve Phase 1 before touching UI.
- Pairs naturally with the 0025 quote-to-payment epic's invoice surface; consider sequencing alongside it.

### Phase Checklist

#### Phase 1: Decide persistence model
- [ ] With the owner: which figures are editable + which tab (intent Open Questions)
- [ ] Choose (a) `billing_*` override columns on `campaigns`, (b) `billing_adjustments` table, or (c) quote-layer reuse
- [ ] Decide permissions (admin-only vs coach too)

#### Phase 2: Schema + migration
- [ ] Invoke `db-conventions`; write the migration for the chosen model
- [ ] Audit columns + nullable adjustment fields; original value remains the campaign source-of-truth

#### Phase 3: Editable cells + persist
- [ ] Make the chosen report columns editable (mirror the composer override input)
- [ ] Server Action persists the adjustment with optimistic-lock + validation

#### Phase 4: Totals + recoverability
- [ ] Report totals + aggregate tabs read adjusted values
- [ ] Original computed value shown alongside / recoverable (not destroyed)

#### Phase 5: Tests + smoke verification
- [ ] Integration: adjustment persists, totals recompute, original recoverable
- [ ] Smoke (web-test): `goto /reports`; the billing column is editable on the intended tab
- [ ] Update `docs/wiki/data-model.md` for the adjustment storage
