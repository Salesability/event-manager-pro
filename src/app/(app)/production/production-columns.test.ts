import { describe, it, expect } from 'vitest';
import type { FilterFn, Row } from '@tanstack/react-table';
import { buildProductionColumns } from './production-columns';
import type { Campaign } from '@/features/schedule/queries';

// The Date column hosts the re-homed "Show cancelled" filter (0096; it used
// to live on the removed derived-Status column). Pull that filterFn off the
// built column defs and exercise it directly.
function dateColumnFilter(): FilterFn<Campaign> {
  const col = buildProductionColumns({ onEdit: () => {} }).find((c) => c.id === 'date');
  if (!col || typeof col.filterFn !== 'function') {
    throw new Error('expected a `date` column with a function filterFn');
  }
  return col.filterFn as FilterFn<Campaign>;
}

const rowFor = (status: Campaign['status']) =>
  ({ original: { status } }) as unknown as Row<Campaign>;

const noop = () => {};

describe('production Date-column show-cancelled filter (0096)', () => {
  it('hides cancelled rows when showCancelled is false', () => {
    const fn = dateColumnFilter();
    expect(fn(rowFor('cancelled'), 'date', { showCancelled: false }, noop)).toBe(false);
  });

  it('shows cancelled rows when showCancelled is true', () => {
    const fn = dateColumnFilter();
    expect(fn(rowFor('cancelled'), 'date', { showCancelled: true }, noop)).toBe(true);
  });

  it('always shows non-cancelled rows regardless of the toggle', () => {
    const fn = dateColumnFilter();
    for (const status of ['draft', 'booked', 'completed'] as const) {
      expect(fn(rowFor(status), 'date', { showCancelled: false }, noop)).toBe(true);
      expect(fn(rowFor(status), 'date', { showCancelled: true }, noop)).toBe(true);
    }
  });

  it('passes rows through when the filter value is absent', () => {
    const fn = dateColumnFilter();
    expect(fn(rowFor('cancelled'), 'date', undefined, noop)).toBe(true);
  });
});

describe('production columns shape (0096)', () => {
  it('exposes a sortable Date column and no Status column', () => {
    const cols = buildProductionColumns({ onEdit: () => {} });
    const date = cols.find((c) => c.id === 'date');
    expect(date?.header).toBe('Date');
    expect(date?.enableSorting).toBe(true);
    expect(cols.some((c) => c.id === 'status')).toBe(false);
  });
});
