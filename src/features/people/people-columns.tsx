'use client';

import { User } from 'lucide-react';
import type { ColumnDef } from '@tanstack/react-table';
import { Badge } from '@/components/catalyst/badge';
import { RowIdentityCell } from '@/components/app/row-identity-cell';
import { RowOverflowMenu } from '@/components/app/row-overflow-menu';
import { useCan } from '@/components/auth/can';
import type {
  AdminPersonRow,
  DealerLink,
} from '@/features/people/queries';

function fmtDateTime(iso: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export type PeopleLifecycle = 'active' | 'banned' | 'inactive';

// Mirrors `lifecycle()` from people-admin.tsx so columns can sort by status
// without a round-trip through the consumer. Same three-state derivation:
// active facet → 'active'; auth user banned → 'banned'; nothing live → 'inactive'.
export function lifecycle(p: AdminPersonRow): PeopleLifecycle {
  if (p.hasAppAccess) {
    if (p.authUser?.bannedUntil) {
      const t = Date.parse(p.authUser.bannedUntil);
      if (Number.isFinite(t) && t >= Date.now()) return 'banned';
    }
    return 'active';
  }
  if (p.roles.length > 0 || p.dealerLinks.length > 0) return 'active';
  return 'inactive';
}

// Sort rank for the Roles column — admin first, then coach, then nothing.
// Tiebreak by displayName ASC at the table level (TanStack applies the
// multi-sort order from the click history; for a single-column header click
// we encode the rank as a primary signal and let the table's own row index
// break ties stably.)
function roleRank(p: AdminPersonRow): number {
  if (p.roles.includes('admin')) return 0;
  if (p.roles.includes('coach')) return 1;
  return 2;
}

export type PeopleColumnActions = {
  onEdit: (person: AdminPersonRow) => void;
  onArchive: (person: AdminPersonRow) => void;
};

export function buildPeopleColumns(
  actions: PeopleColumnActions,
): ColumnDef<AdminPersonRow>[] {
  return [
    {
      id: 'displayName',
      accessorKey: 'displayName',
      header: 'Name',
      // No `/admin/people/[id]` detail page today — the canonical editor
      // is the inline Edit dialog. Identity cell uses button-shape so
      // the dotted-underline click still routes to "the canonical
      // editor" per the edit-default doctrine.
      cell: ({ row }) => {
        const p = row.original;
        return (
          <RowIdentityCell
            icon={<User className="size-4" />}
            iconTone="brand"
            label={p.displayName}
            onClick={() => actions.onEdit(p)}
          />
        );
      },
      enableSorting: true,
    },
    {
      id: 'email',
      accessorFn: (p) => p.email ?? '',
      header: 'Email',
      cell: ({ row }) =>
        row.original.email ? (
          <span className="text-xs text-zinc-500">{row.original.email}</span>
        ) : (
          <span className="text-xs text-zinc-500/70">—</span>
        ),
      enableSorting: true,
    },
    {
      id: 'roles',
      accessorFn: (p) => roleRank(p),
      header: 'Roles',
      filterFn: (row, _columnId, filterValue: string[]) => {
        if (!Array.isArray(filterValue) || filterValue.length === 0) return true;
        return row.original.roles.some((r) => filterValue.includes(r));
      },
      cell: ({ row }) => {
        const p = row.original;
        if (p.roles.length === 0) {
          return <span className="text-xs text-zinc-500/70">—</span>;
        }
        return (
          <div className="flex flex-wrap gap-1">
            {p.roles.map((r) => (
              <Badge key={r} color={r === 'admin' || r === 'coach' ? 'brand' : 'zinc'}>
                {r}
              </Badge>
            ))}
          </div>
        );
      },
      enableSorting: true,
    },
    {
      id: 'dealerLinks',
      accessorFn: (p) => p.dealerLinks.length,
      header: 'Dealers',
      // Only filter we need today is "is a primary contact somewhere" (0089).
      // Generalize when a per-dealer filter shows up.
      filterFn: (row, _columnId, filterValue: string) => {
        if (filterValue !== 'has-primary') return true;
        return row.original.dealerLinks.some((l) => l.isPrimary);
      },
      cell: ({ row }) => {
        const p = row.original;
        if (p.dealerLinks.length === 0) {
          return <span className="text-xs text-zinc-500/70">—</span>;
        }
        return (
          <div className="flex flex-wrap gap-1">
            {p.dealerLinks.map((d: DealerLink, i: number) => {
              const label = d.title ?? (d.isPrimary ? 'Primary' : 'Contact');
              return (
                <Badge
                  key={`${d.dealerId}:${i}`}
                  color={d.isPrimary ? 'brand' : 'zinc'}
                  title={`${label}${d.isPrimary ? ' · primary' : ''} at ${d.dealerName}`}
                >
                  {d.dealerName} · {label}
                  {d.isPrimary && d.title ? ' · primary' : ''}
                </Badge>
              );
            })}
          </div>
        );
      },
      enableSorting: false,
    },
    {
      id: 'lastSignInAt',
      accessorFn: (p) => p.authUser?.lastSignInAt ?? null,
      header: 'Last sign-in',
      cell: ({ row }) => (
        <span className="text-xs text-zinc-500">
          {fmtDateTime(row.original.authUser?.lastSignInAt ?? null)}
        </span>
      ),
      enableSorting: true,
      sortingFn: (a, b) => {
        const av = a.original.authUser?.lastSignInAt ?? '';
        const bv = b.original.authUser?.lastSignInAt ?? '';
        return av.localeCompare(bv);
      },
    },
    {
      id: 'status',
      accessorFn: (p) => lifecycle(p),
      header: 'Status',
      cell: ({ row }) => {
        const status = lifecycle(row.original);
        return <Badge color={status === 'active' ? 'green' : 'zinc'}>{status}</Badge>;
      },
      enableSorting: true,
    },
    {
      id: 'actions',
      header: '',
      cell: ({ row }) => <PersonRowActions person={row.original} actions={actions} />,
      enableSorting: false,
    },
  ];
}

function PersonRowActions({
  person,
  actions,
}: {
  person: AdminPersonRow;
  actions: PeopleColumnActions;
}) {
  const canEdit = useCan('person:edit');
  const canArchive = useCan('person:archive');
  const status = lifecycle(person);
  const isActive = status === 'active';
  // Identity cell IS the Edit affordance (button-shape onClick fires
  // the dialog). Overflow menu carries Archive only — and only when
  // archive is currently meaningful (active lifecycle). `canEdit`
  // still gates the entire menu since archiving without edit is not
  // a coherent capability today.
  if (!canEdit) return null;
  return (
    <RowOverflowMenu
      ariaSuffix={person.displayName}
      actions={[
        isActive &&
          canArchive && {
            kind: 'archive',
            onClick: () => actions.onArchive(person),
            tone: 'danger',
          },
      ]}
    />
  );
}
