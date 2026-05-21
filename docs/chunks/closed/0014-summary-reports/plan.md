# Booking summary & reports — 2026-04-30

Sub-plan 5.7 of `docs/chunks/0004-port-migration/plan.md`. Legacy `📊 Summary` button (`deprecated/index.html:278`) opens `summaryModal` (lines 552–574) — a four-tab analytics surface (`By Client`, `By Coach`, `By Month`, `Full Production Report`) with per-tab Print and Export CSV. Done = staff users see equivalent breakdowns rendered from the same Postgres data at `/reports`, each tab printable + CSV-exportable, sharing the same TanStack Table foundation as `/admin/people`.

Tabs (legacy semantics):
- **By Client** — campaigns grouped by dealer, count + total qty/SMS/letters per dealer.
- **By Coach** — campaigns grouped by coach, same totals.
- **By Month** — campaigns grouped by start-date month, same totals.
- **Full Production Report** — flat table identical to Production view, but in modal/print-friendly form.

## Progress Tracker

| Phase | Status | Commit |
|-------|--------|--------|
| 1: Aggregation queries (4 reports) | Done | 3f052aa |
| 2: Reports UI page (tabs + tables) | Done | ebfa63f |
| 3: Per-report Print + CSV export | Done | 3f4643f |
| 4: Verification (tsc + vitest + dev smoke) | Done | 155df20 |

## Code Anchors

The single largest anchor for this chunk is **`/admin/people`** — the 0021-people-polish chunk introduced TanStack Table + the `DataTable` wrapper as the codebase's admin-table foundation. Reports rides that same surface: one `DataTable` per tab, column definitions built via the per-report-columns pattern from `people-columns.tsx`, server-side data fetched at the route page.

| New code | Anchor (`path:line`) | Why this anchor |
|----------|---------------------|-----------------|
| `src/app/(app)/reports/page.tsx` (new) — server component, fetches all four datasets in parallel, hands them to the client `<ReportsTabs>` | `src/app/(app)/admin/people/page.tsx` (27 lines) | Same shape: server-side `await Promise.all([...queries])`, then renders the client-side table component with the data as a prop. Page-level RBAC gate via `requireRole(...)` lifted from people-admin's posture (Phase 6 added a durable staff gate). |
| `src/features/reports/reports-tabs.tsx` (new) — tab switcher + four `DataTable` instances + the `ColumnFiltersState` / faceted filter pills mirroring people-admin | `src/features/people/people-admin.tsx:1-200` (the table-state management region: `ColumnFiltersState`, `useState`, filter-pill wiring, `DataTable` mount) | Reuses the established TanStack pattern: column filter state, debounced search, faceted filters, sortable headers — all already wrapped in `@/components/ui/data-table`. Don't reinvent. |
| Per-report column defs at `src/features/reports/reports-columns.tsx` (new) — four exports: `buildClientColumns`, `buildCoachColumns`, `buildMonthColumns`, `buildFullColumns` | `src/features/people/people-columns.tsx` (210 lines, `buildPeopleColumns(...)` factory) | Same builder pattern: a function returning `ColumnDef<RowShape>[]`, each column with `accessorKey`, `header`, `cell`, optional `filterFn`. Keep header sort + cell formatting consistent with people-admin's idiom. |
| Tabs wrapper `src/components/ui/tabs.tsx` (new) — Radix Tabs primitive | `src/components/ui/dialog.tsx` (Radix Dialog wrapper from 0024 Phase 1) | Same wrapper pattern: third-party headless primitive + project Tailwind classes consolidated behind a stable API. Radix is established post-0024; `@radix-ui/react-tabs` is the consistent choice (not Base UI). |
| Aggregation queries in `src/features/schedule/queries.ts` (additions) | existing `loadCampaigns`/`loadDealers` shape in the same file | Same Drizzle idiom: typed return objects, audit-aware joins, consistent null handling. New funcs use Drizzle aggregations (`groupBy`, `count`, `sum` with `COALESCE`) per `db-conventions`. |
| CSV-export route handlers `src/app/reports/export/route.ts` (or per-tab) | existing 5.6 export pattern at `src/app/production/export/route.ts` | One-to-one: same `?format=csv` shape, same content-type + disposition headers, same encoding posture (CSV-injection mitigation is parked from 5.6 — apply the eventual fix uniformly). |

**Conventions referenced:**
- `docs/wiki/conventions.md` — Drizzle aggregations (`groupBy`, `count`, `sum`) instead of fetching campaigns and grouping in JS where the row count justifies it.
- `docs/wiki/architecture.md` — A standalone route (`/reports`) is appropriate; this surface is large enough to deserve its own page rather than a modal in the new app. UI primitives stay re-exported from `src/components/ui/`.
- `docs/wiki/auth.md` — `/reports` is staff-only; gate via `requireRole(['admin', 'coach'])` at the page level + the durable `requireStaffAccess()` already wired into `(app)/layout.tsx` from 0018.

**Overall Progress:** 100% (4/4 phases complete)

