'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';

export function ProductionFilters() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const initialQ = params.get('q') ?? '';
  const initialStatus = params.get('status') ?? '';

  const [q, setQ] = useState(initialQ);
  const [status, setStatus] = useState(initialStatus);
  const [, startTransition] = useTransition();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setQ(params.get('q') ?? '');
    setStatus(params.get('status') ?? '');
  }, [params]);

  function pushParams(next: { q?: string; status?: string }) {
    const sp = new URLSearchParams(params.toString());
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

  function onStatusChange(value: string) {
    setStatus(value);
    pushParams({ status: value });
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
    </div>
  );
}
