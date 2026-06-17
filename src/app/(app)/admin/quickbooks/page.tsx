import { assertCan } from '@/lib/auth/assert-can';
import { PageHeader } from '@/components/app/page-header';
import {
  fetchCompanyInfo,
  fetchCustomers,
  fetchItems,
  qboConfig,
  qboConfigured,
} from '@/lib/quickbooks/client';
import { getConnection, getValidAccessToken } from '@/lib/quickbooks/connection';
import { computeDealerSyncPlan, type SyncPlanRow } from '@/lib/quickbooks/dealer-sync';
import { computeItemSyncPlan, type ItemSyncPlanRow } from '@/lib/quickbooks/item-sync';
import { decodeQbSyncSummary, type QbSyncSummary } from '@/lib/quickbooks/qb-sync-summary';
import {
  QuickbooksAdmin,
  type ConnectionView,
  type Notice,
} from '@/features/quickbooks/quickbooks-admin';
import { loadServiceItemsForAdmin } from '@/features/services/queries';

// 0068/0069/0083 — admin in-app QuickBooks surface. Gated on the pure-admin
// `admin:access` (mirrors `/admin/send-test-msa`), double-covered by the
// `/admin/*` middleware gate. Connect via OAuth, then live-read the connected
// company's customers + items and render the computed change sets (dealers:
// Create / Link / Already linked / Skip; items: Create / Update / Archive /
// Purge) READ-ONLY on load. The single "Sync" button (0083) applies both via
// the `syncQuickbooks` Server Action and flashes one combined summary.

type SearchParams = Record<string, string | string[] | undefined>;

// Compose the one-sentence flash notice from the combined `?qbsync=` counts plus
// any per-part error (partial-report — a failed pass never discards the other's
// committed writes, so we report both outcomes).
function composeSyncNotice(
  s: QbSyncSummary,
  dealerError: string | null,
  itemError: string | null,
): string {
  const dealerPart = dealerError
    ? `dealers sync failed (${dealerError})`
    : `dealers: created ${s.dealers.created}, linked ${s.dealers.linked}, skipped ${s.dealers.skipped}`;
  const itemPart = itemError
    ? `items sync failed (${itemError})`
    : `items: created ${s.items.created}, updated ${s.items.updated}, archived ${s.items.archived}, purged ${s.items.purged}`;
  const lead = dealerError || itemError ? 'Synced with QuickBooks (with errors)' : 'Synced with QuickBooks';
  return `${lead} — ${dealerPart} · ${itemPart}.`;
}

export default async function QuickbooksAdminPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await assertCan('admin:access');
  const sp = await searchParams;

  // The local service catalog, read-only (0072). Items are mastered in
  // QuickBooks (0071); this is rendered inside the Items tab.
  const catalog = await loadServiceItemsForAdmin();

  // The callback route lands here with ?connected=1; the unified Sync (0083)
  // with ?qbsync=<c.l.s.c.u.a.p> + an optional ?qbderror=/?qbierror= per-part
  // message when a pass failed; any with ?error=<message>.
  const qbSync = typeof sp.qbsync === 'string' ? decodeQbSyncSummary(sp.qbsync) : null;
  const qbDealerError = typeof sp.qbderror === 'string' ? sp.qbderror : null;
  const qbItemError = typeof sp.qbierror === 'string' ? sp.qbierror : null;

  const notice: Notice =
    typeof sp.error === 'string'
      ? { kind: 'error', message: sp.error }
      : qbSync
        ? {
            kind: qbDealerError || qbItemError ? 'error' : 'success',
            message: composeSyncNotice(qbSync, qbDealerError, qbItemError),
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
    connection = {
      realmId: conn.realmId,
      connectedAt: conn.updatedAt.toISOString(),
      env,
      companyName: null,
    };

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
        // Best-effort — the bar falls back to the realm id if this fails.
        const info = await fetchCompanyInfo(token.realmId, token.accessToken);
        connection.companyName = info?.CompanyName?.trim() || info?.LegalName?.trim() || null;
      } catch {
        // leave companyName null
      }
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
        description="Connect the business's QuickBooks Online company, then press Sync to reconcile its customers with your dealers and mirror its items into the quote-composer catalog."
      />
      <QuickbooksAdmin
        connection={connection}
        configured={qboConfigured()}
        plan={plan}
        fetchError={fetchError}
        itemPlan={itemPlan}
        itemsFetchError={itemsFetchError}
        catalog={catalog}
        notice={notice}
      />
    </div>
  );
}
