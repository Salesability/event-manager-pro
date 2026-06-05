'use client';

import { Building2 } from 'lucide-react';
import type { ColumnDef } from '@tanstack/react-table';
import { Badge } from '@/components/catalyst/badge';
import { RowIdentityCell } from '@/components/app/row-identity-cell';
import { RowOverflowMenu } from '@/components/app/row-overflow-menu';
import { DealerStatusBadge } from '@/components/app/status-badge';
import { useCan } from '@/components/auth/can';
import type { Dealer } from '@/features/schedule/queries';

function composedContact(d: Dealer): string {
  return [d.contactFirstName, d.contactLastName].filter(Boolean).join(' ');
}

export type DealerColumnActions = {
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
          // Archived dealers route nowhere (`loadDealer` filters
          // `archivedAt IS NULL`), so render the chip + label flat —
          // no `<RowIdentityCell>` dotted-underline affordance.
          return (
            <div className="flex items-center gap-3">
              <Badge
                color="zinc"
                aria-hidden
                className="size-7! shrink-0 justify-center px-0! py-0!"
              >
                <Building2 className="size-4" />
              </Badge>
              <span className="truncate text-sm font-semibold text-zinc-500">
                {d.name}
              </span>
            </div>
          );
        }
        return (
          <RowIdentityCell
            icon={<Building2 className="size-4" />}
            iconTone="brand"
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
      // Catalyst's <Table> sets `whitespace-nowrap` table-wide, so without a
      // width cap a long email (or address, below) stretches the table past the
      // viewport and pushes Status + the row menu off-screen behind a horizontal
      // scrollbar. Cap + truncate; full value on hover (`title`) and the detail page.
      cell: ({ row }) =>
        row.original.primaryEmail ? (
          <span
            className="block max-w-[14rem] truncate text-xs text-zinc-500"
            title={row.original.primaryEmail}
          >
            {row.original.primaryEmail}
          </span>
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
      // Capped + truncated for the same reason as Email above (table-wide
      // `whitespace-nowrap`); full address on hover (`title`) and the detail page.
      cell: ({ row }) =>
        row.original.address ? (
          <span
            className="block max-w-[16rem] truncate text-xs text-zinc-500"
            title={row.original.address}
          >
            {row.original.address}
          </span>
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
  // Edit-default: row click → `/dealerships/[id]` (the editable detail page).
  // The identity cell IS the click-through affordance, so no separate `edit`
  // overflow entry. The overflow carries the rest: Quote (workflow-launch),
  // Activate (state flip on prospects), Archive (destructive).
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
          canArchive && {
            kind: 'archive',
            onClick: () => actions.onArchive(dealer),
            tone: 'danger',
          },
      ]}
    />
  );
}
