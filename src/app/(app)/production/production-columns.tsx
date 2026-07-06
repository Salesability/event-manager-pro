'use client';

import { Megaphone } from 'lucide-react';
import type { ColumnDef, FilterFn } from '@tanstack/react-table';
import { RowIdentityCell } from '@/components/app/row-identity-cell';
import type { Campaign } from '@/features/schedule/queries';

function fmtDate(iso: string): string {
  const d = new Date(`${iso}T12:00:00`);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function fmtNumCell(n: number | null) {
  return n == null ? <span className="text-zinc-500/70">—</span> : n.toLocaleString();
}

export type CampaignColumnActions = {
  /** Identity-cell click opens the canonical editor (BookingForm
   *  dialog) since `/production` has no detail page today. */
  onEdit: (campaign: Campaign) => void;
};

export function buildProductionColumns(
  actions: CampaignColumnActions,
): ColumnDef<Campaign>[] {
  // "Show cancelled" is the only remaining production-list filter (0096
  // replaced the derived Status column with a sortable Date column and
  // retired the time-window dropdown a date sort supersedes). It's re-homed
  // onto the Date column below: hide `status === 'cancelled'` rows unless the
  // toolbar checkbox is on. No `todayIso` needed anymore.
  const filterShowCancelled: FilterFn<Campaign> = (row, _columnId, filterValue: unknown) => {
    if (!filterValue || typeof filterValue !== 'object') return true;
    const { showCancelled } = filterValue as ProductionStatusFilter;
    if (!showCancelled && row.original.status === 'cancelled') return false;
    return true;
  };

  return [
    {
      id: 'identity',
      accessorKey: 'dealerName',
      header: 'Campaign',
      cell: ({ row }) => {
        const c = row.original;
        const range = `${fmtDate(c.startDate)} → ${fmtDate(c.endDate)}`;
        return (
          <RowIdentityCell
            icon={<Megaphone className="size-4" />}
            iconTone="brand"
            label={c.dealerName}
            sublabel={range}
            onClick={() => actions.onEdit(c)}
          />
        );
      },
      enableSorting: true,
    },
    {
      id: 'date',
      accessorKey: 'startDate',
      header: 'Date',
      // Hosts the re-homed "Show cancelled" filter (0096); the filter value
      // only carries `showCancelled`, and `filterShowCancelled` ignores this
      // column's own value. ISO `YYYY-MM-DD` sorts lexically = chronologically.
      filterFn: filterShowCancelled,
      cell: ({ row }) => (
        <span className="whitespace-nowrap text-xs tabular-nums text-zinc-900">
          {fmtDate(row.original.startDate)}
        </span>
      ),
      enableSorting: true,
    },
    {
      id: 'contact',
      accessorFn: (c) => c.contact ?? '',
      header: 'Contact',
      cell: ({ row }) => {
        const c = row.original;
        return (
          <div>
            <div className="text-xs">{c.contact ?? '—'}</div>
            <div className="text-[11px] text-zinc-500/70">{c.phone ?? '—'}</div>
            <div className="text-[11px] text-brand-700">{c.email ?? '—'}</div>
          </div>
        );
      },
      enableSorting: true,
    },
    {
      id: 'format',
      accessorFn: (c) => c.styleLabel ?? '',
      header: 'Format',
      cell: ({ row }) =>
        row.original.styleLabel ? (
          <span className="inline-block rounded-full bg-brand-50 px-2 py-0.5 text-[11px] font-semibold text-brand-700">
            {row.original.styleLabel}
          </span>
        ) : (
          <span className="text-zinc-500/70">—</span>
        ),
      enableSorting: true,
    },
    {
      id: 'audienceSource',
      accessorFn: (c) => c.audienceSourceLabel ?? '',
      header: 'Data Source',
      cell: ({ row }) => (
        <span className="text-xs text-zinc-500">
          {row.original.audienceSourceLabel ?? '—'}
        </span>
      ),
      enableSorting: true,
    },
    {
      id: 'qtyRecords',
      accessorFn: (c) => c.qtyRecords ?? 0,
      header: 'Records',
      cell: ({ row }) => (
        <span className="block text-right font-semibold tabular-nums">
          {fmtNumCell(row.original.qtyRecords)}
        </span>
      ),
      enableSorting: true,
    },
    {
      id: 'smsEmail',
      accessorFn: (c) => c.smsEmail ?? 0,
      header: 'SMS / Email',
      cell: ({ row }) => (
        <span className="block text-right font-semibold tabular-nums">
          {fmtNumCell(row.original.smsEmail)}
        </span>
      ),
      enableSorting: true,
    },
    {
      id: 'letters',
      accessorFn: (c) => c.letters ?? 0,
      header: 'Letters',
      cell: ({ row }) => (
        <span className="block text-right font-semibold tabular-nums">
          {fmtNumCell(row.original.letters)}
        </span>
      ),
      enableSorting: true,
    },
    {
      id: 'bdc',
      accessorFn: (c) => c.bdc ?? 0,
      header: 'BDC',
      cell: ({ row }) => (
        <span className="block text-right font-semibold tabular-nums">
          {fmtNumCell(row.original.bdc)}
        </span>
      ),
      enableSorting: true,
    },
    {
      id: 'coach',
      accessorFn: (c) => c.coachName ?? '',
      header: 'Coach',
      cell: ({ row }) =>
        row.original.coachName ? (
          <span className="font-semibold">{row.original.coachName}</span>
        ) : (
          <span className="text-zinc-500/70">—</span>
        ),
      enableSorting: true,
    },
    {
      id: 'notes',
      accessorFn: (c) => c.notes ?? '',
      header: 'Notes',
      cell: ({ row }) => (
        <span className="block max-w-[200px] truncate text-xs text-zinc-500">
          {row.original.notes ?? '—'}
        </span>
      ),
      enableSorting: false,
    },
  ];
}

export type ProductionStatusFilter = {
  /** When `false` (default), `status === 'cancelled'` rows are hidden —
   *  matches the toolbar's "Show cancelled" checkbox. Re-homed onto the Date
   *  column in 0096 (the derived Status column it used to ride on was removed). */
  showCancelled: boolean;
};
