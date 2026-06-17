import { Badge } from '@/components/catalyst/badge';
import { Button } from '@/components/catalyst/button';
import { Link } from '@/components/catalyst/link';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/catalyst/table';
import type { SyncAction, SyncPlanRow } from '@/lib/quickbooks/dealer-sync';
import type { ItemSyncAction, ItemSyncPlanRow } from '@/lib/quickbooks/item-sync';
import { ServiceItemsList } from '@/features/services/service-items-list';
import type { ServiceItemAdminRow } from '@/features/services/queries';
import { connectQuickbooks, disconnectQuickbooks, syncQuickbooks } from './actions';
import { QuickbooksTabs } from './quickbooks-tabs';

// QuickBooks admin surface (chunks 0068/0069/0071/0072, reorganized by 0083).
// Server component — connect/disconnect/sync controls are `<form action=…>` so
// no client JS is needed here. The connection bar sits FIRST; one "Sync" button
// reconciles dealers AND mirrors items in a single click (`syncQuickbooks`). The
// per-section detail (dealer change set + item catalog/diff) renders below the
// bar. Plans are computed READ-ONLY on the page; nothing here writes.

export type ConnectionView = {
  realmId: string;
  connectedAt: string; // ISO; the row's updated_at (= last token refresh)
  env: 'sandbox' | 'production' | null;
};

export type Notice = { kind: 'error' | 'success'; message: string } | null;

type Props = {
  connection: ConnectionView | null;
  configured: boolean;
  plan: SyncPlanRow[] | null;
  fetchError: string | null;
  itemPlan: ItemSyncPlanRow[] | null;
  itemsFetchError: string | null;
  catalog: ServiceItemAdminRow[];
  notice: Notice;
};

const ACTION_BADGE: Record<SyncAction, { color: 'blue' | 'amber' | 'lime' | 'red'; label: string }> = {
  create: { color: 'blue', label: 'Create' },
  link: { color: 'amber', label: 'Link' },
  'already-linked': { color: 'lime', label: 'Already linked' },
  'skip-collision': { color: 'red', label: 'Skip' },
};

function ActionBadge({ row }: { row: SyncPlanRow }) {
  const { color, label } = ACTION_BADGE[row.action];
  // `Link → #N` names the existing dealer the QB id backfills onto; the other
  // actions need no target.
  const suffix = row.action === 'link' && row.dealerId != null ? ` → #${row.dealerId}` : '';
  return (
    <Badge color={color}>
      {label}
      {suffix}
    </Badge>
  );
}

const ITEM_ACTION_BADGE: Record<
  ItemSyncAction,
  { color: 'blue' | 'amber' | 'lime' | 'red' | 'zinc'; label: string }
> = {
  create: { color: 'blue', label: 'Create' },
  update: { color: 'amber', label: 'Update' },
  current: { color: 'lime', label: 'Current' },
  archive: { color: 'zinc', label: 'Archive' },
  purge: { color: 'red', label: 'Purge' },
  skip: { color: 'zinc', label: 'Skip' },
};

function ConnectButton({ label }: { label: string }) {
  return (
    <form action={connectQuickbooks}>
      <Button type="submit" color="brand">
        {label}
      </Button>
    </form>
  );
}

