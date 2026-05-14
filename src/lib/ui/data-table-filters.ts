import type { FilterFn } from '@tanstack/react-table';

/**
 * Shared TanStack `FilterFn` factory for the "needle (lowercase) matches
 * if it appears in any of these stringly fields" shape (0050 Phase 5).
 *
 * Four grids land on this shape: `/admin/dealers`, `/admin/people`,
 * `/quotes`, `/production`. Each was a hand-rolled callback before this
 * helper; threading them through a single factory makes the per-surface
 * column file declare *which fields* match without re-implementing the
 * lowercase-trim-includes plumbing.
 *
 * Empty / whitespace-only filter values bypass the predicate (every row
 * passes). Falsy field values (`null`, `undefined`, `''`) on a row are
 * ignored — they don't match against an empty needle, they just don't
 * contribute any text to scan.
 *
 * Status-pill / role-multi / show-cancelled filters are *not* folded in
 * here — those stay as `columnFilters` entries per the existing
 * dealers-admin / people-admin pattern.
 */
export function makeNeedleFilter<TRow>(
  rowToStrings: (row: TRow) => ReadonlyArray<string | null | undefined>,
): FilterFn<TRow> {
  return (row, _columnId, filterValue) => {
    const needle = String(filterValue ?? '').trim().toLowerCase();
    if (!needle) return true;
    const fields = rowToStrings(row.original);
    for (const field of fields) {
      if (field && field.toLowerCase().includes(needle)) return true;
    }
    return false;
  };
}
