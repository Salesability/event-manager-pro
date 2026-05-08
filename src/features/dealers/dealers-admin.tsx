'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { FilterFn } from '@tanstack/react-table';
import { Can } from '@/components/auth/can';
import { Dialog } from '@/components/ui/dialog';
import { DataTable } from '@/components/ui/data-table';
import { toast } from '@/components/ui/toaster';
import { archiveDealer } from '@/features/schedule/actions';
import type { Dealer } from '@/features/schedule/queries';
import { buildDealersColumns } from '@/features/dealers/dealers-columns';
import { DealerForm } from '@/features/dealers/dealer-form';

const dealersGlobalFilterFn: FilterFn<Dealer> = (row, _columnId, filterValue) => {
  const q = String(filterValue ?? '').toLowerCase().trim();
  if (!q) return true;
  const d = row.original;
  if (d.name.toLowerCase().includes(q)) return true;
  const contact = [d.contactFirstName, d.contactLastName]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  if (contact.includes(q)) return true;
  if (d.primaryEmail && d.primaryEmail.toLowerCase().includes(q)) return true;
  if (d.primaryPhone && d.primaryPhone.toLowerCase().includes(q)) return true;
  if (d.address && d.address.toLowerCase().includes(q)) return true;
  return false;
};

const headerAddClass =
  'rounded-lg border border-accent/40 bg-white px-3 py-1 text-xs font-semibold text-accent transition hover:border-accent hover:bg-accent/10';

// Compose the archive confirm message from the row's facets, mirroring the
// people-admin pattern. Counts (linked contacts, referenced campaigns) aren't
// surfaced on the Dealer row today — once `loadDealers` denormalises them,
// the message can list specifics. Until then it states the soft-delete
// guarantee in plain language: archive sets `dealers.archivedAt` (no cascade,
// no hard-delete), existing campaign references survive in the database, and
// the dealer disappears from active staff surfaces (the People page filters
// archived dealers via `isNull(dealers.archivedAt)`).
function buildArchiveConfirmMessage(dealer: Dealer): string {
  return `Archive ${dealer.name}? Existing campaigns keep their reference. Contact-link rows are preserved in history but the dealer disappears from the People page and Dealer pickers. Continue?`;
}

export function DealersAdmin({ dealers }: { dealers: Dealer[] }) {
  const router = useRouter();
  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState<Dealer | null>(null);
  const [globalFilter, setGlobalFilter] = useState('');
  const [, startTransition] = useTransition();

  const isFiltered = globalFilter.trim().length > 0;
  const clearFilters = () => setGlobalFilter('');

  function archive(dealer: Dealer) {
    if (!confirm(buildArchiveConfirmMessage(dealer))) {
      return;
    }
    startTransition(async () => {
      const fd = new FormData();
      fd.set('id', String(dealer.id));
      const result = await archiveDealer(fd);
      if ('ok' in result) {
        toast.success('Dealer removed');
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  const columns = useMemo(
    () => buildDealersColumns({ onEdit: setEditing, onArchive: archive }),
    // See people-admin.tsx — `archive` closes over per-render state setters but
    // their identity is stable; rebuild is cheap given the column count.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  return (
    <section className="rounded-2xl border border-stone-200 bg-white p-5 shadow-[0_1px_4px_rgba(15,30,60,0.08)]">
      <div className="flex items-center justify-between">
        <p className="text-xs text-stone-500">{dealers.length} dealers</p>
        <Can capability="dealer:create">
          <button onClick={() => setAddOpen(true)} className={headerAddClass}>
            + Add Dealer
          </button>
        </Can>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={globalFilter}
          onChange={(e) => setGlobalFilter(e.target.value)}
          placeholder="Search by name, contact, or email…"
          aria-label="Search dealers"
          className="min-w-[16rem] flex-1 rounded-lg border border-stone-200 bg-white px-3 py-1.5 text-sm text-stone-800 outline-none transition focus:border-accent focus:ring-3 focus:ring-accent/20"
        />
      </div>

      <div className="mt-3">
        <DataTable
          columns={columns}
          data={dealers}
          initialSorting={[{ id: 'name', desc: false }]}
          initialPageSize={50}
          globalFilter={globalFilter}
          onGlobalFilterChange={setGlobalFilter}
          globalFilterFn={dealersGlobalFilterFn}
          emptyState={
            isFiltered ? (
              <span className="inline-flex items-center gap-2">
                <span>No dealers match.</span>
                <button
                  type="button"
                  onClick={clearFilters}
                  className="rounded border border-stone-200 bg-white px-2 py-0.5 text-xs font-medium text-stone-600 transition hover:border-navy hover:text-navy"
                >
                  Clear filters
                </button>
              </span>
            ) : (
              'No dealers yet.'
            )
          }
        />
      </div>

      <Dialog.Root open={addOpen} onClose={setAddOpen}>
        <Dialog.Backdrop />
        <Dialog.Panel>
          <Dialog.Title>Add Dealer</Dialog.Title>
          <Dialog.Description>Create a new dealership.</Dialog.Description>
          {addOpen && <DealerForm mode="create" onSuccess={() => setAddOpen(false)} />}
        </Dialog.Panel>
      </Dialog.Root>

      <Dialog.Root open={editing != null} onClose={() => setEditing(null)}>
        <Dialog.Backdrop />
        <Dialog.Panel>
          <Dialog.Title>Edit Dealer — {editing?.name}</Dialog.Title>
          {editing && (
            <DealerForm
              mode="edit"
              dealer={editing}
              onSuccess={() => setEditing(null)}
            />
          )}
        </Dialog.Panel>
      </Dialog.Root>
    </section>
  );
}
