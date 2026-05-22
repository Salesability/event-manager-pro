'use client';

import { useMemo, useState } from 'react';
import type {
  ColumnFiltersState,
  FilterFn,
  PaginationState,
  SortingState,
} from '@tanstack/react-table';
import { DataTable } from '@/components/ui/data-table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/catalyst/tabs';
import {
  buildClientColumns,
  buildCoachColumns,
  buildFullColumns,
  buildMonthColumns,
} from '@/features/reports/reports-columns';
import type {
  CampaignAggregateRow,
  FullReportCampaign,
} from '@/features/schedule/queries';
import { formatYearMonth } from '@/lib/dates';

export type ReportTabKey = 'dealer' | 'coach' | 'month' | 'full';

const TAB_LABELS: Record<ReportTabKey, string> = {
  dealer: 'By Dealer',
  coach: 'By Coach',
  month: 'By Month',
  full: 'Full Production Report',
};

// Cross-column search for the Full tab — hits dealer name, coach name, and
// notes so a single textbox covers the muscle-memory queries from the
// legacy Summary modal.
const fullGlobalFilterFn: FilterFn<FullReportCampaign> = (row, _columnId, filterValue) => {
  const q = String(filterValue ?? '').toLowerCase().trim();
  if (!q) return true;
  const c = row.original;
  if (c.dealerName.toLowerCase().includes(q)) return true;
  if (c.coachName && c.coachName.toLowerCase().includes(q)) return true;
  if (c.notes && c.notes.toLowerCase().includes(q)) return true;
  if (c.styleLabel && c.styleLabel.toLowerCase().includes(q)) return true;
  return false;
};

