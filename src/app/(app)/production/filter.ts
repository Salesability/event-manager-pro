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

// --- Forward date-range windows (0058 Phase 1) -----------------------------
// `1m`/`2m`/`3m` scope the production list to a near horizon: campaigns whose
// run overlaps [today, today + N months]. Offered in the filter dropdown
// alongside upcoming/past, *replacing* the selection (forward-window semantics
// per the chunk intent's lean — not a rolling ±window). Only the date-window
// MATH is shared here (it's the part that would drift between the client
// filterFn and the server export route); each consumer keeps its own one-line
// predicate, matching the deliberate client/server duplication noted above.

export type ProductionRange = '1m' | '2m' | '3m';

export const PRODUCTION_RANGE_MONTHS: Record<ProductionRange, number> = {
  '1m': 1,
  '2m': 2,
  '3m': 3,
};

export function isProductionRange(v: string): v is ProductionRange {
  return v === '1m' || v === '2m' || v === '3m';
}

/** End of the forward window for `range`, as a YYYY-MM-DD string derived from
 *  `todayIso`. Kept in lockstep with the caller's `today` so the client
 *  filterFn and the server export route never drift. Anchored at noon to
 *  dodge tz date-shift, mirroring the column cell formatter. Month overflow
 *  rolls forward per JS `Date.setMonth` (e.g. Jan 31 + 1m → early Mar), which
 *  only widens the window by a couple of days — acceptable for a coarse
 *  near-horizon scope. */
export function rangeWindowEndIso(todayIso: string, range: ProductionRange): string {
  const d = new Date(`${todayIso}T12:00:00`);
  d.setMonth(d.getMonth() + PRODUCTION_RANGE_MONTHS[range]);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
