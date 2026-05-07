// Format a `YYYY-MM` string (the shape returned by Postgres `to_char(...,
// 'YYYY-MM')` and the natural slice of an ISO `startDate`) as a long-form
// label like "January 2026". Falls through to the raw key on malformed input.
//
// Lives in `src/lib/` rather than alongside any single consumer because both
// the server-only campaign loaders and the client-side reports tabs reach
// for it; co-locating it kept drifting (Codex 0014 Phase 2 Low).
export function formatYearMonth(yyyymm: string): string {
  const [year, month] = yyyymm.split('-');
  if (!year || !month) return yyyymm;
  // Noon UTC sidesteps the local-tz month-shift trap (`new Date('2026-01-01')`
  // can land on Dec 31 in negative-offset zones).
  const d = new Date(`${year}-${month}-01T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return yyyymm;
  return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}
