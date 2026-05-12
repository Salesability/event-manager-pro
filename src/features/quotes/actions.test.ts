import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  assertCan: vi.fn(),
  getUser: vi.fn(),
  loadCurrentMembership: vi.fn(),
  recordAudit: vi.fn(),
  // Queue consumed by both `.returning()` calls and `.then()` / `.limit()`
  // terminals on the predicate-blind db mock. Push one entry per DB round-trip
  // in the order the code under test will issue them.
  dbResults: [] as unknown[][],
  inserts: [] as Array<{ table: string; values: unknown }>,
  updates: [] as Array<{ table: string; patch: unknown }>,
}));

vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({
  redirect: (path: string) => {
    const err = new Error(`NEXT_REDIRECT;replace;${path};307;`);
    (err as Error & { digest: string }).digest = `NEXT_REDIRECT;replace;${path};307;`;
    throw err;
  },
}));
vi.mock('@/lib/auth/assert-can', () => ({
  assertCan: mocks.assertCan,
}));
vi.mock('@/lib/supabase/session', () => ({ getUser: mocks.getUser }));
vi.mock('@/lib/auth/load-team-membership', async (importOriginal) => {
  const real =
    await importOriginal<typeof import('@/lib/auth/load-team-membership')>();
  return {
    ...real,
    loadCurrentMembership: mocks.loadCurrentMembership,
  };
});
vi.mock('@/features/audit/actions', () => ({
  recordAudit: mocks.recordAudit,
}));

vi.mock('@/lib/db', () => {
  function tableName(t: unknown): string {
    if (typeof t === 'object' && t != null) {
      const sym = Object.getOwnPropertySymbols(t).find(
        (s) => s.description === 'drizzle:Name',
      );
      if (sym) return String((t as Record<symbol, unknown>)[sym]);
    }
    return 'unknown';
  }
  const txStub = {
    insert: (table: unknown) => ({
      values: (values: unknown) => {
        mocks.inserts.push({ table: tableName(table), values });
        return {
          returning: async () => mocks.dbResults.shift() ?? [{ id: 999 }],
        };
      },
    }),
    update: (table: unknown) => ({
      set: (patch: unknown) => {
        mocks.updates.push({ table: tableName(table), patch });
        return {
          where: () => {
            const next = () => Promise.resolve(mocks.dbResults.shift() ?? []);
            return {
              returning: () => next(),
              then: (onFulfilled: (v: unknown[]) => unknown) =>
                next().then(onFulfilled),
            };
          },
        };
      },
    }),
    select: () => ({
      from: () => {
        const next = () => Promise.resolve(mocks.dbResults.shift() ?? []);
        const terminal: {
          limit: () => Promise<unknown[]>;
          orderBy: () => Promise<unknown[]>;
          for: () => typeof terminal;
          then: (onFulfilled: (v: unknown[]) => unknown) => Promise<unknown>;
        } = {
          limit: () => next(),
          orderBy: () => next(),
          // `.for('update')` — row-lock chain. Mirror the terminal so a
          // subsequent .limit()/.then() works on top of it.
          for: () => terminal,
          then: (onFulfilled: (v: unknown[]) => unknown) => next().then(onFulfilled),
        };
        return {
          where: () => terminal,
        };
      },
    }),
  };
  return {
    db: {
      ...txStub,
      transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(txStub),
    },
  };
});

import {
  createQuote,
  declineQuote,
  sendQuote,
  setQuoteDealer,
  setQuoteInputs,
  setQuoteTax,
} from './actions';
import { markQuoteAccepted, markQuoteDeclined } from './lifecycle';

// Unwrap the next-safe-action envelope into the legacy ActionResult shape.
async function call<T>(
  p: Promise<{ data?: T; serverError?: string; validationErrors?: unknown } | undefined | null>,
): Promise<T> {
  const r = await p;
  if (!r) throw new Error('action returned null/undefined');
  if (r.serverError) throw new Error(`unexpected serverError: ${r.serverError}`);
  if (r.validationErrors) {
    throw new Error(`unexpected validationErrors: ${JSON.stringify(r.validationErrors)}`);
  }
  if (r.data === undefined) {
    throw new Error('action returned undefined data');
  }
  return r.data;
}

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.append(k, v);
  return f;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.assertCan.mockResolvedValue({
    id: 'coach-uuid',
    app_metadata: { role: 'admin' },
  });
  mocks.getUser.mockResolvedValue({
    id: 'coach-uuid',
    email: 'coach@test.local',
    app_metadata: { role: 'admin' },
  });
  mocks.loadCurrentMembership.mockResolvedValue(null);
  mocks.dbResults = [];
  mocks.inserts = [];
  mocks.updates = [];
});

