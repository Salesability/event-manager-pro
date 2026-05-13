'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useRef, useState, useTransition } from 'react';

export function ProductionFilters() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const qFromUrl = params.get('q') ?? '';
  const status = params.get('status') ?? '';
  const showCancelled = params.get('cancelled') === '1';

  // Local mirror for the debounced search input. Status / showCancelled push to
  // the URL synchronously, so they're derived directly from `params` above.
  const [q, setQ] = useState(qFromUrl);
  const [prevQFromUrl, setPrevQFromUrl] = useState(qFromUrl);
  if (qFromUrl !== prevQFromUrl) {
    setPrevQFromUrl(qFromUrl);
    setQ(qFromUrl);
  }

  const [, startTransition] = useTransition();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    pushParams({ status: value });
  }

  function onCancelledToggle(value: boolean) {
    pushParams({ cancelled: value });
  }

  const exportHref = `/production/export${params.toString() ? `?${params.toString()}` : ''}`;

  return (
    <div className="flex flex-wrap items-center gap-2 print:hidden">
      <div className="flex items-center gap-2 rounded-lg border border-border bg-white px-3 py-1.5 transition focus-within:border-accent">
        <span className="text-muted-foreground/70">🔍</span>
        <input
          type="text"
          value={q}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search campaigns…"
          className="w-56 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground/70"
        />
      </div>
      <select
        value={status}
        onChange={(e) => onStatusChange(e.target.value)}
        className="rounded-lg border border-border bg-white px-3 py-2 text-sm text-foreground outline-none transition focus:border-accent"
      >
        <option value="">All campaigns</option>
        <option value="upcoming">Upcoming</option>
        <option value="past">Past</option>
      </select>
      <label className="flex items-center gap-2 rounded-lg border border-border bg-white px-3 py-2 text-xs font-medium text-muted-foreground">
        <input
          type="checkbox"
          checked={showCancelled}
          onChange={(e) => onCancelledToggle(e.target.checked)}
          className="h-3.5 w-3.5 accent-navy"
        />
        Show cancelled
      </label>
      <a
        href={exportHref}
        className="rounded-lg border border-border bg-white px-3 py-2 text-xs font-medium text-foreground transition hover:border-primary hover:text-primary"
      >
        ⬇ Export CSV
      </a>
      <button
        type="button"
        onClick={() => window.print()}
        className="rounded-lg border border-border bg-white px-3 py-2 text-xs font-medium text-foreground transition hover:border-primary hover:text-primary"
      >
        🖨 Print
      </button>
    </div>
  );
}
