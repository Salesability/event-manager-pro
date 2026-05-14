'use client';

import { useMemo, useRef, useState, useTransition } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import type { ColumnFiltersState } from '@tanstack/react-table';
import { Dialog, DialogTitle } from '@/components/catalyst/dialog';
import { ListToolbar } from '@/components/app/list-toolbar';
import { DataTable } from '@/components/ui/data-table';
import { makeNeedleFilter } from '@/lib/ui/data-table-filters';
import { BookingForm } from '@/app/(app)/calendar/booking-form';
import type {
  Campaign,
  Coach,
  Dealer,
  LookupOption,
} from '@/features/schedule/queries';
import {
  buildProductionColumns,
  type ProductionStatusFilter,
} from './production-columns';

type Props = {
  campaigns: Campaign[];
  dealers: Dealer[];
  coaches: Coach[];
  styles: LookupOption[];
  sources: LookupOption[];
  todayIso: string;
};

const campaignsGlobalFilterFn = makeNeedleFilter<Campaign>((c) => [
  c.dealerName,
  c.coachName,
  c.styleLabel,
  c.notes,
  c.contact,
]);

function isTime(v: string): v is '' | 'upcoming' | 'past' {
  return v === '' || v === 'upcoming' || v === 'past';
}

export function ProductionAdmin({
  campaigns,
  dealers,
  coaches,
  styles,
  sources,
  todayIso,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const qFromUrl = params.get('q') ?? '';
  const time = isTime(params.get('status') ?? '') ? (params.get('status') as '' | 'upcoming' | 'past') : '';
  const showCancelled = params.get('cancelled') === '1';

  const [globalFilter, setGlobalFilter] = useState(qFromUrl);
  const [prevQFromUrl, setPrevQFromUrl] = useState(qFromUrl);
  if (qFromUrl !== prevQFromUrl) {
    setPrevQFromUrl(qFromUrl);
    setGlobalFilter(qFromUrl);
  }

  const [, startTransition] = useTransition();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function pushParams(next: {
    q?: string;
    status?: '' | 'upcoming' | 'past';
    cancelled?: boolean;
  }) {
    const sp = new URLSearchParams(params.toString());
    if (next.q !== undefined) {
      if (next.q) sp.set('q', next.q);
      else sp.delete('q');
    }
    if (next.status !== undefined) {
      if (next.status) sp.set('status', next.status);
      else sp.delete('status');
    }
    if (next.cancelled !== undefined) {
      if (next.cancelled) sp.set('cancelled', '1');
      else sp.delete('cancelled');
    }
    const qs = sp.toString();
    startTransition(() => {
      router.replace(qs ? `${pathname}?${qs}` : pathname);
    });
  }

  function onSearchChange(value: string) {
    setGlobalFilter(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => pushParams({ q: value }), 250);
  }

  const [editing, setEditing] = useState<Campaign | null>(null);

  const columns = useMemo(
    () => buildProductionColumns({ onEdit: setEditing }, todayIso),
    [todayIso],
  );

  const columnFilters: ColumnFiltersState = useMemo(() => {
    const value: ProductionStatusFilter = { time, showCancelled };
    return [{ id: 'status', value }];
  }, [time, showCancelled]);

  return (
    <>
      <section className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-[0_1px_4px_rgba(15,30,60,0.08)]">
        <ListToolbar
          search={
            <input
              type="search"
              value={globalFilter}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="Search campaigns…"
              aria-label="Search campaigns"
              className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-sm text-zinc-900 outline-none transition focus:border-brand-500 focus:ring-3 focus:ring-brand-500/20"
            />
          }
          filters={
            <>
              <select
                value={time}
                onChange={(e) =>
                  pushParams({ status: (e.target.value as '' | 'upcoming' | 'past') || '' })
                }
                className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 outline-none transition focus:border-brand-500"
                aria-label="Time window"
              >
                <option value="">All campaigns</option>
                <option value="upcoming">Upcoming</option>
                <option value="past">Past</option>
              </select>
              <label className="flex items-center gap-2 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs font-medium text-zinc-500">
                <input
                  type="checkbox"
                  checked={showCancelled}
                  onChange={(e) => pushParams({ cancelled: e.target.checked })}
                  className="h-3.5 w-3.5 accent-brand-600"
                />
                Show cancelled
              </label>
            </>
          }
        />
        <div className="mt-3">
          <DataTable
            columns={columns}
            data={campaigns}
            initialSorting={[{ id: 'identity', desc: false }]}
            globalFilter={globalFilter}
            onGlobalFilterChange={setGlobalFilter}
            globalFilterFn={campaignsGlobalFilterFn}
            columnFilters={columnFilters}
            emptyState="No campaigns match. Adjust the search or status filter to see more."
          />
        </div>
      </section>

      <Dialog open={editing != null} onClose={() => setEditing(null)}>
        <DialogTitle>Edit Campaign</DialogTitle>
        {editing && (
          <BookingForm
            mode="edit"
            campaign={editing}
            dealers={dealers}
            coaches={coaches}
            styles={styles}
            sources={sources}
            onSuccess={() => setEditing(null)}
          />
        )}
      </Dialog>
    </>
  );
}
