import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  dbResults: [] as unknown[][],
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/db', () => {
  const next = () => Promise.resolve(mocks.dbResults.shift() ?? []);
  const terminal = {
    limit: () => next(),
    orderBy: () => ({ limit: () => next(), then: (f: (v: unknown[]) => unknown) => next().then(f) }),
    then: (f: (v: unknown[]) => unknown) => next().then(f),
  };
  return {
    db: {
      select: () => ({
        from: () => ({
          where: () => terminal,
        }),
      }),
    },
  };
});

import {
  firstDraftQuoteIdForDealer,
  loadActiveOrPendingMsa,
  loadMsasByDealer,
} from './queries';

const ROW_BASE = {
  id: 1,
  dealerId: 7,
  signedAt: null,
  expiresAt: null,
  signedPdfStorageKey: null,
  dropboxSignDocumentId: null,
  terminationNoticeDate: null,
  terminationEffectiveDate: null,
  templateVersion: '2026-05-12',
  createdAt: new Date('2026-05-12T10:00:00Z'),
};

beforeEach(() => {
  mocks.dbResults = [];
});

describe('loadMsasByDealer', () => {
  it('returns an empty list when the dealer has no MSAs', async () => {
    mocks.dbResults.push([]);
    expect(await loadMsasByDealer(7)).toEqual([]);
  });

  it('returns all MSAs newest-first (relies on the mock returning what the query layer would)', async () => {
    const rows = [
      { ...ROW_BASE, id: 3, status: 'pending' as const },
      { ...ROW_BASE, id: 2, status: 'terminated' as const },
      { ...ROW_BASE, id: 1, status: 'active' as const, signedAt: new Date('2026-01-01') },
    ];
    mocks.dbResults.push(rows);
    const result = await loadMsasByDealer(7);
    expect(result.map((r) => r.id)).toEqual([3, 2, 1]);
  });
});

describe('loadActiveOrPendingMsa', () => {
  it('returns the active MSA when one exists', async () => {
    const active = { ...ROW_BASE, id: 5, status: 'active' as const };
    mocks.dbResults.push([active]);
    const result = await loadActiveOrPendingMsa(7);
    expect(result?.id).toBe(5);
    expect(result?.status).toBe('active');
  });

  it('falls back to the most-recent pending MSA when no active one exists', async () => {
    mocks.dbResults.push([]); // active lookup empty
    const pending = { ...ROW_BASE, id: 9, status: 'pending' as const };
    mocks.dbResults.push([pending]);
    const result = await loadActiveOrPendingMsa(7);
    expect(result?.id).toBe(9);
    expect(result?.status).toBe('pending');
  });

  it('returns null when neither active nor pending exists', async () => {
    mocks.dbResults.push([]); // active
    mocks.dbResults.push([]); // pending
    expect(await loadActiveOrPendingMsa(7)).toBeNull();
  });
});

describe('firstDraftQuoteIdForDealer', () => {
  it('returns the id of the first draft quote', async () => {
    mocks.dbResults.push([{ id: 42 }]);
    expect(await firstDraftQuoteIdForDealer(7)).toBe(42);
  });

  it('returns null when no draft quote exists', async () => {
    mocks.dbResults.push([]);
    expect(await firstDraftQuoteIdForDealer(7)).toBeNull();
  });
});
