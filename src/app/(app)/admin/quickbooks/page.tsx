import { assertCan } from '@/lib/auth/assert-can';
import { PageHeader } from '@/components/app/page-header';
import { fetchCustomers, fetchItems, qboConfig, qboConfigured } from '@/lib/quickbooks/client';
import { getConnection, getValidAccessToken } from '@/lib/quickbooks/connection';
import {
  computeDealerSyncPlan,
  decodeSyncSummary,
  type SyncPlanRow,
} from '@/lib/quickbooks/dealer-sync';
import {
  computeItemSyncPlan,
  decodeItemSyncSummary,
  type ItemSyncPlanRow,
} from '@/lib/quickbooks/item-sync';
import {
  QuickbooksAdmin,
  type ConnectionView,
  type Notice,
} from '@/features/quickbooks/quickbooks-admin';
import { loadServiceItemsForAdmin } from '@/features/services/queries';
import { ServiceItemsList } from '@/features/services/service-items-list';

// 0068/0069 — admin in-app QuickBooks OAuth viewer turned dealer-sync surface.
// Gated on the pure-admin `admin:access` (mirrors `/admin/send-test-msa`),
// double-covered by the `/admin/*` middleware gate. Connect via OAuth, then
// live-read the connected company's customers and render the computed change set
// against our `dealers` (Create / Link / Already linked / Skip). The change set
// is computed READ-ONLY on load (`computeDealerSyncPlan`); the deliberate "Sync
// dealers" button applies it via the `syncDealersFromQuickbooks` Server Action.

type SearchParams = Record<string, string | string[] | undefined>;

export default async function QuickbooksAdminPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await assertCan('admin:access');
  const sp = await searchParams;

  // The local service catalog, read-only — shown regardless of QBO connection
  // (0072). Items are mastered in QuickBooks (0071); this is just visibility.
  const catalog = await loadServiceItemsForAdmin();

  // The callback route lands here with ?connected=1; the dealer sync with
  // ?synced=<c>.<l>.<s>; the item pull with ?itemsynced=<c>.<u>.<a>.<p>; any
  // with ?error=<message>.
  const synced = typeof sp.synced === 'string' ? decodeSyncSummary(sp.synced) : null;
  const itemSynced = typeof sp.itemsynced === 'string' ? decodeItemSyncSummary(sp.itemsynced) : null;
  const notice: Notice =
    typeof sp.error === 'string'
      ? { kind: 'error', message: sp.error }
      : synced
        ? {
            kind: 'success',
            message: `Synced dealers from QuickBooks — created ${synced.created} · linked ${synced.linked} · skipped ${synced.skipped}.`,
          }
        : itemSynced
          ? {
              kind: 'success',
              message: `Synced items from QuickBooks — created ${itemSynced.created} · updated ${itemSynced.updated} · archived ${itemSynced.archived} · purged ${itemSynced.purged}.`,
            }
          : sp.connected === '1'
            ? { kind: 'success', message: 'Connected to QuickBooks.' }
            : null;

  const conn = await getConnection();

  let connection: ConnectionView | null = null;
  let plan: SyncPlanRow[] | null = null;
  let fetchError: string | null = null;
  let itemPlan: ItemSyncPlanRow[] | null = null;
  let itemsFetchError: string | null = null;

  if (conn) {
    let env: 'sandbox' | 'production' | null = null;
    try {
      env = qboConfig().env;
    } catch {
      // Credentials not configured in this environment — surface it below.
    }
    connection = { realmId: conn.realmId, connectedAt: conn.updatedAt.toISOString(), env };

    let token: { realmId: string; accessToken: string } | null = null;
    try {
      token = await getValidAccessToken();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Could not refresh the QuickBooks token.';
      fetchError = msg;
      itemsFetchError = msg;
    }
    if (token) {
      try {
        const customers = await fetchCustomers(token.realmId, token.accessToken);
        plan = await computeDealerSyncPlan(customers);
      } catch (err) {
        fetchError =
          err instanceof Error ? err.message : 'Could not load customers from QuickBooks.';
      }
      try {
        const items = await fetchItems(token.realmId, token.accessToken);
        itemPlan = await computeItemSyncPlan(items);
      } catch (err) {
        itemsFetchError =
          err instanceof Error ? err.message : 'Could not load items from QuickBooks.';
      }
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="QuickBooks"
        description="Connect the business's QuickBooks Online company, reconcile its customers with your dealers, and pull its items into the quote-composer catalog."
      />
      <ServiceItemsList items={catalog} />
      <QuickbooksAdmin
        connection={connection}
        configured={qboConfigured()}
        plan={plan}
        fetchError={fetchError}
        itemPlan={itemPlan}
        itemsFetchError={itemsFetchError}
        notice={notice}
      />
    </div>
  );
}