describe('createQuote', () => {
  it('inserts a draft quote for an active dealer and emits audit', async () => {
    mocks.dbResults.push([{ id: 7 }], [{ id: 42 }]);

    const result = await call(createQuote(fd({ dealerId: '7' })));

    expect(result).toEqual({ ok: true, quoteId: 42 });
    expect(mocks.inserts).toHaveLength(1);
    expect(mocks.inserts[0].table).toBe('quotes');
    const values = mocks.inserts[0].values as Record<string, unknown>;
    expect(values.dealerId).toBe(7);
    expect(values.inputs).toMatchObject({ audienceSize: 500, eventDays: 1 });
    expect(values.createdById).toBe('coach-uuid');
    expect(mocks.recordAudit).toHaveBeenCalledWith({
      action: 'quote.create',
      targetTable: 'quotes',
      targetId: 42,
      payload: { dealerId: 7 },
    });
  });

  it('rejects when dealerId is missing', async () => {
    const result = await call(createQuote(fd({})));
    expect(result).toEqual({ error: 'Dealer is required.' });
    expect(mocks.inserts).toHaveLength(0);
    expect(mocks.recordAudit).not.toHaveBeenCalled();
  });

  it('rejects when dealer is missing or archived', async () => {
    mocks.dbResults.push([]); // dealer lookup returns nothing (archivedAt-aware)
    const result = await call(createQuote(fd({ dealerId: '99' })));
    expect(result).toEqual({ error: 'Dealer not found or archived.' });
    expect(mocks.inserts).toHaveLength(0);
    expect(mocks.recordAudit).not.toHaveBeenCalled();
  });
});

describe('sendQuote', () => {
  it('flips draft → sent atomically, sets sentAt, and emits audit', async () => {
    // Guarded UPDATE returns one row → transition succeeded.
    mocks.dbResults.push([{ id: 42 }]);
    const result = await call(sendQuote(fd({ quoteId: '42' })));
    expect(result).toEqual({ ok: true });
    expect(mocks.updates).toHaveLength(1);
    expect(mocks.updates[0].table).toBe('quotes');
    const patch = mocks.updates[0].patch as Record<string, unknown>;
    expect(patch.status).toBe('sent');
    expect(patch.sentAt).toBeInstanceOf(Date);
    expect(mocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'quote.sent', targetId: 42 }),
    );
  });

  it('is idempotent on already-sent (UPDATE misses, re-select finds sent)', async () => {
    // Guarded UPDATE returns no rows (guard missed) → re-select finds 'sent'.
    mocks.dbResults.push([], [{ id: 42, status: 'sent' }]);
    const result = await call(sendQuote(fd({ quoteId: '42' })));
    expect(result).toEqual({ ok: true });
    expect(mocks.recordAudit).not.toHaveBeenCalled();
  });

  it('rejects send from accepted or declined (illegal source status)', async () => {
    mocks.dbResults.push([], [{ id: 42, status: 'accepted' }]);
    const result = await call(sendQuote(fd({ quoteId: '42' })));
    expect(result).toEqual({ error: "Quote cannot be sent from status 'accepted'." });
  });

  it('rejects when the quote does not exist', async () => {
    mocks.dbResults.push([], []); // guard miss + row gone
    const result = await call(sendQuote(fd({ quoteId: '999' })));
    expect(result).toEqual({ error: 'Quote not found.' });
  });

  it('rejects invalid quote id without any db round-trip', async () => {
    const result = await call(sendQuote(fd({})));
    expect(result).toEqual({ error: 'Invalid quote id.' });
    expect(mocks.updates).toHaveLength(0);
  });
});

