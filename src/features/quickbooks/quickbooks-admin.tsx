import { Badge } from '@/components/catalyst/badge';
import { Button } from '@/components/catalyst/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/catalyst/table';
import type { QboCustomer } from '@/lib/quickbooks/client';
import { connectQuickbooks, disconnectQuickbooks } from './actions';

// Read-only QuickBooks viewer UI (chunk 0068). Server component — the
// connect/disconnect controls are `<form action={serverAction}>` so no client
// JS is needed. `connectQuickbooks` redirects to Intuit; `disconnectQuickbooks`
// revalidates this route in place. NO DB writes happen here — `customers` is a
// live read passed down from the page.

export type ConnectionView = {
  realmId: string;
  connectedAt: string; // ISO; the row's updated_at (= last token refresh)
  env: 'sandbox' | 'production' | null;
};

export type Notice = { kind: 'error' | 'success'; message: string } | null;

type Props = {
  connection: ConnectionView | null;
  configured: boolean;
  customers: QboCustomer[] | null;
  fetchError: string | null;
  notice: Notice;
};

function company(c: QboCustomer): string {
  return c.CompanyName ?? c.DisplayName ?? '—';
}
function email(c: QboCustomer): string {
  return c.PrimaryEmailAddr?.Address ?? '—';
}
function phone(c: QboCustomer): string {
  return c.PrimaryPhone?.FreeFormNumber ?? c.Mobile?.FreeFormNumber ?? '—';
}

function ConnectButton({ label }: { label: string }) {
  return (
    <form action={connectQuickbooks}>
      <Button type="submit" color="green">
        {label}
      </Button>
    </form>
  );
}

export function QuickbooksAdmin({ connection, configured, customers, fetchError, notice }: Props) {
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
              Connect the business&apos;s QuickBooks Online company to view its customer list. Read-only —
              this never changes anything in QuickBooks.
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
            <form action={disconnectQuickbooks}>
              <Button type="submit" outline>
                Disconnect
              </Button>
            </form>
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
            <div className="flex flex-col gap-3">
              <p className="text-sm text-zinc-500">
                Customers ({customers?.length ?? 0})
              </p>
              <Table dense className="[--gutter:--spacing(6)]">
                <TableHead>
                  <TableRow>
                    <TableHeader>Company</TableHeader>
                    <TableHeader>Email</TableHeader>
                    <TableHeader>Phone</TableHeader>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {(customers ?? []).map((c) => (
                    <TableRow key={c.Id}>
                      <TableCell className="font-medium text-zinc-900">{company(c)}</TableCell>
                      <TableCell className="text-zinc-500">{email(c)}</TableCell>
                      <TableCell className="text-zinc-500">{phone(c)}</TableCell>
                    </TableRow>
                  ))}
                  {(customers?.length ?? 0) === 0 && (
                    <TableRow>
                      <TableCell colSpan={3} className="text-zinc-500">
                        No customers found in the connected QuickBooks company.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
