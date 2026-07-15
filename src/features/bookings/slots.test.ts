import { describe, expect, it } from 'vitest';
import {
  deriveSlotGrid,
  formatSlotDate,
  formatSlotTime,
  isSlotInGrid,
  SLOT_LENGTH_MINUTES,
} from './slots';

const window = {
  startDate: '2026-08-14',
  endDate: '2026-08-15',
  dayStartMinute: 540, // 9:00
  dayEndMinute: 1020, // 17:00
};

describe('deriveSlotGrid', () => {
  it('derives half-hour slots across every campaign day', () => {
    const slots = deriveSlotGrid(window);
    // 8 hours × 2 slots/hour × 2 days.
    expect(slots).toHaveLength(32);
    expect(slots[0]).toEqual({ date: '2026-08-14', startMinute: 540 });
    expect(slots.at(-1)).toEqual({ date: '2026-08-15', startMinute: 990 });
  });

  it('keeps the last slot inside the window (slot END bounded by dayEnd)', () => {
    const slots = deriveSlotGrid({ ...window, endDate: '2026-08-14' });
    expect(slots.at(-1)?.startMinute).toBe(1020 - SLOT_LENGTH_MINUTES);
    expect(slots.every((s) => s.startMinute + SLOT_LENGTH_MINUTES <= 1020)).toBe(true);
  });

  it('is chronological across the day boundary', () => {
    const slots = deriveSlotGrid(window);
    const keys = slots.map((s) => `${s.date}#${String(s.startMinute).padStart(4, '0')}`);
    expect([...keys].sort()).toEqual(keys);
  });

  it('returns [] for an inverted date range or window', () => {
    expect(deriveSlotGrid({ ...window, endDate: '2026-08-13' })).toEqual([]);
    expect(deriveSlotGrid({ ...window, dayStartMinute: 1020, dayEndMinute: 540 })).toEqual([]);
  });

  it('returns [] for malformed dates instead of looping', () => {
    expect(deriveSlotGrid({ ...window, startDate: 'not-a-date' })).toEqual([]);
  });
});

describe('isSlotInGrid', () => {
  it('accepts first and last slots of a day', () => {
    expect(isSlotInGrid(window, { date: '2026-08-14', startMinute: 540 })).toBe(true);
    expect(isSlotInGrid(window, { date: '2026-08-15', startMinute: 990 })).toBe(true);
  });

  it('rejects a slot whose end would pass the window close', () => {
    expect(isSlotInGrid(window, { date: '2026-08-14', startMinute: 1020 })).toBe(false);
  });

  it('rejects off-grid minutes, pre-window times, and out-of-range dates', () => {
    expect(isSlotInGrid(window, { date: '2026-08-14', startMinute: 555 })).toBe(false);
    expect(isSlotInGrid(window, { date: '2026-08-14', startMinute: 510 })).toBe(false);
    expect(isSlotInGrid(window, { date: '2026-08-16', startMinute: 540 })).toBe(false);
  });
});

describe('formatSlotTime', () => {
  it('renders 12-hour wall-clock labels', () => {
    expect(formatSlotTime(540)).toBe('9:00 AM');
    expect(formatSlotTime(990)).toBe('4:30 PM');
    expect(formatSlotTime(0)).toBe('12:00 AM');
    expect(formatSlotTime(720)).toBe('12:00 PM');
  });
});

describe('formatSlotDate', () => {
  it('renders the local date string as itself (no timezone drift)', () => {
    expect(formatSlotDate('2026-08-14')).toContain('August 14');
    expect(formatSlotDate('2026-08-14')).toContain('Friday');
  });
});
