'use client';

import { useSearchParams } from 'next/navigation';

// Page-level actions for `/production` — Export CSV + Print. Lives in
// `<PageHeader actions={...}>` while the search + status + show-cancelled
// filters moved into the table-adjacent ListToolbar inside
// `<ProductionAdmin>` (0050 Phase 5). Reads filter state from URL so the
// export link inherits whatever's active.
export function ProductionPageActions() {
  const params = useSearchParams();
  const qs = params.toString();
  const exportHref = qs ? `/production/export?${qs}` : '/production/export';

  return (
    <div className="flex flex-wrap items-center gap-2 print:hidden">
      <a
        href={exportHref}
        className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs font-medium text-zinc-900 transition hover:border-brand-500 hover:text-brand-700"
      >
        ⬇ Export CSV
      </a>
      <button
        type="button"
        onClick={() => window.print()}
        className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs font-medium text-zinc-900 transition hover:border-brand-500 hover:text-brand-700"
      >
        🖨 Print
      </button>
    </div>
  );
}
