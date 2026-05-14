'use client';

import type { ColumnDef } from '@tanstack/react-table';
import { RowActions } from '@/components/app/row-actions';
import { useCan } from '@/components/auth/can';
import type {
  AdminPersonRow,
  DealerLink,
} from '@/features/people/queries';

const chipBase =
  'inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide';

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
      cell: ({ row }) => (
        <div className="font-medium text-zinc-900">{row.original.displayName}</div>
      ),
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
        const chips: React.ReactNode[] = [];
        for (const r of p.roles) {
          chips.push(
            <span
              key={r}
              className={`${chipBase} ${
                r === 'admin'
                  ? 'bg-brand-100 text-brand-700'
                  : r === 'coach'
                    ? 'bg-brand-50 text-brand-700'
                    : 'bg-zinc-100 text-zinc-500'
              }`}
            >
              {r}
            </span>,
          );
        }
        if (chips.length === 0) {
          return <span className="text-xs text-zinc-500/70">—</span>;
        }
        return <div className="flex flex-wrap gap-1">{chips}</div>;
      },
      enableSorting: true,
    },
    {
      id: 'dealerLinks',
      accessorFn: (p) => p.dealerLinks.length,
      header: 'Dealers',
      // Only filter we need today is "has any customer-side relationship".
      // Generalize when a per-dealer filter shows up.
      filterFn: (row, _columnId, filterValue: string) => {
        if (filterValue !== 'has-customer') return true;
        return row.original.dealerLinks.some((l) => l.role === 'customer');
      },
      cell: ({ row }) => {
        const p = row.original;
        if (p.dealerLinks.length === 0) {
          return <span className="text-xs text-zinc-500/70">—</span>;
        }
        return (
          <div className="flex flex-wrap gap-1">
            {p.dealerLinks.map((d: DealerLink, i: number) => (
              <span
                key={`${d.dealerId}:${d.role}:${i}`}
                className={`${chipBase} bg-zinc-100 text-zinc-500`}
                title={`${d.role} at ${d.dealerName}`}
              >
                {d.dealerName} · {d.role}
              </span>
            ))}
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
        return (
          <span
            className={`${chipBase} ${
              status === 'active'
                ? 'bg-status-green/15 text-status-green'
                : 'bg-zinc-100 text-zinc-500'
            }`}
          >
            {status}
          </span>
        );
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
  return (
    <RowActions
      actions={[
        canEdit && {
          kind: 'edit',
          onClick: () => actions.onEdit(person),
          ariaSuffix: person.displayName,
        },
        isActive &&
          canArchive && {
            kind: 'archive',
            onClick: () => actions.onArchive(person),
            tone: 'danger',
            ariaSuffix: person.displayName,
          },
      ]}
    />
  );
}
