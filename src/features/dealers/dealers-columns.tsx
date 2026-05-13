'use client';

import Link from 'next/link';
import type { ColumnDef } from '@tanstack/react-table';
import { RowActions } from '@/components/app/row-actions';
import { DealerStatusBadge } from '@/components/app/status-badge';
import { useCan } from '@/components/auth/can';
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
      cell: ({ row }) => (
        <DealerStatusBadge
          status={row.original.status}
          archivedAt={row.original.archivedAt}
        />
      ),
      enableSorting: true,
    },
    {
      id: 'actions',
      header: '',
      cell: ({ row }) => <DealerRowActions dealer={row.original} actions={actions} />,
      enableSorting: false,
    },
  ];
}

function DealerRowActions({
  dealer,
  actions,
}: {
  dealer: Dealer;
  actions: DealerColumnActions;
}) {
  const canEdit = useCan('dealer:edit');
  const canArchive = useCan('dealer:archive');
  const canQuote = useCan('quote:edit');
  const showActivate =
    !dealer.archivedAt && dealer.status === 'prospect' && actions.onActivate != null;
  const archived = dealer.archivedAt != null;
  return (
    <RowActions
      actions={[
        !archived && {
          kind: 'view',
          href: `/dealerships/${dealer.id}`,
          ariaSuffix: dealer.name,
        },
        !archived &&
          canQuote && {
            kind: 'quote',
            href: `/quotes/new?dealerId=${dealer.id}`,
            tone: 'accent',
            ariaSuffix: `for ${dealer.name}`,
          },
        showActivate &&
          canEdit && {
            kind: 'activate',
            onClick: () => actions.onActivate!(dealer),
            tone: 'success',
            ariaSuffix: dealer.name,
          },
        !archived &&
          canEdit && {
            kind: 'edit',
            onClick: () => actions.onEdit(dealer),
            ariaSuffix: dealer.name,
          },
        !archived &&
          canArchive && {
            kind: 'archive',
            onClick: () => actions.onArchive(dealer),
            tone: 'danger',
            ariaSuffix: dealer.name,
          },
      ]}
    />
  );
}
