# Production List: Date column (replace Status) — Plan

**Intent:** [`intent.md`](intent.md)
**Started:** 2026-07-06

## Progress Tracker

| Phase | Status | Commit |
|-------|--------|--------|
| 1: Swap Status → sortable Date column + re-home "Show cancelled" filter | Done | `97beb06` |
| 2: Retire the time-window dropdown + trim dead code | Done | `5871f48` |
| 3: Tests + smoke verification | Done | `38fde24` |

Replace the Production List's derived **Status** column with a sortable **Date**
(start date) column, default the list to date-ascending, and keep the "Show
cancelled" default-hide while dropping the now-redundant time-window dropdown.
"Done" = `/production` sorts by date, cancelled rows stay hidden by default, the
time-window `<select>` is gone, and no dead time-window code remains in `filter.ts`
or the CSV export route. **Code-only, no migration** (`Campaign` already carries
`startDate`/`endDate`).

## Code Anchors

For each new/changed piece below, read the anchor first and match its shape.

| New code | Anchor (`path:line`) | Why this anchor |
|----------|---------------------|-----------------|
| Date column def in `production-columns.tsx` | `src/app/(app)/production/production-columns.tsx:68` (the `identity` column — already formats `startDate`/`endDate` via `fmtDate`, `enableSorting: true`) | Same file, sibling column; reuse `fmtDate` + the sorting convention |
| Removing the Status column + its `filterFn` | `src/app/(app)/production/production-columns.tsx:88` (`id:'status'`, `filterFn: filterTimeStatus`, lines 54–66) | This is the column/filter being removed and re-homed |
| Re-homed "Show cancelled" filter binding | `src/app/(app)/production/production-admin.tsx:110` (`columnFilters` → `{ id: 'status', value }`) | The `columnFilters` id must match a live column, else the filter silently no-ops |
| Toolbar without the time-window `<select>` | `src/app/(app)/production/production-admin.tsx:129` (the `filters` block: `<select>` + "Show cancelled" `<label>`) | Keep the checkbox, drop the select |
| Trimmed CSV export predicate | `src/app/(app)/production/export/route.ts:44` (inlined search + time-window + show-cancelled predicate) | Server-side copy of the same filter; drop the time-window half, keep show-cancelled + search |
| Slimmed `filter.ts` | `src/app/(app)/production/filter.ts:22` (`ProductionRange`, `PRODUCTION_RANGE_MONTHS`, `isProductionRange`, `rangeWindowEndIso`) | These exports become unused once the time-window is gone; keep `todayIso` |

**Conventions referenced:**
- `src/components/ui/data-table.tsx` — TanStack `getSortedRowModel` + per-column `enableSorting`; ISO `YYYY-MM-DD` strings sort lexically = chronologically, so `accessorKey: 'startDate'` needs no custom sort fn.
- `docs/wiki/data-model.md` — `campaigns.start_date`/`end_date` are `date` columns; `Campaign` rows project both.

**Overall Progress:** 100% (3/3 phases complete)

### Phase Checklist

#### Phase 1: Swap Status → sortable Date column + re-home "Show cancelled" filter
- [x] `production-columns.tsx`: remove the `id:'status'` column (the derived-status badge + its `filterFn: filterTimeStatus`).
- [x] Add a `id:'date'` column: `accessorKey: 'startDate'`, `header: 'Date'`, cell renders `fmtDate(startDate)`, `enableSorting: true`.
- [x] Re-home the filter: `filterShowCancelled` (show-cancelled only) attached to the new `date` column; time-window branches dropped.
- [x] `production-admin.tsx`: point `columnFilters` at `{ id: 'date', value }` and narrow `ProductionStatusFilter` to `{ showCancelled }`.
- [x] Set `initialSorting={[{ id: 'date', desc: false }]}` (was `identity`).
- [x] Remove now-unused imports (`campaignTimeStatus`/`CampaignTimeStatus` deleted, `CampaignStatusBadge` + `Badge` + time-window helper imports removed) from `production-columns.tsx`.
- [x] Unwound the now-dead `todayIso` threading (existed only for the derived status): dropped the `buildProductionColumns` param, the `ProductionAdmin` prop, and the `page.tsx` import + pass. `filter.ts` keeps `todayIso` (the CSV export still uses it).
- [x] App still compiles and the list still hides cancelled by default. *(verified by the fast gate)*

#### Phase 2: Retire the time-window dropdown + trim dead code
- [x] `production-admin.tsx`: removed the time-window `<select>` (All/Upcoming/Past/Next 1–3 months) from the `filters` block; kept the "Show cancelled" checkbox. Removed the `status` URL-param plumbing (`time`/`TimeWindow`/`isTime`/`statusParam` + the `pushParams` `status` branch), kept `q` + `cancelled`. Freshened the empty-state copy (no more "status filter").
- [x] `export/route.ts`: dropped the `status`/time-window predicate (upcoming/past/range) and the `rangeWindowEndIso`/`isProductionRange` imports; kept the search-needle + show-cancelled filter. Output's `Date Range` + `Status` columns left as-is (report fields).
- [x] `filter.ts`: deleted the now-unused `ProductionRange`, `PRODUCTION_RANGE_MONTHS`, `isProductionRange`, `rangeWindowEndIso`; kept `todayIso` (export route still uses it).
- [x] Deleted `filter.test.ts` (it only exercised the removed forward-window helpers) — had to land here, not Phase 3, so the fast gate stays green once the exports are gone.
- [x] Grepped for remaining `?status=` / `TimeWindow` / `ProductionRange` / `campaignTimeStatus` references — none dangling (only legit `c.status` reads remain).

#### Phase 3: Tests + smoke verification
- [x] Update/remove unit tests referencing the Status column or the time-window filter — the only one was `filter.test.ts` (removed in Phase 2); a repo-wide grep found no other production-columns/filter tests.
- [x] Added `production-columns.test.ts`: the re-homed Date-column filter hides `status:'cancelled'` when `showCancelled` is false, shows them when true, always passes non-cancelled rows, and passes through when the value is absent — plus a shape test (Date column sortable, no `status` column). 5/5 pass.
- [x] `tsc` clean; unit suite 1242 pass (integration failures are the paused sandbox pooler, env-only). No-new-lint verified in the chunk-end `/eval`.
- [~] Smoke (web-test): `goto /production` — **deferred to owner-verify.** Auth injection failed (sandbox Supabase `qppenapeguwevcheqwpz` paused), so the authed table render couldn't be exercised. Phase 1 boot/route PASSED (`/production` gates → `/login`, 0 console errors). Owner: confirm the **Date** header (no **Status**), search + "Show cancelled" (no time-window dropdown). See [eval-2026-07-06-1600.md](eval-2026-07-06-1600.md).
- [~] Smoke (web-test): click the **Date** column header; rows re-order — **deferred to owner-verify** (same paused-sandbox cause).