describe('declineQuote (staff-side)', () => {
  it('flips sent → declined and emits audit with source=staff', async () => {
    // markQuoteDeclined → guarded UPDATE returns one row.
    mocks.dbResults.push([{ id: 42 }]);
    const result = await call(declineQuote(fd({ quoteId: '42' })));
    expect(result).toEqual({ ok: true });
    expect((mocks.updates[0].patch as Record<string, unknown>).status).toBe('declined');
    expect((mocks.updates[0].patch as Record<string, unknown>).declinedAt).toBeInstanceOf(Date);
    expect(mocks.recordAudit).toHaveBeenCalledWith({
      action: 'quote.declined',
      targetTable: 'quotes',
      targetId: 42,
      payload: { source: 'staff' },
    });
  });

  it('is idempotent on already-declined — no audit emit', async () => {
    // Guarded UPDATE misses; re-select finds 'declined'.
    mocks.dbResults.push([], [{ id: 42, status: 'declined' }]);
    const result = await call(declineQuote(fd({ quoteId: '42' })));
    expect(result).toEqual({ ok: true });
    expect(mocks.recordAudit).not.toHaveBeenCalled();
  });

  it('rejects decline of a draft quote', async () => {
    mocks.dbResults.push([], [{ id: 42, status: 'draft' }]);
    const result = await call(declineQuote(fd({ quoteId: '42' })));
    expect(result).toEqual({ error: "Quote cannot be declined from status 'draft'." });
  });
});

describe('markQuoteAccepted (internal helper)', () => {
  it('flips sent → accepted atomically and reports transitioned:true', async () => {
    mocks.dbResults.push([{ id: 42 }]);
    const result = await markQuoteAccepted(42, 'public-uuid');
    expect(result).toEqual({ ok: true, transitioned: true });
    const patch = mocks.updates[0].patch as Record<string, unknown>;
    expect(patch.status).toBe('accepted');
    expect(patch.acceptedAt).toBeInstanceOf(Date);
    expect(patch.updatedById).toBe('public-uuid');
  });

  it('reports transitioned:false on already-accepted', async () => {
    mocks.dbResults.push([], [{ id: 42, status: 'accepted' }]);
    const result = await markQuoteAccepted(42);
    expect(result).toEqual({ ok: true, transitioned: false });
  });

  it('rejects accept from a non-sent status', async () => {
    mocks.dbResults.push([], [{ id: 42, status: 'draft' }]);
    const result = await markQuoteAccepted(42);
    expect(result).toEqual({ error: "Quote cannot be accepted from status 'draft'." });
  });

  it('errors when the quote does not exist', async () => {
    mocks.dbResults.push([], []);
    const result = await markQuoteAccepted(999);
    expect(result).toEqual({ error: 'Quote not found.' });
  });

  it('omits updatedById when caller passes null (public route has no user)', async () => {
    mocks.dbResults.push([{ id: 42 }]);
    await markQuoteAccepted(42, null);
    expect(mocks.updates[0].patch).not.toHaveProperty('updatedById');
  });
});

describe('markQuoteDeclined (internal helper)', () => {
  it('flips sent → declined atomically and reports transitioned:true', async () => {
    mocks.dbResults.push([{ id: 42 }]);
    const result = await markQuoteDeclined(42, 'public-uuid');
    expect(result).toEqual({ ok: true, transitioned: true });
    const patch = mocks.updates[0].patch as Record<string, unknown>;
    expect(patch.status).toBe('declined');
    expect(patch.declinedAt).toBeInstanceOf(Date);
  });

  it('reports transitioned:false on already-declined', async () => {
    mocks.dbResults.push([], [{ id: 42, status: 'declined' }]);
    const result = await markQuoteDeclined(42);
    expect(result).toEqual({ ok: true, transitioned: false });
  });

  it('rejects decline from a non-sent status', async () => {
    mocks.dbResults.push([], [{ id: 42, status: 'accepted' }]);
    const result = await markQuoteDeclined(42);
    expect(result).toEqual({ error: "Quote cannot be declined from status 'accepted'." });
  });
});

// Minimal service-items catalog used by the composer setters. Mirrors the
// shape that `loadActiveCatalog` returns in production.
const CATALOG_FIXTURE = [
  {
    id: 1,
    code: 'base-event',
    label: 'Base Event',
    unit: 'flat',
    unitPrice: '6900.00',
    unitPriceMin: null,
    unitPriceMax: null,
    description: null,
    sortOrder: 0,
  },
  {
    id: 2,
    code: 'additional-contact',
    label: 'Additional Contact',
    unit: 'per-record',
    unitPrice: '3.00',
    unitPriceMin: null,
    unitPriceMax: null,
    description: null,
    sortOrder: 1,
  },
];