**Note:**
- Anchor on **`/admin/people`** — TanStack Table + `DataTable` wrapper + the column-builder factory + filter-state idiom are all established there. Reports is the second admin-table surface; the third (Production polish, Lookups polish) follows the same pattern.
- New surface: render at `/reports` rather than as a modal. Modals are for inline edits; reports are a destination.
- `qty_records`/`sms_email`/`letters` are integers, all nullable — sums must coalesce nulls to 0 (`COALESCE(SUM(...), 0)`).
- Reports tables likely benefit from sticky-header + horizontal-scroll on the Full Production Report tab (50-col-wide flat table); confirm the `DataTable` wrapper supports that or extend it.

### Phase Checklist

#### Phase 1: Aggregation queries
- [x] Add `loadCampaignsByDealer`, `loadCampaignsByCoach`, `loadCampaignsByMonth` to `src/features/schedule/queries.ts`.
- [x] Each returns `{ groupKey, groupLabel, count, totalQty, totalSms, totalLetters }` with `COALESCE(SUM(...), 0)` so nullable integer columns don't bubble nulls into totals.
- [x] `loadFullProductionReport` reuses the existing campaigns query shape (already loaded by `/production`); decide whether to call it here or compose the existing loader. Composed via re-export of `loadCampaigns()` to avoid drift.
- [x] Vitest coverage for the three aggregations against a fixture corpus (idempotent, clean teardown). 5 new tests in `src/features/schedule/queries.test.ts`.

#### Phase 2: Reports UI — anchored on `/admin/people`
- [x] New route `src/app/(app)/reports/page.tsx` — server component, `requireRole(['admin', 'coach'])`, `await Promise.all([...four queries])`, hand to client `<ReportsTabs>`. Mirror `src/app/(app)/admin/people/page.tsx`.
- [x] New `src/components/ui/tabs.tsx` — Radix Tabs wrapper following the `dialog.tsx` shape (`Tabs.Root`, `Tabs.List`, `Tabs.Trigger`, `Tabs.Content` re-exports + project Tailwind classes). Added `@radix-ui/react-tabs ^1.1.13` to `package.json`.
- [x] New `src/features/reports/reports-tabs.tsx` — client component with the four-tab switcher; each tab renders a `<DataTable>` (the `@/components/ui/data-table` wrapper from 0021).
- [x] New `src/features/reports/reports-columns.tsx` — four `buildXColumns(...)` factories, mirroring `people-columns.tsx`. Sortable headers, cell formatters consistent with people-admin. Month-picker faceted filter wired on the Full tab (the "Month" aggregate tab is itself the breakdown — extra filter would be redundant). Also exports `coachRowKey()` for stable keys when `groupKey` is null (Codex Phase 1 Low carry-forward).
- [x] Filter-pill state: lift the `ColumnFiltersState` + `useState` idiom from `people-admin.tsx:1-200`. Search input + facet pills on the Full Production Report tab match Production view's existing search/filter UX. Added Reports nav link to `app-nav.tsx`.

#### Phase 3: Print + CSV export
- [x] Reuse the print stylesheet from 5.6 (`src/app/production/print.css` or equivalent — confirm during implementation). Stylesheet lives in `src/app/globals.css` (`@media print {…}` block) — global, no separate file. Added `print:hidden` to `Tabs.List`, the action-button row (Export + Print), the Full-tab search/month picker, and the DataTable pagination footer so only the active table prints.
- [x] CSV export route at `src/app/reports/export/route.ts` accepting `?tab=client|coach|month|full`. Mirror the 5.6 export route handler shape (content-type, disposition, encoding posture). The CSV-injection mitigation parked from 5.6 needs to apply here too. Implemented at `src/app/(app)/reports/export/route.ts` (route group matches the page); `?tab=dealer|coach|month|full` (renamed `client` → `dealer` to match the UI tab key). Extracted `csvCell` / `buildCsv` / `csvResponse` to `src/lib/csv.ts` with formula-prefix mitigation; retrofitted `production/export/route.ts` to use the same helper, closing the parked Codex Medium from 5.6 in the same pass. 7 new vitest cases in `src/lib/csv.test.ts`.
- [x] Per-tab Print button triggers the print stylesheet; ensure the active tab's table is what prints (not all four). Print button calls `window.print()`; Radix Tabs unmounts inactive panels by default so only the active table is in the DOM at print time.

#### Phase 4: Verification
- [x] `pnpm tsc --noEmit` clean.
- [x] `pnpm test` clean (aggregation-query tests + columns-builder snapshots if useful). 171/171 across the chunk's three new test files (5 + 8 + 8 = 21 chunk-specific cases).
- [x] `pnpm dev` smoke: each tab renders correct totals against the imported corpus; CSVs match on-screen rows; print preview is clean. Verified live; print-mode wired via `beforeprint`/`afterprint` flips DataTable to `getFilteredRowModel().rows` so the full filtered set prints (not just the current page).
- [x] web-test smoke: navigate to `/reports`, switch tabs, verify the table mounts and at least one row renders per tab. Per-tab screenshots saved at `/tmp/web-test-reports-{dealer,coach,month,full}.png`. Added route-handler tests (`src/app/(app)/reports/export/route.test.ts`, 8 cases) covering the `requireRole(['admin','coach'])` gate-ordering invariant + rejection path + per-tab CSV shape + injection-mitigation pass-through.
