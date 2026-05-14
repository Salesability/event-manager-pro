'use client';

import { FileText } from 'lucide-react';
import type { ColumnDef } from '@tanstack/react-table';
import { QuoteStatusBadge } from '@/components/app/status-badge';
import { RelativeTime } from '@/components/app/relative-time';
import { RowIdentityCell } from '@/components/app/row-identity-cell';
import { quoteDisplayName } from '@/features/quotes/display-name';
import { displayStatusKey } from '@/features/quotes/status-display';
import type { Quote } from '@/features/quotes/queries';

function fmtMoney(amount: string): string {
  const n = Number(amount);
  if (!Number.isFinite(n)) return amount;
  return n.toLocaleString('en-CA', { style: 'currency', currency: 'CAD' });
}

type QuotesColumnsOptions = {
  /** When `true`, omit the dealer-name sublabel on the identity cell.
   *  Used by `/dealerships/[id]` where every row is for the same
   *  dealer and the sublabel adds noise. Default `false` (the global
   *  `/quotes` page). */
  hideDealerSublabel?: boolean;
};

export function buildQuotesColumns(
  options: QuotesColumnsOptions = {},
): ColumnDef<Quote>[] {
  const { hideDealerSublabel = false } = options;
  return [
    {
      id: 'identity',
      accessorFn: (q) => quoteDisplayName(q.createdAt),
      header: 'Quote',
      cell: ({ row }) => {
        const q = row.original;
        // Sublabel shows the dealer name; archived dealers also flag in
        // their own line so a scanner sees the row's status at a glance.
        // The click target IS the composer (edit-default).
        const sublabel = hideDealerSublabel
          ? undefined
          : q.dealerArchivedAt
            ? `${q.dealerName} · Dealer archived`
            : q.dealerName;
        return (
          <RowIdentityCell
            icon={<FileText className="size-4" />}
            iconTone="blue"
            label={quoteDisplayName(q.createdAt)}
            href={`/quotes/${q.id}`}
            sublabel={sublabel}
          />
        );
      },
      enableSorting: true,
    },
    {
      id: 'status',
      // Sort + filter on raw `QuoteStatus` so the toolbar's "Sent" pill
      // captures derived-expired rows too (their underlying row is
      // still status='sent'); the display key flips to 'expired' only
      // for the badge render.
      accessorFn: (q) => q.status,
      header: 'Status',
      filterFn: (row, _columnId, filterValue: string) => {
        if (!filterValue) return true;
        return row.original.status === filterValue;
      },
      cell: ({ row }) => <QuoteStatusBadge status={displayStatusKey(row.original)} />,
      enableSorting: true,
    },
    {
      id: 'total',
      accessorFn: (q) => Number(q.total) || 0,
      header: 'Total',
      cell: ({ row }) => (
        <span className="block text-right font-semibold tabular-nums">
          {fmtMoney(row.original.total)}
        </span>
      ),
      enableSorting: true,
    },
    {
      id: 'sentAt',
      accessorFn: (q) => (q.sentAt ? q.sentAt.toISOString() : ''),
      header: 'Sent',
      cell: ({ row }) =>
        row.original.sentAt ? (
          <RelativeTime value={row.original.sentAt} />
        ) : (
          <span className="text-zinc-500/70">—</span>
        ),
      enableSorting: true,
    },
    {
      id: 'createdAt',
      accessorFn: (q) => q.createdAt.toISOString(),
      header: 'Created',
      cell: ({ row }) => <RelativeTime value={row.original.createdAt} />,
      enableSorting: true,
    },
  ];
}
