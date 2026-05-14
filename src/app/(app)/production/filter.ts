// `todayIso()` is the only export still in use after 0050 Phase 5
// retired the legacy in-memory campaign filter helper. The client-side
// `<ProductionAdmin>` does its own filtering via TanStack
// `globalFilterFn` + a typed `columnFilters` value; the CSV-export
// route handler (./export/route.ts) inlines the same predicate so
// no shared helper has to live across the client/server boundary.

export function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
