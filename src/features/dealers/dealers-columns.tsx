'use client';

import type { ColumnDef } from '@tanstack/react-table';
import { Can } from '@/components/auth/can';
import type { Dealer } from '@/features/schedule/queries';

function composedContact(d: Dealer): string {
  return [d.contactFirstName, d.contactLastName].filter(Boolean).join(' ');
}

export type DealerColumnActions = {
  onEdit: (dealer: Dealer) => void;
  onArchive: (dealer: Dealer) => void;
};

export function buildDealersColumns(
  actions: DealerColumnActions,
): ColumnDef<Dealer>[] {
  return [
    {
      id: 'name',
      accessorKey: 'name',
      header: 'Name',
      cell: ({ row }) => (
        <div className="font-medium text-stone-800">{row.original.name}</div>
      ),
      enableSorting: true,
    },
    {
      id: 'contact',
      accessorFn: (d) => composedContact(d),
      header: 'Contact',
      cell: ({ row }) => {
        const name = composedContact(row.original);
        return name ? (
          <span className="text-xs text-stone-700">{name}</span>
        ) : (
          <span className="text-xs text-stone-400">—</span>
        );
      },
      enableSorting: true,
    },
    {
      id: 'email',
      accessorFn: (d) => d.primaryEmail ?? '',
      header: 'Email',
      cell: ({ row }) =>
        row.original.primaryEmail ? (
          <span className="text-xs text-stone-600">{row.original.primaryEmail}</span>
        ) : (
          <span className="text-xs text-stone-400">—</span>
        ),
      enableSorting: true,
    },
    {
      id: 'phone',
      accessorFn: (d) => d.primaryPhone ?? '',
      header: 'Phone',
      cell: ({ row }) =>
        row.original.primaryPhone ? (
          <span className="text-xs text-stone-600">{row.original.primaryPhone}</span>
        ) : (
          <span className="text-xs text-stone-400">—</span>
        ),
      enableSorting: false,
    },
    {
      id: 'address',
      accessorFn: (d) => d.address ?? '',
      header: 'Address',
      cell: ({ row }) =>
        row.original.address ? (
          <span className="text-xs text-stone-600">{row.original.address}</span>
        ) : (
          <span className="text-xs text-stone-400">—</span>
        ),
      enableSorting: false,
    },
    {
      id: 'actions',
      header: '',
      cell: ({ row }) => {
        const d = row.original;
        return (
          <div className="flex shrink-0 items-center justify-end gap-1">
            <Can capability="dealer:edit">
              <button
                onClick={() => actions.onEdit(d)}
                className="rounded border border-stone-200 bg-white px-2 py-0.5 text-xs font-medium text-stone-600 transition hover:border-navy hover:text-navy"
              >
                Edit
              </button>
            </Can>
            <Can capability="dealer:archive">
              <button
                onClick={() => actions.onArchive(d)}
                aria-label={`Remove ${d.name}`}
                className="rounded border border-stone-200 bg-white px-2 py-0.5 text-xs font-bold text-status-red transition hover:border-status-red hover:bg-status-red/10 disabled:cursor-not-allowed disabled:opacity-50"
              >
                ✕
              </button>
            </Can>
          </div>
        );
      },
      enableSorting: false,
    },
  ];
}
