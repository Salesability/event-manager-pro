'use client';

import { useMemo } from 'react';
import { DataTable } from '@/components/ui/data-table';
import { buildQuotesColumns } from '@/features/quotes/quotes-columns';
import type { Quote } from '@/features/quotes/queries';

// Dealer-scoped Quotes panel for `/dealerships/[id]` (0050 Phase 5).
// Uses the same `<DataTable>` + columns as `/quotes`, but with the
// dealer-name sublabel hidden (every row is for the same dealer) and
// no toolbar/filter — the panel is small, dealer-scoped, and adding a
// search input on a typically-tiny list is more chrome than benefit.
export function DealerQuotesPanel({ quotes }: { quotes: Quote[] }) {
  const columns = useMemo(
    () => buildQuotesColumns({ hideDealerSublabel: true }),
    [],
  );
  return (
    <DataTable
      columns={columns}
      data={quotes}
      initialSorting={[{ id: 'createdAt', desc: true }]}
      emptyState="No quotes yet."
    />
  );
}
