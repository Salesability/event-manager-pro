'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useRef, useState, useTransition } from 'react';
import { ListToolbar } from '@/components/app/list-toolbar';
import type { QuoteStatus } from '@/features/quotes/queries';

type Pill = '' | QuoteStatus;

const PILLS: ReadonlyArray<{ value: Pill; label: string }> = [
  { value: '', label: 'All' },
  { value: 'draft', label: 'Draft' },
  { value: 'sent', label: 'Sent' },
  { value: 'accepted', label: 'Accepted' },
  { value: 'declined', label: 'Declined' },
];

function pillClass(active: boolean): string {
  return active
    ? 'rounded-full border border-accent bg-accent/15 px-3 py-1 text-xs font-semibold text-accent transition'
    : 'rounded-full border border-stone-200 bg-white px-3 py-1 text-xs font-medium text-stone-600 transition hover:border-navy hover:text-navy';
}

function isPill(v: string): v is Pill {
  return v === '' || v === 'draft' || v === 'sent' || v === 'accepted' || v === 'declined';
}

export function QuotesFilters({
  counts,
}: {
  counts: Record<'all' | QuoteStatus, number>;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const qFromUrl = params.get('q') ?? '';
  const rawStatus = params.get('status') ?? '';
  const status: Pill = isPill(rawStatus) ? rawStatus : '';

  const [q, setQ] = useState(qFromUrl);
  const [prevQFromUrl, setPrevQFromUrl] = useState(qFromUrl);
  if (qFromUrl !== prevQFromUrl) {
    setPrevQFromUrl(qFromUrl);
    setQ(qFromUrl);
  }

  const [, startTransition] = useTransition();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function pushParams(next: { q?: string; status?: Pill }) {
    const sp = new URLSearchParams(window.location.search);
    if (next.q !== undefined) {
      next.q ? sp.set('q', next.q) : sp.delete('q');
    }
    if (next.status !== undefined) {
      next.status ? sp.set('status', next.status) : sp.delete('status');
    }
    const qs = sp.toString();
    startTransition(() => {
      router.replace(qs ? `${pathname}?${qs}` : pathname);
    });
  }

  function onSearchChange(value: string) {
    setQ(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => pushParams({ q: value }), 250);
  }

  return (
    <ListToolbar
      search={
        <div className="flex w-full items-center gap-2 rounded-lg border border-stone-200 bg-white px-3 py-1.5 transition focus-within:border-accent">
          <span className="text-stone-400">🔍</span>
          <input
            type="text"
            value={q}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search by dealer…"
            aria-label="Search quotes"
            className="w-full bg-transparent text-sm text-stone-800 outline-none placeholder:text-stone-400"
          />
        </div>
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
  );
}