describe('createQuote (composer Save-Draft path)', () => {
  it('persists inputs + computed lines + totals when `inputs` is submitted', async () => {
    // db round-trips: catalog SELECT (loadActiveCatalog before tx), then
    // inside transaction: dealer FOR-UPDATE SELECT, then insert returns id.
    mocks.dbResults.push(CATALOG_FIXTURE, [{ id: 7 }], [{ id: 99 }]);
    const result = await call(
      createQuote(
        fd({
          dealerId: '7',
          inputs: JSON.stringify({ audienceSize: 700, eventDays: 1 }),
          tax: '50',
        }),
      ),
    );
    expect(result).toEqual({ ok: true, quoteId: 99 });
    const insert = mocks.inserts[0].values as Record<string, unknown>;
    expect(insert.inputs).toMatchObject({ audienceSize: 700, eventDays: 1 });
    // base 6900 + 200 × 3 = 7500 subtotal, + 50 tax = 7550 total.
    expect(insert.subtotal).toBe('7500.00');
    expect(insert.tax).toBe('50.00');
    expect(insert.total).toBe('7550.00');
    expect(Array.isArray(insert.lineItems)).toBe(true);
  });

  it('rejects bad JSON in inputs payload', async () => {
    const result = await call(
      createQuote(fd({ dealerId: '7', inputs: 'not-json' })),
    );
    expect(result).toEqual({ error: 'Quote inputs payload is not valid JSON.' });
    expect(mocks.inserts).toHaveLength(0);
  });

  it('rejects inputs failing validation (negative count)', async () => {
    mocks.dbResults.push(CATALOG_FIXTURE);
    const result = await call(
      createQuote(
        fd({
          dealerId: '7',
          inputs: JSON.stringify({ bdcCallCount: -1 }),
        }),
      ),
    );
    expect((result as { error: string }).error).toContain('bdcCallCount');
    expect(mocks.inserts).toHaveLength(0);
  });

  it('discards unknown JSON keys instead of persisting them', async () => {
    mocks.dbResults.push(CATALOG_FIXTURE, [{ id: 7 }], [{ id: 99 }]);
    await call(
      createQuote(
        fd({
          dealerId: '7',
          inputs: JSON.stringify({
            audienceSize: 500,
            __proto__: { polluted: true },
            constructor: { prototype: { x: 1 } },
            blob: 'garbage',
          }),
        }),
      ),
    );
    const insert = mocks.inserts[0].values as Record<string, unknown>;
    const persistedInputs = insert.inputs as Record<string, unknown>;
    expect(persistedInputs).not.toHaveProperty('blob');
    expect(persistedInputs).not.toHaveProperty('constructor');
    // Canonical fields are present.
    expect(persistedInputs.audienceSize).toBe(500);
    expect(persistedInputs.eventDays).toBe(1);
  });
});

describe('setQuoteInputs', () => {
  it('updates inputs + recomputes lines/totals on a draft quote', async () => {
    // status SELECT, catalog SELECT, then UPDATE.returning() returns one row.
    mocks.dbResults.push(
      [{ status: 'draft', tax: '0' }],
      CATALOG_FIXTURE,
      [{ id: 42 }],
    );
    const result = await call(
      setQuoteInputs(
        fd({
          quoteId: '42',
          inputs: JSON.stringify({ audienceSize: 600, eventDays: 1 }),
        }),
      ),
    );
    expect(result).toEqual({ ok: true });
    const patch = mocks.updates[0].patch as Record<string, unknown>;
    expect(patch.inputs).toMatchObject({ audienceSize: 600 });
    // base 6900 + 100 × 3 = 7200; tax preserved at 0.
    expect(patch.subtotal).toBe('7200.00');
    expect(patch.total).toBe('7200.00');
  });

  it('rejects when concurrent send races past the read-then-write window', async () => {
    // status SELECT returns draft, catalog SELECT, UPDATE.returning() returns
    // [] (concurrent transition between our SELECT and UPDATE), then
    // re-classify SELECT finds the row now in `sent`.
    mocks.dbResults.push(
      [{ status: 'draft', tax: '0' }],
      CATALOG_FIXTURE,
      [],
      [{ status: 'sent' }],
    );
    const result = await call(
      setQuoteInputs(fd({ quoteId: '42', inputs: JSON.stringify({ audienceSize: 500 }) })),
    );
    expect(result).toEqual({ error: "Quote cannot be edited in status 'sent'." });
  });

  it('rejects edit on a sent quote', async () => {
    mocks.dbResults.push([{ status: 'sent', tax: '0' }]);
    const result = await call(
      setQuoteInputs(
        fd({ quoteId: '42', inputs: JSON.stringify({ audienceSize: 600 }) }),
      ),
    );
    expect(result).toEqual({ error: "Quote cannot be edited in status 'sent'." });
    expect(mocks.updates).toHaveLength(0);
  });

  it('rejects when the quote is gone', async () => {
    mocks.dbResults.push([]);
    const result = await call(
      setQuoteInputs(fd({ quoteId: '42', inputs: JSON.stringify({}) })),
    );
    expect(result).toEqual({ error: 'Quote not found.' });
  });

  it('rejects invalid id without a db round-trip', async () => {
    const result = await call(setQuoteInputs(fd({ inputs: '{}' })));
    expect(result).toEqual({ error: 'Invalid quote id.' });
  });
});

