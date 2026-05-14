'use client';

import { Building2 } from 'lucide-react';
import type { ColumnDef } from '@tanstack/react-table';
import { RowIdentityCell } from '@/components/app/row-identity-cell';
import { RowOverflowMenu } from '@/components/app/row-overflow-menu';
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
        // Render the identity cell with a plain-text label until an
        // archived-capable detail loader exists.
        if (d.archivedAt) {
          return (
            <div className="flex items-center gap-3">
              <span
                aria-hidden
                className="inline-flex size-7 shrink-0 items-center justify-center rounded-md bg-zinc-100 text-zinc-400"
              >
                <Building2 className="size-4" />
              </span>
              <span className="truncate text-sm font-semibold text-zinc-500">
                {d.name}
              </span>
            </div>
          );
        }
        return (
          <RowIdentityCell
            icon={<Building2 className="size-4" />}
            iconTone="blue"
            label={d.name}
            href={`/dealerships/${d.id}`}
          />
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
          <span className="text-xs text-zinc-900">{name}</span>
        ) : (
          <span className="text-xs text-zinc-500/70">—</span>
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
          <span className="text-xs text-zinc-500">{row.original.primaryEmail}</span>
        ) : (
          <span className="text-xs text-zinc-500/70">—</span>
        ),
      enableSorting: true,
    },
    {
      id: 'phone',
      accessorFn: (d) => d.primaryPhone ?? '',
      header: 'Phone',
      cell: ({ row }) =>
        row.original.primaryPhone ? (
          <span className="text-xs text-zinc-500">{row.original.primaryPhone}</span>
        ) : (
          <span className="text-xs text-zinc-500/70">—</span>
        ),
      enableSorting: false,
    },
    {
      id: 'address',
      accessorFn: (d) => d.address ?? '',
      header: 'Address',
      cell: ({ row }) =>
        row.original.address ? (
          <span className="text-xs text-zinc-500">{row.original.address}</span>
        ) : (
          <span className="text-xs text-zinc-500/70">—</span>
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
  // Edit-default: row click → `/dealerships/[id]`; the View action has
  // retired (the identity cell IS the click-through affordance). The
  // overflow menu carries everything else: Quote (workflow-launch),
  // Activate (state flip on prospects), Edit (canonical editor dialog
  // for now — full editable-detail-page conversion is a follow-up),
  // Archive (destructive).
  return (
    <RowOverflowMenu
      ariaSuffix={dealer.name}
      actions={[
        !archived &&
          canQuote && {
            kind: 'quote',
            href: `/quotes/new?dealerId=${dealer.id}`,
          },
        showActivate &&
          canEdit && {
            kind: 'activate',
            onClick: () => actions.onActivate!(dealer),
          },
        !archived &&
          canEdit && {
            kind: 'edit',
            onClick: () => actions.onEdit(dealer),
          },
        !archived &&
          canArchive && {
            kind: 'archive',
            onClick: () => actions.onArchive(dealer),
            tone: 'danger',
          },
      ]}
    />
  );
}
