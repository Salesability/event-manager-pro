'use client';

import Link from 'next/link';
import type { ColumnDef } from '@tanstack/react-table';
import { Can } from '@/components/auth/can';
import type { Dealer } from '@/features/schedule/queries';

function composedContact(d: Dealer): string {
  return [d.contactFirstName, d.contactLastName].filter(Boolean).join(' ');
}

export type DealerColumnActions = {
  onEdit: (dealer: Dealer) => void;
  onArchive: (dealer: Dealer) => void;
  /** Optional — admin "Mark active" affordance shown on prospect rows. */
  onActivate?: (dealer: Dealer) => void;
};

const statusBadgeClass: Record<Dealer['status'], string> = {
  active:
    'rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700',
  prospect:
    'rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700',
};

export function buildDealersColumns(
  actions: DealerColumnActions,
): ColumnDef<Dealer>[] {
  return [
    {
      id: 'name',
      accessorKey: 'name',
      header: 'Name',
      cell: ({ row }) => {
        const d = row.original;
        // Archived dealers can't be loaded via `loadDealer` (which filters
        // `archivedAt IS NULL`), so a link would route to a guaranteed 404.
        // Render plain text instead until an archived-capable detail
        // loader exists.
        if (d.archivedAt) {
          return <span className="font-medium text-stone-500">{d.name}</span>;
        }
        return (
          <Link
            href={`/dealerships/${d.id}`}
            className="font-medium text-stone-800 transition hover:text-navy hover:underline"
          >
            {d.name}
          </Link>
        );
      },
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
      id: 'status',
      accessorKey: 'status',
      header: 'Status',
      cell: ({ row }) => {
        const d = row.original;
        if (d.archivedAt) {
          return (
            <span className="rounded-full bg-stone-200 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-stone-600">
              Archived
            </span>
          );
        }
        return <span className={statusBadgeClass[d.status]}>{d.status}</span>;
      },
      enableSorting: true,
    },
    {
      id: 'actions',
      header: '',
      cell: ({ row }) => {
        const d = row.original;
        const showActivate = !d.archivedAt && d.status === 'prospect' && actions.onActivate;
        return (
          <div className="flex shrink-0 items-center justify-end gap-1">
            {showActivate && (
              <Can capability="dealer:edit">
                <button
                  onClick={() => actions.onActivate!(d)}
                  className="rounded border border-emerald-200 bg-white px-2 py-0.5 text-xs font-semibold text-emerald-700 transition hover:border-emerald-400 hover:bg-emerald-50"
                >
                  Mark active
                </button>
              </Can>
            )}
            {!d.archivedAt && (
              <Can capability="quote:edit">
                <Link
                  href={`/quotes/new?dealerId=${d.id}`}
                  className="rounded border border-accent/40 bg-white px-2 py-0.5 text-xs font-semibold text-accent transition hover:border-accent hover:bg-accent/10"
                >
                  Quote
                </Link>
              </Can>
            )}
            {!d.archivedAt && (
              <Can capability="dealer:edit">
                <button
                  onClick={() => actions.onEdit(d)}
                  className="rounded border border-stone-200 bg-white px-2 py-0.5 text-xs font-medium text-stone-600 transition hover:border-navy hover:text-navy"
                >
                  Edit
                </button>
              </Can>
            )}
            {!d.archivedAt && (
              <Can capability="dealer:archive">
                <button
                  onClick={() => actions.onArchive(d)}
                  aria-label={`Remove ${d.name}`}
                  className="rounded border border-stone-200 bg-white px-2 py-0.5 text-xs font-bold text-status-red transition hover:border-status-red hover:bg-status-red/10 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  ✕
                </button>
              </Can>
            )}
          </div>
        );
      },
      enableSorting: false,
    },
  ];
}
