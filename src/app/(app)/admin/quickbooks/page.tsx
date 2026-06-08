import { assertCan } from '@/lib/auth/assert-can';
import { PageHeader } from '@/components/app/page-header';
import { fetchCustomers, qboConfig, qboConfigured, type QboCustomer } from '@/lib/quickbooks/client';
import { getConnection, getValidAccessToken } from '@/lib/quickbooks/connection';
import {
  QuickbooksAdmin,
  type ConnectionView,
  type Notice,
} from '@/features/quickbooks/quickbooks-admin';

// 0068 — admin in-app QuickBooks OAuth read-only viewer. Gated on the
// pure-admin `admin:access` (mirrors `/admin/send-test-msa`), double-covered by
// the `/admin/*` middleware gate. Connect via OAuth, then live-read and display
// the connected company's customers. NO DB writes — the import-to-dealers path
// stays the `scripts/import-from-quickbooks.ts` one-time script (chunk 0060).

type SearchParams = Record<string, string | string[] | undefined>;

export default async function QuickbooksAdminPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await assertCan('admin:access');
  const sp = await searchParams;

  // The callback route lands here with ?connected=1 or ?error=<message>.
  const notice: Notice =
    typeof sp.error === 'string'
      ? { kind: 'error', message: sp.error }
      : sp.connected === '1'
        ? { kind: 'success', message: 'Connected to QuickBooks.' }
        : null;

  const conn = await getConnection();

  let connection: ConnectionView | null = null;
  let customers: QboCustomer[] | null = null;
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
      customers = await fetchCustomers(realmId, accessToken);
    } catch (err) {
      fetchError = err instanceof Error ? err.message : 'Could not load customers from QuickBooks.';
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="QuickBooks"
        description="Connect the business's QuickBooks Online company and view its customers (read-only)."
      />
      <QuickbooksAdmin
        connection={connection}
        configured={qboConfigured()}
        customers={customers}
        fetchError={fetchError}
        notice={notice}
      />
    </div>
  );
}