// The dealer reconcile change set (one row per QB customer). Server-rendered;
// moved out of the page body so it can become a tab panel (0083 Phase 3).
function DealersPanel({
  plan,
  counts,
  actionable,
}: {
  plan: SyncPlanRow[] | null;
  counts: Record<SyncAction, number>;
  actionable: number;
}) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-zinc-500">
        {plan?.length ?? 0} customers · {counts.create} create · {counts.link} link ·{' '}
        {counts['already-linked']} already linked · {counts['skip-collision']} skip
        {actionable === 0 && plan && plan.length > 0 ? ' — dealers are up to date.' : ''}
      </p>
      <Table dense className="[--gutter:--spacing(6)]">
        <TableHead>
          <TableRow>
            <TableHeader>Company</TableHeader>
            <TableHeader>Email</TableHeader>
            <TableHeader>Phone</TableHeader>
            <TableHeader>Action</TableHeader>
          </TableRow>
        </TableHead>
        <TableBody>
          {(plan ?? []).map((row) => (
            <TableRow key={row.qbId}>
              <TableCell className="font-medium text-zinc-900">{row.company}</TableCell>
              <TableCell className="text-zinc-500">{row.email ?? '—'}</TableCell>
              <TableCell className="text-zinc-500">{row.phone ?? '—'}</TableCell>
              <TableCell>
                <ActionBadge row={row} />
              </TableCell>
            </TableRow>
          ))}
          {(plan?.length ?? 0) === 0 && (
            <TableRow>
              <TableCell colSpan={4} className="text-zinc-500">
                No customers found in the connected QuickBooks company.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}

// The local catalog (read-only mirror) + the pending QBO mirror diff. Items are
// mastered in QuickBooks (0071); the unified Sync button above applies the diff.
function ItemsPanel({
  itemPlan,
  itemsFetchError,
  itemCounts,
  itemsActionable,
  catalog,
}: {
  itemPlan: ItemSyncPlanRow[] | null;
  itemsFetchError: string | null;
  itemCounts: Record<ItemSyncAction, number>;
  itemsActionable: number;
  catalog: ServiceItemAdminRow[];
}) {
  return (
    <div className="flex flex-col gap-4">
      <ServiceItemsList items={catalog} />

      {itemsFetchError ? (
        <div className="flex flex-col items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-6">
          <p className="text-sm font-medium text-amber-900">Couldn&apos;t load items</p>
          <p className="text-sm text-amber-800">{itemsFetchError}</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-zinc-500">
            {itemPlan?.length ?? 0} items · {itemCounts.create} create · {itemCounts.update} update ·{' '}
            {itemCounts.archive} archive · {itemCounts.purge} purge
            {itemsActionable === 0 && itemPlan && itemPlan.length > 0
              ? ' — catalog matches QuickBooks.'
              : ''}
          </p>
          <Table dense className="[--gutter:--spacing(6)]">
            <TableHead>
              <TableRow>
                <TableHeader>Code</TableHeader>
                <TableHeader>Label</TableHeader>
                <TableHeader>Price</TableHeader>
                <TableHeader>Action</TableHeader>
              </TableRow>
            </TableHead>
            <TableBody>
              {(itemPlan ?? [])
                .filter((row) => row.action !== 'current')
                .map((row, i) => (
                  <TableRow key={`${row.qbId ?? row.serviceItemId ?? row.code}-${i}`}>
                    <TableCell className="font-mono text-xs text-zinc-700">{row.code}</TableCell>
                    <TableCell className="font-medium text-zinc-900">{row.label}</TableCell>
                    <TableCell className="text-zinc-500">
                      {row.unitPrice != null ? `$${row.unitPrice}` : '—'}
                    </TableCell>
                    <TableCell>
                      <Badge color={ITEM_ACTION_BADGE[row.action].color}>
                        {ITEM_ACTION_BADGE[row.action].label}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              {(itemPlan?.length ?? 0) === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="text-zinc-500">
                    No items found in the connected QuickBooks company.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

export function QuickbooksAdmin({
  connection,
  configured,
  plan,
  fetchError,
  itemPlan,
  itemsFetchError,
  catalog,
  notice,
}: Props) {
  const counts = (plan ?? []).reduce(
    (acc, row) => {
      acc[row.action]++;
      return acc;
    },
    { create: 0, link: 0, 'already-linked': 0, 'skip-collision': 0 } as Record<SyncAction, number>,
  );
  const actionable = counts.create + counts.link;

  const itemCounts = (itemPlan ?? []).reduce(
    (acc, row) => {
      acc[row.action]++;
      return acc;
    },
    { create: 0, update: 0, current: 0, archive: 0, purge: 0, skip: 0 } as Record<
      ItemSyncAction,
      number
    >,
  );
  const itemsActionable =
    itemCounts.create + itemCounts.update + itemCounts.archive + itemCounts.purge;

  return (
    <div className="flex flex-col gap-6">
      {notice && (
        <p
          className={
            notice.kind === 'error'
              ? 'rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800'
              : 'rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800'
          }
        >
          {notice.message}
        </p>
      )}

      {!connection ? (
        <div className="flex flex-col items-start gap-3 rounded-xl border border-zinc-200 bg-white p-6">
          <div className="space-y-1">
            <p className="text-sm font-medium text-zinc-900">Not connected</p>
            <p className="text-sm text-zinc-500">
              Connect the business&apos;s QuickBooks Online company to reconcile its customers with your
              dealers and mirror its items. Reading is non-destructive — nothing changes until you press
              Sync.
            </p>
          </div>
          {configured ? (
            <ConnectButton label="Connect to QuickBooks" />
          ) : (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              QuickBooks credentials aren&apos;t set. Add <code className="font-mono">QBO_CLIENT_ID</code>,{' '}
              <code className="font-mono">QBO_CLIENT_SECRET</code> and{' '}
              <code className="font-mono">QBO_TOKEN_ENC_KEY</code> to <code className="font-mono">.env.local</code>{' '}
              (then restart the dev server) before connecting.
            </p>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {/* Connection bar — first on the page (0083). One "Sync" reconciles
              dealers + mirrors items; Disconnect stays as the secondary control. */}
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-zinc-200 bg-white p-6">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <Badge color="lime">Connected</Badge>
                {connection.env && <Badge color="zinc">{connection.env}</Badge>}
              </div>
              <p className="text-sm text-zinc-500">
                Company realm <code className="font-mono">{connection.realmId}</code> · token last refreshed{' '}
                {new Date(connection.connectedAt).toLocaleString()}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {!fetchError && (
                <form action={syncQuickbooks}>
                  <Button type="submit" color="brand">
                    Sync
                  </Button>
                </form>
              )}
              <form action={disconnectQuickbooks}>
                <Button type="submit" outline>
                  Disconnect
                </Button>
              </form>
            </div>
          </div>

          {fetchError ? (
            <div className="flex flex-col items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-6">
              <div className="space-y-1">
                <p className="text-sm font-medium text-amber-900">Couldn&apos;t load customers</p>
                <p className="text-sm text-amber-800">{fetchError}</p>
                <p className="text-sm text-amber-800">
                  The connection may have expired — try reconnecting.
                </p>
              </div>
              <ConnectButton label="Reconnect" />
            </div>
          ) : (
            <>
              {/* Dealers / Items detail in tabs — only the switcher is client;
                  both panels are server-rendered and passed in as props. */}
              <QuickbooksTabs
                dealers={<DealersPanel plan={plan} counts={counts} actionable={actionable} />}
                items={
                  <ItemsPanel
                    itemPlan={itemPlan}
                    itemsFetchError={itemsFetchError}
                    itemCounts={itemCounts}
                    itemsActionable={itemsActionable}
                    catalog={catalog}
                  />
                }
              />

              {/* Tax-code mapping deliberately lives at /admin/lookups (0076) —
                  no Tax tab here, just a pointer. */}
              <p className="text-sm text-zinc-500">
                Tax codes are managed in{' '}
                <Link
                  href="/admin/lookups"
                  className="font-medium text-brand-700 hover:text-brand-800"
                >
                  Lookups →
                </Link>
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
