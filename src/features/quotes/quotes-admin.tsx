'use client';

import { useMemo, useRef, useState, useTransition } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import type { ColumnFiltersState } from '@tanstack/react-table';
import { ListToolbar } from '@/components/app/list-toolbar';
import { DataTable } from '@/components/ui/data-table';
import { makeNeedleFilter } from '@/lib/ui/data-table-filters';
import { buildQuotesColumns } from '@/features/quotes/quotes-columns';
import type { Quote, QuoteStatus } from '@/features/quotes/queries';

type Pill = '' | QuoteStatus;

const PILLS: ReadonlyArray<{ value: Pill; label: string }> = [
  { value: '', label: 'All' },
  { value: 'draft', label: 'Draft' },
  { value: 'sent', label: 'Sent' },
  { value: 'accepted', label: 'Accepted' },
  { value: 'declined', label: 'Declined' },
];

function isPill(v: string): v is Pill {
  return (
    v === '' || v === 'draft' || v === 'sent' || v === 'accepted' || v === 'declined'
  );
}

function pillClass(active: boolean): string {
  return active
    ? 'rounded-full border border-brand-500 bg-brand-100 px-3 py-1 text-xs font-semibold text-brand-700 transition'
    : 'rounded-full border border-zinc-200 bg-white px-3 py-1 text-xs font-medium text-zinc-500 transition hover:border-brand-500 hover:text-brand-700';
}

const quotesGlobalFilterFn = makeNeedleFilter<Quote>((q) => [q.dealerName]);

export function QuotesAdmin({ quotes }: { quotes: Quote[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const qFromUrl = params.get('q') ?? '';
  const rawStatus = params.get('status') ?? '';
  const status: Pill = isPill(rawStatus) ? rawStatus : '';

  const [globalFilter, setGlobalFilter] = useState(qFromUrl);
  const [prevQFromUrl, setPrevQFromUrl] = useState(qFromUrl);
  if (qFromUrl !== prevQFromUrl) {
    setPrevQFromUrl(qFromUrl);
    setGlobalFilter(qFromUrl);
  }

  const [, startTransition] = useTransition();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function pushParams(next: { q?: string; status?: Pill }) {
    const sp = new URLSearchParams(window.location.search);
    if (next.q !== undefined) {
      if (next.q) sp.set('q', next.q);
      else sp.delete('q');
    }
    if (next.status !== undefined) {
      if (next.status) sp.set('status', next.status);
      else sp.delete('status');
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

  const isFiltered = globalFilter.trim().length > 0 || status !== '';
  const clearFilters = () => {
    setGlobalFilter('');
    if (debounceRef.current) clearTimeout(debounceRef.current);
    pushParams({ q: '', status: '' });
  };

  const columnFilters: ColumnFiltersState = useMemo(
    () => (status ? [{ id: 'status', value: status }] : []),
    [status],
  );

  // Pills filter by raw `QuoteStatus` (so the "Sent" pill includes
  // expired-derived rows whose underlying row is still status='sent'),
  // matching legacy `/quotes` behavior. The status badge in the row
  // still renders the derived 'expired' key for sent-and-stale rows.
  const counts = useMemo(() => {
    const acc: Record<'all' | QuoteStatus, number> = {
      all: quotes.length,
      draft: 0,
      sent: 0,
      accepted: 0,
      declined: 0,
    };
    for (const q of quotes) {
      acc[q.status] += 1;
    }
    return acc;
  }, [quotes]);

  const columns = useMemo(() => buildQuotesColumns(), []);

  return (
    <section className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-[0_1px_4px_rgba(15,30,60,0.08)]">
      <ListToolbar
        search={
          <input
            type="search"
            value={globalFilter}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search by dealer…"
            aria-label="Search quotes"
            className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-sm text-zinc-900 outline-none transition focus:border-brand-500 focus:ring-3 focus:ring-brand-500/20"
          />
        }
        filters={PILLS.map((p) => {
          const count = p.value === '' ? counts.all : counts[p.value];
          const active = status === p.value;
          return (
            <button
              key={p.value || 'all'}
              type="button"
              aria-pressed={active}
              onClick={() => pushParams({ status: p.value })}
              className={pillClass(active)}
            >
              {p.label} ({count})
            </button>
          );
        })}
      />
      <div className="mt-3">
        <DataTable
          columns={columns}
          data={quotes}
          initialSorting={[{ id: 'createdAt', desc: true }]}
          globalFilter={globalFilter}
          onGlobalFilterChange={setGlobalFilter}
          globalFilterFn={quotesGlobalFilterFn}
          columnFilters={columnFilters}
          emptyState={
            isFiltered ? (
              <span className="inline-flex items-center gap-2">
                <span>No quotes match.</span>
                <button
                  type="button"
                  onClick={clearFilters}
                  className="rounded border border-zinc-200 bg-white px-2 py-0.5 text-xs font-medium text-zinc-500 transition hover:border-brand-500 hover:text-brand-700"
                >
                  Clear filters
                </button>
              </span>
            ) : (
              'No quotes yet — click “New Quote” above (or use the Quote action on a dealer).'
            )
          }
        />
      </div>
    </section>
  );
}
