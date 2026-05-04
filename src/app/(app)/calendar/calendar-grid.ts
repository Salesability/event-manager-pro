// ISO date strings (YYYY-MM-DD) compare lexicographically as dates, so we
// avoid Date construction in the inner clamp.

export type Grid = {
  firstDate: string;
  lastDate: string;
  indexOf: Record<string, number>;
};

export const GRID_LAST_INDEX = 41;

export function clampToGrid(
  startDate: string,
  endDate: string,
  grid: Grid
): { si: number; ei: number } | null {
  if (endDate < grid.firstDate) return null;
  if (startDate > grid.lastDate) return null;
  const si = startDate < grid.firstDate ? 0 : grid.indexOf[startDate];
  const ei = endDate > grid.lastDate ? GRID_LAST_INDEX : grid.indexOf[endDate];
  if (si === undefined || ei === undefined) return null;
  return { si, ei };
}
