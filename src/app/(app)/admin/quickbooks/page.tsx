import { assertCan } from '@/lib/auth/assert-can';
import { PageHeader } from '@/components/app/page-header';
import { fetchCustomers, qboConfig, qboConfigured } from '@/lib/quickbooks/client';
import { getConnection, getValidAccessToken } from '@/lib/quickbooks/connection';
import {
  computeDealerSyncPlan,
  decodeSyncSummary,
  type SyncPlanRow,
} from '@/lib/quickbooks/dealer-sync';
import {
  QuickbooksAdmin,
  type ConnectionView,
  type Notice,
} from '@/features/quickbooks/quickbooks-admin';

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

  // The callback route lands here with ?connected=1; the sync action with
  // ?synced=<created>.<linked>.<skipped>; either with ?error=<message>.
  const synced = typeof sp.synced === 'string' ? decodeSyncSummary(sp.synced) : null;
  const notice: Notice =
    typeof sp.error === 'string'
      ? { kind: 'error', message: sp.error }
      : synced
        ? {
            kind: 'success',
            message: `Synced dealers from QuickBooks — created ${synced.created} · linked ${synced.linked} · skipped ${synced.skipped}.`,
          }
        : sp.connected === '1'
          ? { kind: 'success', message: 'Connected to QuickBooks.' }
          : null;

  const conn = await getConnection();

  let connection: ConnectionView | null = null;
  let plan: SyncPlanRow[] | null = null;
  let fetchError: string | null = null;

  if (conn) {
    let env: 'sandbox' | 'production' | null = null;
    try {
      env = qboConfig().env;
    } catch {
      // Credentials not configured in this environment — surface it below.
    }
    connection = { realmId: conn.realmId, connectedAt: conn.updatedAt.toISOString(), env };
    try {
      const { realmId, accessToken } = await getValidAccessToken();
      const customers = await fetchCustomers(realmId, accessToken);
      plan = await computeDealerSyncPlan(customers);
    } catch (err) {
      fetchError = err instanceof Error ? err.message : 'Could not load customers from QuickBooks.';
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="QuickBooks"
        description="Connect the business's QuickBooks Online company and reconcile its customers with your dealers."
      />
      <QuickbooksAdmin
        connection={connection}
        configured={qboConfigured()}
        plan={plan}
        fetchError={fetchError}
        notice={notice}
      />
    </div>
  );
}
