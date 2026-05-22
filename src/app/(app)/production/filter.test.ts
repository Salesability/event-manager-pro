import { describe, it, expect } from 'vitest';
import { isProductionRange, rangeWindowEndIso, PRODUCTION_RANGE_MONTHS } from './filter';

describe('isProductionRange', () => {
  it('accepts the three forward-window keys', () => {
    expect(isProductionRange('1m')).toBe(true);
    expect(isProductionRange('2m')).toBe(true);
    expect(isProductionRange('3m')).toBe(true);
  });

  it('rejects the legacy + empty time-window values', () => {
    for (const v of ['', 'upcoming', 'past', '4m', 'month', '1', 'all']) {
      expect(isProductionRange(v)).toBe(false);
    }
  });
});

describe('rangeWindowEndIso', () => {
  it('adds the configured number of months, keeping the day', () => {
    expect(rangeWindowEndIso('2026-05-22', '1m')).toBe('2026-06-22');
    expect(rangeWindowEndIso('2026-05-22', '2m')).toBe('2026-07-22');
    expect(rangeWindowEndIso('2026-05-22', '3m')).toBe('2026-08-22');
  });

  it('crosses the year boundary', () => {
    expect(rangeWindowEndIso('2026-11-15', '3m')).toBe('2027-02-15');
  });

  it('rolls a short-month overflow forward (Jan 31 + 1m → early Mar)', () => {
    // Feb has no 31st, so JS Date.setMonth carries into March. This only
    // widens the window by a couple of days — acceptable for a coarse scope.
    expect(rangeWindowEndIso('2026-01-31', '1m')).toBe('2026-03-03');
  });

  it('months map matches the key suffixes', () => {
    expect(PRODUCTION_RANGE_MONTHS).toEqual({ '1m': 1, '2m': 2, '3m': 3 });
  });
});

describe('forward-window scoping predicate', () => {
  // Mirrors the predicate inlined in production-columns.tsx (filterFn) and
  // export/route.ts: a campaign is in-window when it is live/upcoming
  // (endDate >= today) AND it begins on or before the window closes.
  const today = '2026-05-22';
  const inWindow = (startDate: string, endDate: string, range: '1m' | '2m' | '3m') =>
    endDate >= today && startDate <= rangeWindowEndIso(today, range);

  it('includes a campaign running inside the next month', () => {
    expect(inWindow('2026-06-01', '2026-06-03', '1m')).toBe(true);
  });

  it('excludes a past campaign even when it started recently', () => {
    expect(inWindow('2026-05-01', '2026-05-10', '1m')).toBe(false); // ended before today
  });

  it('excludes a campaign that starts after the window closes', () => {
    expect(inWindow('2026-07-15', '2026-07-20', '1m')).toBe(false); // starts > 2026-06-22
  });

  it('includes a still-running campaign that started before today', () => {
    expect(inWindow('2026-05-20', '2026-05-30', '1m')).toBe(true); // overlaps today
  });

  it('widens with the range: a far campaign enters at 3m but not 1m', () => {
    expect(inWindow('2026-08-10', '2026-08-12', '1m')).toBe(false);
    expect(inWindow('2026-08-10', '2026-08-12', '3m')).toBe(true); // window end 2026-08-22
  });
});
