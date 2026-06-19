import { describe, expect, it, vi } from 'vitest';
import {
  findExistingContactByIdentifier,
  findExistingDealerByNameAddress,
} from './dedup';

// `dedup.ts` imports `@/lib/db` (default executor) — stub it so the module loads
// without a Postgres pool. Both helpers accept an `Executor`, so each test passes
// a stub that returns canned result-sets (one per `.select()...limit()` chain).
// The SQL-level filters (archived exclusion, lower(trim()) case-insensitivity)
// are exercised against a real DB in the Phase 6 integration test — here we cover
// the control flow + normalization + return shapes.
vi.mock('server-only', () => ({}));
vi.mock('@/lib/db', () => ({ db: {} }));

type Exec = Parameters<typeof findExistingContactByIdentifier>[1];

// Each `.limit()` shifts the next canned result-set off the queue, so a helper
// that issues two queries (email then phone) reads two sets in order.
function fakeExec(resultSets: unknown[][]): Exec {
  const queue = [...resultSets];
  const chain = {
    select: () => chain,
    from: () => chain,
    innerJoin: () => chain,
    where: () => chain,
    limit: () => Promise.resolve(queue.shift() ?? []),
  };
  return chain as unknown as Exec;
}

describe('findExistingContactByIdentifier', () => {
  const hit = [{ contactId: 7, firstName: 'Jane', lastName: 'Smith' }];

  it('matches on email first and reports the normalized value', async () => {
    const match = await findExistingContactByIdentifier(
      { email: '  JANE@Example.io ', phone: '555-0101' },
      fakeExec([hit]),
    );
    expect(match).toEqual({
      contactId: 7,
      firstName: 'Jane',
      lastName: 'Smith',
      matchedKind: 'email',
      matchedValue: 'jane@example.io',
    });
  });

  it('falls through to phone when email has no match', async () => {
    const match = await findExistingContactByIdentifier(
      { email: 'nobody@example.io', phone: ' 555-0101 ' },
      fakeExec([[], hit]),
    );
    expect(match?.matchedKind).toBe('phone');
    expect(match?.matchedValue).toBe('555-0101');
    expect(match?.contactId).toBe(7);
  });

  it('returns null when neither identifier matches', async () => {
    const match = await findExistingContactByIdentifier(
      { email: 'a@b.io', phone: '555' },
      fakeExec([[], []]),
    );
    expect(match).toBeNull();
  });

  it('skips the query and returns null when no identifiers are supplied', async () => {
    const match = await findExistingContactByIdentifier(
      { email: '', phone: null },
      fakeExec([]),
    );
    expect(match).toBeNull();
  });
});

describe('findExistingDealerByNameAddress', () => {
  it('returns the matched dealer', async () => {
    const match = await findExistingDealerByNameAddress(
      '  ABC Motors ',
      '123 King St',
      fakeExec([[{ dealerId: 12, name: 'ABC Motors', address: '123 King St' }]]),
    );
    expect(match).toEqual({ dealerId: 12, name: 'ABC Motors', address: '123 King St' });
  });

  it('returns null when no dealer matches', async () => {
    const match = await findExistingDealerByNameAddress(
      'ABC Motors',
      '123 King St',
      fakeExec([[]]),
    );
    expect(match).toBeNull();
  });
});
