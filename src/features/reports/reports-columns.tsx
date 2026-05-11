'use client';

import type { ColumnDef } from '@tanstack/react-table';
import type {
  Campaign,
  CampaignAggregateRow,
} from '@/features/schedule/queries';

// Column factories for the four /reports tabs. Mirrors the
// `buildPeopleColumns(...)` shape from `people-columns.tsx` — pure functions
// returning ColumnDef[] so the consumer can tweak per-tab affordances without
// reaching back here.

function fmtNum(n: number | null | undefined): string {
  if (n == null) return '—';
  return n.toLocaleString();
}

function fmtDate(iso: string): string {
  const d = new Date(`${iso}T12:00:00`);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// Aggregate tabs (dealer/coach/month) share this column shape — the only
// thing that varies is the first column header and (for the month tab) the
// sort comparator. Return a fresh array per caller so each table mounts
// independent column instances.
function buildAggregateColumns<K extends number | null | string>(
  groupHeader: string,
  sortByKey?: boolean,
): ColumnDef<CampaignAggregateRow<K>>[] {
  return [
    {
      id: 'groupLabel',
      accessorKey: 'groupLabel',
      header: groupHeader,
      cell: ({ row }) => (
        <span className="font-medium text-stone-800">{row.original.groupLabel}</span>
      ),
      enableSorting: true,
      // Month tab passes `sortByKey` because `groupLabel` is "April 2026" /
      // "August 2026" / … which sorts alphabetically (April < August <
      // December < July). The chronological signal lives on `groupKey`,
      // which is the `YYYY-MM` string from `to_char` and sorts naturally.
      ...(sortByKey
        ? {
            sortingFn: (a, b) => {
              const av = String(a.original.groupKey ?? '');
              const bv = String(b.original.groupKey ?? '');
              return av.localeCompare(bv);
            },
          }
        : {}),
    },
    {
      id: 'count',
      accessorKey: 'count',
      header: 'Campaigns',
      cell: ({ row }) => (
        <span className="text-right tabular-nums">{row.original.count.toLocaleString()}</span>
      ),
      enableSorting: true,
      meta: { align: 'right' },
    },
    {
      id: 'totalQty',
      accessorKey: 'totalQty',
      header: 'Records',
      cell: ({ row }) => (
        <span className="text-right tabular-nums">{fmtNum(row.original.totalQty)}</span>
      ),
      enableSorting: true,
      meta: { align: 'right' },
    },
    {
      id: 'totalSms',
      accessorKey: 'totalSms',
      header: 'SMS / Email',
      cell: ({ row }) => (
        <span className="text-right tabular-nums">{fmtNum(row.original.totalSms)}</span>
      ),
      enableSorting: true,
      meta: { align: 'right' },
    },
    {
      id: 'totalLetters',
      accessorKey: 'totalLetters',
      header: 'Letters',
      cell: ({ row }) => (
        <span className="text-right tabular-nums">{fmtNum(row.original.totalLetters)}</span>
      ),
      enableSorting: true,
      meta: { align: 'right' },
    },
  ];
}

export function buildClientColumns(): ColumnDef<CampaignAggregateRow<number>>[] {
  return buildAggregateColumns<number>('Dealer');
}

export function buildCoachColumns(): ColumnDef<CampaignAggregateRow<number | null>>[] {
  return buildAggregateColumns<number | null>('Coach');
}

export function buildMonthColumns(): ColumnDef<CampaignAggregateRow<string>>[] {
  return buildAggregateColumns<string>('Month', /* sortByKey */ true);
}

// Full Production Report — flat campaign list. Mirrors `/production` columns
// (the legacy "Full Production Report" tab was an alternate render of the
// same data). Sortable headers + tabular-nums on the integer columns.
export function buildFullColumns(): ColumnDef<Campaign>[] {
  return [
    {
      id: 'startDate',
      accessorKey: 'startDate',
      header: 'Start',
      cell: ({ row }) => (
        <div>
          <div className="text-xs font-semibold text-navy">{fmtDate(row.original.startDate)}</div>
          <div className="text-[11px] text-stone-400">→ {fmtDate(row.original.endDate)}</div>
        </div>
      ),
      enableSorting: true,
      // Month-picker faceted filter passes a YYYY-MM string. The row value
      // is a full ISO date — match by prefix rather than equality.
      filterFn: (row, _columnId, filterValue: string) => {
        if (!filterValue) return true;
        return row.original.startDate.startsWith(filterValue);
      },
    },
    {
      id: 'dealerName',
      accessorKey: 'dealerName',
      header: 'Dealership',
      cell: ({ row }) => (
        <span className="font-semibold text-stone-800">{row.original.dealerName}</span>
      ),
      enableSorting: true,
    },
    {
      id: 'styleLabel',
      accessorFn: (c) => c.styleLabel ?? '',
      header: 'Format',
      cell: ({ row }) => row.original.styleLabel ?? <span className="text-stone-400">—</span>,
      enableSorting: true,
    },
    {
      id: 'audienceSourceLabel',
      accessorFn: (c) => c.audienceSourceLabel ?? '',
      header: 'Data Source',
      cell: ({ row }) =>
        row.original.audienceSourceLabel ?? <span className="text-stone-400">—</span>,
      enableSorting: true,
    },
    {
      id: 'qtyRecords',
      accessorFn: (c) => c.qtyRecords ?? 0,
      header: 'Records',
      cell: ({ row }) => (
        <span className="text-right tabular-nums">{fmtNum(row.original.qtyRecords)}</span>
      ),
      enableSorting: true,
      meta: { align: 'right' },
    },
    {
      id: 'smsEmail',
      accessorFn: (c) => c.smsEmail ?? 0,
      header: 'SMS / Email',
      cell: ({ row }) => (
        <span className="text-right tabular-nums">{fmtNum(row.original.smsEmail)}</span>
      ),
      enableSorting: true,
      meta: { align: 'right' },
    },
    {
      id: 'letters',
      accessorFn: (c) => c.letters ?? 0,
      header: 'Letters',
      cell: ({ row }) => (
        <span className="text-right tabular-nums">{fmtNum(row.original.letters)}</span>
      ),
      enableSorting: true,
      meta: { align: 'right' },
    },
    {
      id: 'coachName',
      accessorFn: (c) => c.coachName ?? '',
      header: 'Coach',
      cell: ({ row }) =>
        row.original.coachName ? (
          <span className="font-semibold">{row.original.coachName}</span>
        ) : (
          <span className="text-stone-400">—</span>
        ),
      enableSorting: true,
    },
    {
      id: 'status',
      accessorKey: 'status',
      header: 'Status',
      cell: ({ row }) => <span className="text-xs">{row.original.status}</span>,
      enableSorting: true,
    },
  ];
}

