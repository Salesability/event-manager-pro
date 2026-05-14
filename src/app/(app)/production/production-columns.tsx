'use client';

import { Megaphone } from 'lucide-react';
import type { ColumnDef, FilterFn } from '@tanstack/react-table';
import { Badge } from '@/components/catalyst/badge';
import { CampaignStatusBadge } from '@/components/app/status-badge';
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

/** Time-derived pill key, mirroring the legacy `CampaignStatusBadge`
 *  inputs (live/past/upcoming). `cancelled` is a separate row-state
 *  surfaced as a fourth pill so the filter pill can distinguish it. */
export type CampaignTimeStatus = 'live' | 'past' | 'upcoming' | 'cancelled';

export function campaignTimeStatus(c: Campaign, todayIso: string): CampaignTimeStatus {
  if (c.status === 'cancelled') return 'cancelled';
  if (c.endDate < todayIso) return 'past';
  if (c.startDate <= todayIso && c.endDate >= todayIso) return 'live';
  return 'upcoming';
}

export function buildProductionColumns(
  actions: CampaignColumnActions,
  todayIso: string,
): ColumnDef<Campaign>[] {
  // Filter closes over `todayIso` so it stays in lockstep with cell
  // rendering. Recomputing the date inside the filterFn would let the
  // UI pill drift from the badge / CSV near midnight or when the
  // browser timezone differs from the deploy server's (Codex Medium
  // surfaced this — Toronto-server vs. ET-client at 23:55).
  const filterTimeStatus: FilterFn<Campaign> = (row, _columnId, filterValue: unknown) => {
    if (!filterValue || typeof filterValue !== 'object') return true;
    const { time, showCancelled } = filterValue as ProductionStatusFilter;
    if (!showCancelled && row.original.status === 'cancelled') return false;
    if (time === 'upcoming') return row.original.endDate >= todayIso;
    if (time === 'past') return row.original.endDate < todayIso;
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
      id: 'status',
      accessorFn: (c) => campaignTimeStatus(c, todayIso),
      header: 'Status',
      filterFn: filterTimeStatus,
      cell: ({ row }) => {
        const c = row.original;
        if (c.status === 'cancelled') {
          return <Badge color="red">Cancelled</Badge>;
        }
        const past = c.endDate < todayIso;
        const live = c.startDate <= todayIso && c.endDate >= todayIso;
        return <CampaignStatusBadge live={live} past={past} />;
      },
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
  /** Time-window pill: `''` matches every non-cancelled row, `upcoming`
   *  is `endDate >= today`, `past` is `endDate < today`. */
  time: '' | 'upcoming' | 'past';
  /** When `false` (default), `status === 'cancelled'` rows are hidden
   *  regardless of the time window — matches the legacy show-cancelled
   *  checkbox behavior. */
  showCancelled: boolean;
};
