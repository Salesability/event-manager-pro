'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';

export function ProductionFilters() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const initialQ = params.get('q') ?? '';
  const initialStatus = params.get('status') ?? '';
  const initialCancelled = params.get('cancelled') === '1';

  const [q, setQ] = useState(initialQ);
  const [status, setStatus] = useState(initialStatus);
  const [showCancelled, setShowCancelled] = useState(initialCancelled);
  const [, startTransition] = useTransition();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setQ(params.get('q') ?? '');
    setStatus(params.get('status') ?? '');
    setShowCancelled(params.get('cancelled') === '1');
  }, [params]);

  function pushParams(next: { q?: string; status?: string; cancelled?: boolean }) {
    const sp = new URLSearchParams(params.toString());
    if (next.q !== undefined) {
      next.q ? sp.set('q', next.q) : sp.delete('q');
    }
    if (next.status !== undefined) {
      next.status ? sp.set('status', next.status) : sp.delete('status');
    }
    if (next.cancelled !== undefined) {
      next.cancelled ? sp.set('cancelled', '1') : sp.delete('cancelled');
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

  function onStatusChange(value: string) {
    setStatus(value);
    pushParams({ status: value });
  }

  function onCancelledToggle(value: boolean) {
    setShowCancelled(value);
    pushParams({ cancelled: value });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex items-center gap-2 rounded-lg border border-stone-200 bg-white px-3 py-1.5 transition focus-within:border-accent">
        <span className="text-stone-400">🔍</span>
        <input
          type="text"
          value={q}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search campaigns…"
          className="w-56 bg-transparent text-sm text-stone-800 outline-none placeholder:text-stone-400"
        />
      </div>
      <select
        value={status}
        onChange={(e) => onStatusChange(e.target.value)}
        className="rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm text-stone-800 outline-none transition focus:border-accent"
      >
        <option value="">All campaigns</option>
        <option value="upcoming">Upcoming</option>
        <option value="past">Past</option>
      </select>
      <label className="flex items-center gap-2 rounded-lg border border-stone-200 bg-white px-3 py-2 text-xs font-medium text-stone-600">
        <input
          type="checkbox"
          checked={showCancelled}
          onChange={(e) => onCancelledToggle(e.target.checked)}
          className="h-3.5 w-3.5 accent-navy"
        />
        Show cancelled
      </label>
    </div>
  );
}
