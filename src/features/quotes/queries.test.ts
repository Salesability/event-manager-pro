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

import { loadQuote, loadQuoteSendHistory, loadQuotes, loadQuotesByDealer } from './queries';

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
  audienceSourceId: null,
  audienceSourceLabel: null,
  sentAt: null,
  sentToEmail: null,
  sentToFirstName: null,
  acceptedAt: null,
  declinedAt: null,
  pdfStorageKey: null,
  quoteValidDays: 30,
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
      pickedLines: [],
      audienceSourceId: null,
      audienceSourceLabel: null,
      sentAt: null,
      sentToEmail: null,
      sentToFirstName: null,
      acceptedAt: null,
      declinedAt: null,
      pdfStorageKey: null,
      quoteValidDays: 30,
      isExpired: false,
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
          sentToEmail: 'buyer@dealer.test',
          sentToFirstName: 'Pat',
          pdfStorageKey: 'quotes/8/1.pdf',
        },
      ],
    ];
    const [q] = await loadQuotes();
    expect(q.status).toBe('sent');
    expect(q.audienceSourceId).toBe(4);
    expect(q.audienceSourceLabel).toBe('Previous Buyers');
    expect(q.sentAt).toBe(sentAt);
    expect(q.sentToEmail).toBe('buyer@dealer.test');
    expect(q.sentToFirstName).toBe('Pat');
    expect(q.pdfStorageKey).toBe('quotes/8/1.pdf');
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
    // FIFO: [0] the quote row, [1] the quote_line_items rows (empty here).
    mocks.selectResults = [[{ ...baseRow }], []];
    const q = await loadQuote(7);
    expect(q?.id).toBe(7);
    expect(q?.dealerName).toBe('Capital Ford');
    expect(q?.inputs).toEqual({ audienceSize: 500, eventDays: 3 });
    expect(q?.pickedLines).toEqual([]);
  });

  // 0062 Phase 3 — picker rehydration from the quote_line_items table.
  it('rehydrates pickedLines from the quote_line_items table when rows exist', async () => {
    const lineRows = [
      {
        serviceItemId: 10,
        code: 'vip-event',
        label: 'VIP Event',
        description: 'Premium on-site activation',
        qty: 2,
        unitPrice: '2500.00',
        overrideUnitPrice: '2000.00',
        lineTotal: '4000.00',
      },
    ];
    // FIFO: [0] the quote row, [1] the quote_line_items rows.
    mocks.selectResults = [[{ ...baseRow }], lineRows];
    const q = await loadQuote(7);
    expect(q?.pickedLines).toEqual([
      {
        serviceItemId: 10,
        code: 'vip-event',
        label: 'VIP Event',
        description: 'Premium on-site activation',
        qty: 2,
        unitPrice: 2500,
        overrideUnitPrice: 2000,
        lineTotal: 4000,
      },
    ]);
  });

  it('returns empty pickedLines when the table has no rows', async () => {
    mocks.selectResults = [[{ ...baseRow }], []];
    const q = await loadQuote(7);
    expect(q?.pickedLines).toEqual([]);
  });

  // 0044 Phase 3 — derived isExpired projection (Option B: no enum extension,
  // no migration; underlying row stays `status='sent'`).
  it('projects isExpired=true on a sent quote past its validity window', async () => {
    const sentAt = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000);
    mocks.selectResults = [
      [{ ...baseRow, status: 'sent' as const, sentAt, quoteValidDays: 30 }],
    ];
    const q = await loadQuote(7);
    expect(q?.status).toBe('sent');
    expect(q?.isExpired).toBe(true);
  });

  it('projects isExpired=false on a sent quote still within its window', async () => {
    const sentAt = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
    mocks.selectResults = [
      [{ ...baseRow, status: 'sent' as const, sentAt, quoteValidDays: 30 }],
    ];
    const q = await loadQuote(7);
    expect(q?.isExpired).toBe(false);
  });

  it('projects isExpired=false on an accepted quote even if past sentAt+quoteValidDays (status precedence)', async () => {
    // Past the would-be expiry window, but the row is already `accepted` —
    // the derived expiry only applies inside the `sent` branch (OQ #2).
    const sentAt = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
    mocks.selectResults = [
      [{ ...baseRow, status: 'accepted' as const, sentAt, quoteValidDays: 30 }],
    ];
    const q = await loadQuote(7);
    expect(q?.status).toBe('accepted');
    expect(q?.isExpired).toBe(false);
  });

  it('projects isExpired=false on a draft quote (sentAt=null)', async () => {
    mocks.selectResults = [
      [{ ...baseRow, status: 'draft' as const, sentAt: null }],
    ];
    const q = await loadQuote(7);
    expect(q?.isExpired).toBe(false);
  });
});

describe('loadQuoteSendHistory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.selectResults = [];
  });

  it('returns [] when no quote.sent audit rows exist', async () => {
    mocks.selectResults = [[]];
    expect(await loadQuoteSendHistory(7)).toEqual([]);
  });

  it('returns a single-element array on a first-send-only quote', async () => {
    const occurredAt = new Date('2026-05-12T10:00:00Z');
    mocks.selectResults = [
      [
        {
          occurredAt,
          actorUserId: 'coach-uuid',
          payload: { pdfStorageKey: 'quotes/7/1.pdf', emailId: 'resend-msg-id' },
        },
      ],
    ];
    const history = await loadQuoteSendHistory(7);
    expect(history).toEqual([
      {
        occurredAt,
        actorUserId: 'coach-uuid',
        payload: { pdfStorageKey: 'quotes/7/1.pdf', emailId: 'resend-msg-id' },
      },
    ]);
  });

  it('passes through every quote.sent row in the order the db returned them (desc occurredAt)', async () => {
    // db mock relays the .orderBy() shape — the query layer is what builds
    // the `desc(occurredAt)` predicate. Asserting that 3 rows in descending
    // order pass through unmolested locks in the multi-row contract.
    const latest = new Date('2026-05-12T16:00:00Z');
    const mid = new Date('2026-05-12T12:00:00Z');
    const first = new Date('2026-05-12T08:00:00Z');
    mocks.selectResults = [
      [
        { occurredAt: latest, actorUserId: 'coach-a', payload: { emailId: 'resend-3' } },
        { occurredAt: mid, actorUserId: 'coach-b', payload: { emailId: 'resend-2' } },
        { occurredAt: first, actorUserId: 'coach-a', payload: { emailId: 'resend-1' } },
      ],
    ];
    const history = await loadQuoteSendHistory(7);
    expect(history.map((r) => (r.payload as { emailId: string }).emailId)).toEqual([
      'resend-3',
      'resend-2',
      'resend-1',
    ]);
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
