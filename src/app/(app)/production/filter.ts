// `todayIso()` is the only remaining export here after 0096 retired the
// production time-window dropdown (a sortable Date column supersedes it).
// The client `<ProductionAdmin>` filters via TanStack `globalFilterFn` +
// a typed `columnFilters` value; the CSV-export route (./export/route.ts)
// inlines the same search + show-cancelled predicate. `todayIso` is still
// used by the export route for the filename + the Status output column.

export function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
