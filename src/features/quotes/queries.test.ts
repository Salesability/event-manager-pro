import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  // FIFO of arrays returned by successive db.select(...) chains. One entry per
  // loader call. loadQuote returns a single row but the underlying query is a
  // limit(1), so it still drains from the same array (`row` is the first item).
  selectResults: [] as unknown[][],
}));

vi.mock('server-only', () => ({}));

vi.mock('@/lib/db', () => ({
  db: {
    select: () => ({
      from: () => {
        const result = () => Promise.resolve(mocks.selectResults.shift() ?? []);
        const chain: {
          innerJoin: () => typeof chain;
          leftJoin: () => typeof chain;
          where: () => typeof chain;
          orderBy: () => Promise<unknown[]>;
          limit: () => Promise<unknown[]>;
        } = {
          innerJoin: () => chain,
          leftJoin: () => chain,
          where: () => chain,
          orderBy: () => result(),
          limit: () => result(),
        };
        return chain;
      },
    }),
  },
}));

import { loadQuote, loadQuotes, loadQuotesByDealer } from './queries';

const baseRow = {
  id: 7,
  dealerId: 3,
  dealerName: 'Capital Ford',
  dealerArchivedAt: null,
  status: 'draft' as const,
  subtotal: '6900.00',
  tax: '1035.00',
  total: '7935.00',
  taxPct: '15.00',
  inputs: { audienceSize: 500, eventDays: 3 },
  lineItems: [],
  audienceSourceId: null,
  audienceSourceLabel: null,
  sentAt: null,
  acceptedAt: null,
  declinedAt: null,
  createdAt: new Date('2026-05-01T12:00:00Z'),
  createdById: 'user-1',
};

describe('loadQuotes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.selectResults = [];
  });

  it('returns [] when there are no quotes', async () => {
    mocks.selectResults = [[]];
    expect(await loadQuotes()).toEqual([]);
  });

  it('maps a row with nullable audience-source join to the Quote shape', async () => {
    mocks.selectResults = [[baseRow]];
    const [q] = await loadQuotes();
    expect(q).toEqual({
      id: 7,
      dealerId: 3,
      dealerName: 'Capital Ford',
      dealerArchivedAt: null,
      status: 'draft',
      subtotal: '6900.00',
      tax: '1035.00',
      total: '7935.00',
      taxPct: '15.00',
      inputs: { audienceSize: 500, eventDays: 3 },
      lineItems: [],
      audienceSourceId: null,
      audienceSourceLabel: null,
      sentAt: null,
      acceptedAt: null,
      declinedAt: null,
      createdAt: baseRow.createdAt,
      createdById: 'user-1',
    });
  });

  it('preserves a present audience-source label and lifecycle timestamps', async () => {
    const sentAt = new Date('2026-05-04T10:00:00Z');
    mocks.selectResults = [
      [
        {
          ...baseRow,
          id: 8,
          status: 'sent' as const,
          audienceSourceId: 4,
          audienceSourceLabel: 'Previous Buyers',
          sentAt,
        },
      ],
    ];
    const [q] = await loadQuotes();
    expect(q.status).toBe('sent');
    expect(q.audienceSourceId).toBe(4);
    expect(q.audienceSourceLabel).toBe('Previous Buyers');
    expect(q.sentAt).toBe(sentAt);
  });
});

describe('loadQuote', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.selectResults = [];
  });

  it('returns null when the id is missing', async () => {
    mocks.selectResults = [[]];
    expect(await loadQuote(999)).toBeNull();
  });

  it('returns the mapped Quote when the id resolves', async () => {
    const lineItems = [
      {
        code: 'event-package',
        label: 'Event package',
        unit: 'flat',
        unitPrice: 5000,
        qty: 1,
        lineTotal: 5000,
      },
    ];
    mocks.selectResults = [[{ ...baseRow, lineItems }]];
    const q = await loadQuote(7);
    expect(q?.id).toBe(7);
    expect(q?.dealerName).toBe('Capital Ford');
    expect(q?.inputs).toEqual({ audienceSize: 500, eventDays: 3 });
    expect(q?.lineItems).toEqual(lineItems);
  });
});

describe('loadQuotesByDealer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.selectResults = [];
  });

  it('returns [] when the dealer has no quotes', async () => {
    mocks.selectResults = [[]];
    expect(await loadQuotesByDealer(42)).toEqual([]);
  });

  it('returns mapped rows for a dealer with quotes', async () => {
    mocks.selectResults = [
      [
        { ...baseRow, id: 11, dealerId: 42 },
        { ...baseRow, id: 12, dealerId: 42, status: 'accepted' as const },
      ],
    ];
    const rows = await loadQuotesByDealer(42);
    expect(rows.map((q) => ({ id: q.id, status: q.status }))).toEqual([
      { id: 11, status: 'draft' },
      { id: 12, status: 'accepted' },
    ]);
  });
});
