# Editable Report Tab for Billing — Plan

**Intent:** [`intent.md`](intent.md)
**Started:** _Not started — scaffolded 2026-05-21 (owner-tagged "nice to have" — lower priority than 0055–0058)_

> **Phase 1 is a data-model decision, not code.** Where billing adjustments persist (override columns vs a `billing_adjustments` table) must be settled with the owner + the `db-conventions` skill before the UI is built. Don't skip to Phase 3.

## Progress Tracker

| Phase | Status | Commit |
|-------|--------|--------|
| 1: Decide persistence model for billing adjustments | Done | _(decision)_ |
| 2: Schema + migration (db-conventions) | Done | `a4f4769` |
| 3: Editable cells + persist action on the report | Done | `706dca4` |
| 4: Totals reflect adjustments; original recoverable | Done | `706dca4` |
| 5: Tests + smoke verification | Done | `8b3c0c6` |

**Phase 5 (2026-05-22):**
- `src/features/reports/actions.test.ts` — 11 cases: upsert, clear→delete (original recoverable), whitespace=clear, unknown-field/invalid-id/out-of-range rejection, zero-as-valid, FK-throw friendly error.
- Registered `setBillingAdjustment` in the action-gate matrix (`ADMIN_ONLY` across all roles) — `action-gate-matrix.test.ts` now verifies the admin-only admit set.
- **Capability pairing:** switched the UI gate from a server-computed prop to `useCan('reports:edit-billing')` in `<ReportsTabs>` so `pnpm check:capability-pairing` sees the UI↔server pair (20/21 paired). The action stays the real enforcement.
- Wiki ingest: `data-model.md` (new `billing_adjustments` table + relationship/actors/tables-at-a-glance) + `auth.md` (new capability row + per-action gate row).
- **Effective totals** (the SQL `coalesce(override, campaign.value)`) are verified by reading + the chunk-end browser smoke — not unit-testable without a live DB; the persist/clear/validation path is unit-covered.
- **Pre-existing, out of scope:** `pnpm check:capability-pairing` also flags `msa:edit` (server-gated, no UI affordance, `msa/actions.ts:120,189`) — predates 0059; parked as a follow-up.

**Phase 3+4 implementation (2026-05-22):** committed together — the editable cells (P3) are inseparable from the effective totals (P4), and both share the `FullReportCampaign` type in `queries.ts`.
- **Action:** `src/features/reports/actions.ts` → `setBillingAdjustment` (`reports:edit-billing`, admin-only). Empty value → DELETE (original recoverable); present value → UPSERT on `(campaign_id, field)`. New capability `reports:edit-billing` in `capabilities.ts`.
- **UI:** `src/features/reports/billing-cell.tsx` (inline input, save-on-blur, original shown beneath when overridden) + `buildFullColumns({ canEditBilling })` makes Records/SMS/Letters/**BDC** (new column) effective + editable. Coaches see effective values with an "adj" marker, no input. `reports/page.tsx` computes `canEditBilling` via `can(...)`.
- **Effective totals (P4):** `loadFullProductionReport` now returns `FullReportCampaign[]` (campaign + `billing` overlay); the three aggregate loaders LEFT-join a `billingPivotSubquery()` and `sum(coalesce(override, campaign.value))`. Reports CSV (`reports/export/route.ts`) emits effective values too.

**Phase 1 decisions (owner, 2026-05-22):**
- **Persistence: dedicated `billing_adjustments` table** (option b), EAV-by-field (one row per campaign × field). Keeps billing off the campaign row; original campaign value untouched + recoverable (clearing an adjustment deletes its row → report falls back to the campaign column).
- **Editable figures: Records / SMS-Email / Letters / BDC quantities** — `field` ∈ `('qty_records','sms_email','letters','bdc')` (mirrors the campaign column names). `value` is `integer` (matches those columns; the owner-approved "numeric" preview was illustrative — all four are integer quantities).
- **Permissions: admin-only edits.** New capability `reports:edit-billing` (pure-admin). Reports stay viewable by admin + coach (`reports:view`); only admins see/use the editable cells.
- **Aggregate scope:** the By-Dealer/Coach/Month tabs sum Records/SMS/Letters only (no BDC total today) — those three reflect effective (adjusted) values; BDC adjustments show on the Full report row + CSV but not in an aggregate total (none exists to adjust).
- **Concurrency:** per-cell upsert is last-write-wins (admin-only, low contention) — the quote optimistic-lock shape is for lifecycle safety and is overkill for a single numeric override cell.

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
