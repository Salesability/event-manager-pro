import { Badge } from '@/components/catalyst/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/catalyst/table';
import type { ServiceItemAdminRow } from './queries';

// Read-only view of the `service_items` catalog (chunk 0072). Items are mastered
// in QuickBooks since 0071 — there is no edit/create/delete here; this section
// just restores visibility of the catalog (the /admin/lookups editor was
// removed). Server component, no client JS, no buttons/forms.
export function ServiceItemsList({ items }: { items: ServiceItemAdminRow[] }) {
  const linked = items.filter((i) => i.quickbooksId).length;
  const archived = items.filter((i) => i.archivedAt).length;

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-zinc-200 bg-white p-6">
      <div className="space-y-1">
        <h2 className="text-sm font-semibold text-zinc-900">Service items</h2>
        <p className="text-sm text-zinc-500">
          {items.length} items · {linked} linked to QuickBooks · {archived} archived. Items are
          mastered in QuickBooks — use the Sync button above to refresh the catalog from QuickBooks.
        </p>
      </div>

      <Table dense className="[--gutter:--spacing(6)]">
        <TableHead>
          <TableRow>
            <TableHeader>Code</TableHeader>
            <TableHeader>Label</TableHeader>
            <TableHeader>Price</TableHeader>
            <TableHeader>QuickBooks</TableHeader>
            <TableHeader>Status</TableHeader>
          </TableRow>
        </TableHead>
        <TableBody>
          {items.map((it) => (
            <TableRow key={it.id}>
              <TableCell className="font-mono text-xs text-zinc-700">{it.code}</TableCell>
              <TableCell className="font-medium text-zinc-900">{it.label}</TableCell>
              <TableCell className="text-zinc-500">
                {it.unitPrice != null ? `$${it.unitPrice}` : 'variable'}
              </TableCell>
              <TableCell>
                {it.quickbooksId ? (
                  <Badge color="lime">Linked</Badge>
                ) : (
                  <span className="text-zinc-400">—</span>
                )}
              </TableCell>
              <TableCell>
                {it.archivedAt ? <Badge color="zinc">Archived</Badge> : <Badge color="blue">Active</Badge>}
              </TableCell>
            </TableRow>
          ))}
          {items.length === 0 && (
            <TableRow>
              <TableCell colSpan={5} className="text-zinc-500">
                No service items in the catalog.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