describe('setQuoteTax', () => {
  it('overrides tax and recomputes total = subtotal + tax', async () => {
    // status SELECT, then UPDATE.returning() returns one row.
    mocks.dbResults.push([{ status: 'draft', subtotal: '7500.00' }], [{ id: 42 }]);
    const result = await call(setQuoteTax(fd({ quoteId: '42', tax: '1125' })));
    expect(result).toEqual({ ok: true });
    const patch = mocks.updates[0].patch as Record<string, unknown>;
    expect(patch.tax).toBe('1125.00');
    expect(patch.total).toBe('8625.00');
  });

  it('rejects negative tax', async () => {
    const result = await call(setQuoteTax(fd({ quoteId: '42', tax: '-5' })));
    expect((result as { error: string }).error).toMatch(/non-negative/);
  });

  it('rejects tax with more than 2 decimal places (no IEEE-754 drift between paths)', async () => {
    const result = await call(setQuoteTax(fd({ quoteId: '42', tax: '2.675' })));
    expect((result as { error: string }).error).toContain('2 decimal places');
  });

  it('rejects tax above the dollar cap (matches pricing module)', async () => {
    const result = await call(setQuoteTax(fd({ quoteId: '42', tax: '999999999999' })));
    expect((result as { error: string }).error).toContain('Tax must be ≤');
  });

  it('rejects edit on non-draft quote', async () => {
    mocks.dbResults.push([{ status: 'accepted', subtotal: '7500.00' }]);
    const result = await call(setQuoteTax(fd({ quoteId: '42', tax: '100' })));
    expect(result).toEqual({ error: "Quote cannot be edited in status 'accepted'." });
  });

  it('rejects when concurrent send races past the read-then-write window', async () => {
    mocks.dbResults.push(
      [{ status: 'draft', subtotal: '7500.00' }],
      [],
      [{ status: 'sent' }],
    );
    const result = await call(setQuoteTax(fd({ quoteId: '42', tax: '100' })));
    expect(result).toEqual({ error: "Quote cannot be edited in status 'sent'." });
  });
});

describe('setQuoteDealer', () => {
  it('flips dealer on a draft quote when the new dealer is active', async () => {
    mocks.dbResults.push([{ id: 9 }], [{ id: 42 }]);
    const result = await call(setQuoteDealer(fd({ quoteId: '42', dealerId: '9' })));
    expect(result).toEqual({ ok: true });
    expect((mocks.updates[0].patch as Record<string, unknown>).dealerId).toBe(9);
  });

  it('rejects when the new dealer is missing or archived', async () => {
    mocks.dbResults.push([]);
    const result = await call(setQuoteDealer(fd({ quoteId: '42', dealerId: '99' })));
    expect(result).toEqual({ error: 'Dealer not found or archived.' });
  });

  it('rejects edit on non-draft quote', async () => {
    // dealer ok, guarded UPDATE misses, re-select finds status='sent'.
    mocks.dbResults.push([{ id: 9 }], [], [{ status: 'sent' }]);
    const result = await call(setQuoteDealer(fd({ quoteId: '42', dealerId: '9' })));
    expect(result).toEqual({ error: "Quote cannot be edited in status 'sent'." });
  });
});