export function ReportsTabs({
  byDealer,
  byCoach,
  byMonth,
  full,
  canEditBilling = false,
}: {
  byDealer: CampaignAggregateRow<number>[];
  byCoach: CampaignAggregateRow<number | null>[];
  byMonth: CampaignAggregateRow<string>[];
  full: FullReportCampaign[];
  canEditBilling?: boolean;
}) {
  const [tab, setTab] = useState<ReportTabKey>('dealer');

  const dealerColumns = useMemo(() => buildClientColumns(), []);
  const coachColumns = useMemo(() => buildCoachColumns(), []);
  const monthColumns = useMemo(() => buildMonthColumns(), []);
  const fullColumns = useMemo(() => buildFullColumns({ canEditBilling }), [canEditBilling]);

  // Sort + pagination lifted per tab so they survive Radix Tabs' default
  // unmount-on-switch (Codex 0014 Phase 2 Low #3). Without this, sorting the
  // `By Dealer` table by Records DESC, switching to Coach, switching back,
  // would reset to the default sort.
  const [dealerSort, setDealerSort] = useState<SortingState>([
    { id: 'groupLabel', desc: false },
  ]);
  const [dealerPage, setDealerPage] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: 25,
  });
  const [coachSort, setCoachSort] = useState<SortingState>([
    { id: 'groupLabel', desc: false },
  ]);
  const [coachPage, setCoachPage] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: 25,
  });
  const [monthSort, setMonthSort] = useState<SortingState>([
    { id: 'groupLabel', desc: false },
  ]);
  const [monthPage, setMonthPage] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: 25,
  });
  const [fullSort, setFullSort] = useState<SortingState>([
    { id: 'startDate', desc: false },
  ]);
  const [fullPage, setFullPage] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: 25,
  });

  // Full-tab filter state — search + month picker. Mirrors the
  // `ColumnFiltersState` idiom from `people-admin.tsx`.
  const [fullGlobalFilter, setFullGlobalFilter] = useState('');
  const [fullColumnFilters, setFullColumnFilters] = useState<ColumnFiltersState>([]);

  // Distinct YYYY-MM values surfaced from the campaign list — used to populate
  // the Full tab's month picker. Sorted ascending so dropdown ordering is
  // predictable.
  const fullMonthOptions = useMemo(() => {
    const months = new Set<string>();
    for (const c of full) {
      months.add(c.startDate.slice(0, 7));
    }
    return Array.from(months).sort();
  }, [full]);

  const fullMonthValue =
    (fullColumnFilters.find((f) => f.id === 'startDate')?.value as string | undefined) ?? '';

  function setFullMonth(month: string) {
    setFullColumnFilters((prev) => {
      const others = prev.filter((f) => f.id !== 'startDate');
      if (!month) return others;
      return [...others, { id: 'startDate', value: month }];
    });
  }

  return (
    <Tabs value={tab} onValueChange={(v) => setTab(v as ReportTabKey)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <TabsList aria-label="Report views" className="print:hidden">
          {(Object.keys(TAB_LABELS) as ReportTabKey[]).map((key) => (
            <TabsTrigger key={key} value={key}>
              {TAB_LABELS[key]}
            </TabsTrigger>
          ))}
        </TabsList>
        <div className="flex items-center gap-2 print:hidden">
          <a
            href={`/reports/export?tab=${tab}`}
            className="rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-900 transition hover:border-brand-500 hover:text-brand-700"
          >
            ⬇ Export CSV
          </a>
          <button
            type="button"
            onClick={() => window.print()}
            className="rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-900 transition hover:border-brand-500 hover:text-brand-700"
          >
            🖨 Print
          </button>
        </div>
      </div>

      <TabsContent value="dealer">
        <DataTable
          columns={dealerColumns}
          data={byDealer}
          sorting={dealerSort}
          onSortingChange={setDealerSort}
          pagination={dealerPage}
          onPaginationChange={setDealerPage}
          emptyState="No campaigns to summarise yet."
        />
      </TabsContent>

      <TabsContent value="coach">
        <DataTable
          columns={coachColumns}
          data={byCoach}
          sorting={coachSort}
          onSortingChange={setCoachSort}
          pagination={coachPage}
          onPaginationChange={setCoachPage}
          emptyState="No campaigns to summarise yet."
        />
      </TabsContent>

      <TabsContent value="month">
        <DataTable
          columns={monthColumns}
          data={byMonth}
          sorting={monthSort}
          onSortingChange={setMonthSort}
          pagination={monthPage}
          onPaginationChange={setMonthPage}
          emptyState="No campaigns to summarise yet."
        />
      </TabsContent>

      <TabsContent value="full">
        <div className="mb-3 flex flex-wrap items-center gap-2 print:hidden">
          <input
            type="search"
            value={fullGlobalFilter}
            onChange={(e) => setFullGlobalFilter(e.target.value)}
            placeholder="Search dealer, coach, format, notes…"
            aria-label="Search campaigns"
            className="min-w-[16rem] flex-1 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-sm text-zinc-900 outline-none transition focus:border-brand-500 focus:ring-3 focus:ring-brand-500/20"
          />
          <label className="flex items-center gap-2 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-500">
            Month
            <select
              value={fullMonthValue}
              onChange={(e) => setFullMonth(e.target.value)}
              className="rounded border border-zinc-200 bg-white px-2 py-0.5 text-xs"
            >
              <option value="">All months</option>
              {fullMonthOptions.map((m) => (
                <option key={m} value={m}>
                  {formatYearMonth(m)}
                </option>
              ))}
            </select>
          </label>
        </div>
        <DataTable
          columns={fullColumns}
          data={full}
          sorting={fullSort}
          onSortingChange={setFullSort}
          pagination={fullPage}
          onPaginationChange={setFullPage}
          globalFilter={fullGlobalFilter}
          onGlobalFilterChange={setFullGlobalFilter}
          columnFilters={fullColumnFilters}
          onColumnFiltersChange={setFullColumnFilters}
          globalFilterFn={fullGlobalFilterFn}
          emptyState="No campaigns match."
        />
      </TabsContent>
    </Tabs>
  );
}

