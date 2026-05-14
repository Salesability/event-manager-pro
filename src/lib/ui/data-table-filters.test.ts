import { describe, expect, it } from 'vitest';
import type { Row } from '@tanstack/react-table';
import { makeNeedleFilter } from './data-table-filters';

type Sample = { id: number; name: string; email: string | null; tag?: string };

function row(original: Sample): Row<Sample> {
  // The factory only touches `row.original`; everything else is irrelevant.
  return { original } as Row<Sample>;
}

// TanStack's `FilterFn` shape requires an `addMeta` 4th arg; the
// factory never calls it but the type forces the call sites to pass
// something. A no-op shim keeps the tests honest without polluting
// every assertion.
const noopAddMeta = () => undefined;

describe('makeNeedleFilter', () => {
  const filter = makeNeedleFilter<Sample>((s) => [s.name, s.email, s.tag]);

  it('matches when the needle appears in any supplied field (case-insensitive)', () => {
    expect(filter(row({ id: 1, name: 'Acme Inc', email: null }), 'x', 'acme', noopAddMeta)).toBe(true);
    expect(filter(row({ id: 1, name: 'Acme Inc', email: 'x@y.com' }), 'x', 'y.com', noopAddMeta)).toBe(true);
    expect(filter(row({ id: 1, name: 'a', email: null, tag: 'Coach' }), 'x', 'COACH', noopAddMeta)).toBe(true);
  });

  it('returns false when no field contains the needle', () => {
    expect(filter(row({ id: 1, name: 'Acme', email: 'a@b' }), 'x', 'zzz', noopAddMeta)).toBe(false);
  });

  it('treats empty / whitespace-only filter as a no-op (every row passes)', () => {
    expect(filter(row({ id: 1, name: 'anything', email: null }), 'x', '', noopAddMeta)).toBe(true);
    expect(filter(row({ id: 1, name: 'anything', email: null }), 'x', '   ', noopAddMeta)).toBe(true);
    expect(filter(row({ id: 1, name: 'anything', email: null }), 'x', undefined, noopAddMeta)).toBe(true);
  });

  it('ignores null/undefined/empty fields without crashing', () => {
    expect(filter(row({ id: 1, name: '', email: null, tag: undefined }), 'x', 'x', noopAddMeta)).toBe(false);
    // The non-null field still matches against the needle when applicable.
    expect(filter(row({ id: 1, name: '', email: 'match', tag: undefined }), 'x', 'mat', noopAddMeta)).toBe(true);
  });
});
