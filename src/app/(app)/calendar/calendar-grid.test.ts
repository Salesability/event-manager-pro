import { describe, expect, it } from 'vitest';
import { clampToGrid, type Grid } from './calendar-grid';

// May 2026: leading days Apr 26–30 (cells 0–4), May 1–31 (cells 5–35),
// trailing June 1–6 (cells 36–41).
function makeMay2026Grid(): Grid {
  const indexOf: Record<string, number> = {};
  const cells: string[] = [];
  for (let d = 26; d <= 30; d++) cells.push(`2026-04-${String(d).padStart(2, '0')}`);
  for (let d = 1; d <= 31; d++) cells.push(`2026-05-${String(d).padStart(2, '0')}`);
  for (let d = 1; d <= 6; d++) cells.push(`2026-06-${String(d).padStart(2, '0')}`);
  cells.forEach((date, i) => {
    indexOf[date] = i;
  });
  return { firstDate: cells[0], lastDate: cells[41], indexOf };
}

describe('clampToGrid', () => {
  const grid = makeMay2026Grid();

  it('returns null when the range is entirely before the grid', () => {
    expect(clampToGrid('2026-04-10', '2026-04-20', grid)).toBeNull();
  });

  it('returns null when the range is entirely after the grid', () => {
    expect(clampToGrid('2026-06-10', '2026-06-20', grid)).toBeNull();
  });

  it('clamps the start to 0 when the range begins before the grid', () => {
    // Apr 20 → May 5 (cell 9 for May 5 = leading 5 + days 1..5 → index 9)
    expect(clampToGrid('2026-04-20', '2026-05-05', grid)).toEqual({ si: 0, ei: 9 });
  });

  it('clamps the end to 41 when the range extends past the grid', () => {
    // May 28 → June 10 (cell 32 for May 28 = leading 5 + (28-1) → 32)
    expect(clampToGrid('2026-05-28', '2026-06-10', grid)).toEqual({ si: 32, ei: 41 });
  });

  it('clamps a range that overlaps only the prior-month leading strip', () => {
    // Apr 20 → Apr 28: starts before grid, ends inside the leading-days strip only.
    // This is the original failure shape — legacy dropped these entirely.
    expect(clampToGrid('2026-04-20', '2026-04-28', grid)).toEqual({ si: 0, ei: 2 });
  });

  it('clamps a range that overlaps only the next-month trailing strip', () => {
    // Jun 3 → Jun 20: starts inside the trailing-days strip, ends after grid.
    // Jun 3 = cell 38 (leading 5 + 31 May days + 2 = 38).
    expect(clampToGrid('2026-06-03', '2026-06-20', grid)).toEqual({ si: 38, ei: 41 });
  });

  it('clamps both ends when the range fully encloses the grid', () => {
    expect(clampToGrid('2025-01-01', '2027-01-01', grid)).toEqual({ si: 0, ei: 41 });
  });

  it('leaves a single-cell event inside the grid unchanged', () => {
    // May 15 → cell 5 + 14 = 19
    expect(clampToGrid('2026-05-15', '2026-05-15', grid)).toEqual({ si: 19, ei: 19 });
  });

  it('leaves a zero-day event at the grid boundary unchanged', () => {
    expect(clampToGrid('2026-04-26', '2026-04-26', grid)).toEqual({ si: 0, ei: 0 });
    expect(clampToGrid('2026-06-06', '2026-06-06', grid)).toEqual({ si: 41, ei: 41 });
  });
});
