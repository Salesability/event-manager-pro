import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mocks/scaffolding identical in shape to quotes/actions.test.ts + people's.
// Targets the dealer-side surface in `src/features/schedule/actions.ts` and
// covers the 0035 Phase 2 changes: `status` + `acquiredVia` on
// `createDealer` / `updateDealer`, plus the new `convertProspectToActive`.

const mocks = vi.hoisted(() => ({
  assertCan: vi.fn(),
  getUser: vi.fn(),
  loadCurrentMembership: vi.fn(),
  recordAudit: vi.fn(),
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
vi.mock('@/lib/auth/assert-can', () => ({ assertCan: mocks.assertCan }));
vi.mock('@/lib/supabase/session', () => ({ getUser: mocks.getUser }));
vi.mock('@/lib/auth/load-team-membership', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/auth/load-team-membership')>();
  return { ...real, loadCurrentMembership: mocks.loadCurrentMembership };
});
vi.mock('@/features/audit/actions', () => ({ recordAudit: mocks.recordAudit }));

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
              then: (onFulfilled: (v: unknown[]) => unknown) => next().then(onFulfilled),
            };
          },
        };
      },
    }),
    select: () => ({
      from: () => {
        const next = () => Promise.resolve(mocks.dbResults.shift() ?? []);
        const terminal = {
          limit: () => next(),
          orderBy: () => next(),
          then: (onFulfilled: (v: unknown[]) => unknown) => next().then(onFulfilled),
        };
        return { where: () => terminal };
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

import { convertProspectToActive, createDealer, updateDealer } from '../schedule/actions';

async function call<T>(
  p: Promise<{ data?: T; serverError?: string; validationErrors?: unknown } | undefined | null>,
): Promise<T> {
  const r = await p;
  if (!r) throw new Error('action returned null/undefined');
  if (r.serverError) throw new Error(`unexpected serverError: ${r.serverError}`);
  if (r.validationErrors) {
    throw new Error(`unexpected validationErrors: ${JSON.stringify(r.validationErrors)}`);
  }
  if (r.data === undefined) throw new Error('action returned undefined data');
  return r.data;
}

function fd(entries: Record<string, string> = {}): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.append(k, v);
  return f;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.assertCan.mockResolvedValue({ id: 'admin-uuid', app_metadata: { role: 'admin' } });
  mocks.getUser.mockResolvedValue({
    id: 'admin-uuid',
    email: 'admin@test.local',
    app_metadata: { role: 'admin' },
  });
  mocks.loadCurrentMembership.mockResolvedValue(null);
  mocks.dbResults = [];
  mocks.inserts = [];
  mocks.updates = [];
});

describe('createDealer', () => {
  it("defaults status='active' when no status submitted (back-office add)", async () => {
    const result = await call(createDealer(fd({ name: 'Acme Motors' })));
    expect(result).toEqual({ ok: true });
    const dealerInsert = mocks.inserts.find((i) => i.table === 'dealers');
    const values = dealerInsert!.values as Record<string, unknown>;
    expect(values.status).toBe('active');
    expect(values.acquiredVia).toBeNull();
  });

  it("accepts explicit status='prospect' (inline composer path)", async () => {
    await call(createDealer(fd({ name: 'Acme', status: 'prospect' })));
    const dealerInsert = mocks.inserts.find((i) => i.table === 'dealers');
    expect((dealerInsert!.values as Record<string, unknown>).status).toBe('prospect');
  });

  it('persists acquiredVia text', async () => {
    await call(
      createDealer(fd({ name: 'Acme', status: 'prospect', acquiredVia: 'Book Your Event form' })),
    );
    const dealerInsert = mocks.inserts.find((i) => i.table === 'dealers');
    expect((dealerInsert!.values as Record<string, unknown>).acquiredVia).toBe(
      'Book Your Event form',
    );
  });

  it('rejects invalid status enum value', async () => {
    const result = await call(createDealer(fd({ name: 'Acme', status: 'bogus' })));
    expect(result).toMatchObject({ error: 'Invalid dealer status.' });
    expect(mocks.inserts).toHaveLength(0);
  });

  it('rejects acquiredVia over 200 chars', async () => {
    const result = await call(
      createDealer(fd({ name: 'Acme', acquiredVia: 'x'.repeat(201) })),
    );
    expect(result).toMatchObject({
      error: 'Acquired-via must be 200 characters or fewer.',
    });
    expect(mocks.inserts).toHaveLength(0);
  });

  it('still rejects when name is missing', async () => {
    const result = await call(createDealer(fd({})));
    expect(result).toMatchObject({ error: 'Dealership name is required.' });
    expect(mocks.inserts).toHaveLength(0);
  });

  // 0045 Phase 2 — schema-as-contract: action returns `fieldErrors` alongside
  // `error` so a future form consumer can route per-field via `setError`.
  it('surfaces per-field errors on safeParse failure', async () => {
    const result = (await call(
      createDealer(fd({ name: 'Acme', status: 'bogus', acquiredVia: 'x'.repeat(201) })),
    )) as { error: string; fieldErrors: Record<string, string[]> };
    expect(result.fieldErrors.status).toEqual(['Invalid dealer status.']);
    expect(result.fieldErrors.acquiredVia).toEqual([
      'Acquired-via must be 200 characters or fewer.',
    ]);
  });
});

describe('updateDealer', () => {
  it("omits status from SET when not submitted (no clobber of concurrent flip)", async () => {
    // Guarded UPDATE returns one row → success.
    mocks.dbResults.push([{ id: 42 }]);
    await call(updateDealer(fd({ id: '42', name: 'Renamed' })));
    const dealerUpdate = mocks.updates.find((u) => u.table === 'dealers');
    expect(dealerUpdate!.patch as Record<string, unknown>).not.toHaveProperty('status');
  });

  it('omits acquiredVia from SET when not submitted (no accidental clear)', async () => {
    mocks.dbResults.push([{ id: 42 }]);
    await call(updateDealer(fd({ id: '42', name: 'Renamed' })));
    const dealerUpdate = mocks.updates.find((u) => u.table === 'dealers');
    expect(dealerUpdate!.patch as Record<string, unknown>).not.toHaveProperty('acquiredVia');
  });

  it("flips status when explicitly submitted", async () => {
    mocks.dbResults.push([{ id: 42 }]);
    await call(updateDealer(fd({ id: '42', name: 'Acme', status: 'active' })));
    const dealerUpdate = mocks.updates.find((u) => u.table === 'dealers');
    expect((dealerUpdate!.patch as Record<string, unknown>).status).toBe('active');
  });

  it('clears acquiredVia when an empty value is explicitly submitted', async () => {
    mocks.dbResults.push([{ id: 42 }]);
    await call(updateDealer(fd({ id: '42', name: 'Acme', acquiredVia: '' })));
    const dealerUpdate = mocks.updates.find((u) => u.table === 'dealers');
    expect((dealerUpdate!.patch as Record<string, unknown>).acquiredVia).toBeNull();
  });

  it('rejects invalid status on update', async () => {
    const result = await call(
      updateDealer(fd({ id: '42', name: 'Acme', status: 'bogus' })),
    );
    expect(result).toMatchObject({ error: 'Invalid dealer status.' });
    expect(mocks.updates).toHaveLength(0);
  });

  it("treats status='' as absent (preserve existing status, omit from patch)", async () => {
    // Regression guard for 0045 eval Codex Medium: empty-string status from a
    // programmatic caller would otherwise fail `z.enum(...).optional()`. The
    // action layer normalises `status='' → absent` before safeParse.
    mocks.dbResults.push([{ id: 42 }]);
    await call(updateDealer(fd({ id: '42', name: 'Acme', status: '' })));
    const dealerUpdate = mocks.updates.find((u) => u.table === 'dealers');
    expect(dealerUpdate!.patch as Record<string, unknown>).not.toHaveProperty('status');
  });

  it('returns "Dealer not found" when the guarded UPDATE matches no row (archived or missing)', async () => {
    mocks.dbResults.push([]);
    const result = await call(updateDealer(fd({ id: '99', name: 'Acme' })));
    expect(result).toEqual({ error: 'Dealer not found.' });
  });
});

describe('convertProspectToActive', () => {
  it('flips prospect → active and emits audit', async () => {
    mocks.dbResults.push([{ id: 7 }]); // guarded UPDATE returns one row
    const result = await call(convertProspectToActive(fd({ id: '7' })));
    expect(result).toEqual({ ok: true });
    const patch = mocks.updates[0].patch as Record<string, unknown>;
    expect(patch.status).toBe('active');
    expect(patch.updatedById).toBe('admin-uuid');
    expect(mocks.recordAudit).toHaveBeenCalledWith({
      action: 'dealer.activated',
      targetTable: 'dealers',
      targetId: 7,
      payload: { from: 'prospect' },
    });
  });

  it('is a no-op when the dealer is already active (no audit emit)', async () => {
    mocks.dbResults.push([]); // guarded UPDATE matches nothing → already-active or archived
    const result = await call(convertProspectToActive(fd({ id: '7' })));
    expect(result).toEqual({ ok: true });
    expect(mocks.recordAudit).not.toHaveBeenCalled();
  });

  it('is a no-op when the dealer is archived (no audit emit)', async () => {
    mocks.dbResults.push([]); // guarded UPDATE with archivedAt IS NULL won't match
    const result = await call(convertProspectToActive(fd({ id: '7' })));
    expect(result).toEqual({ ok: true });
    expect(mocks.recordAudit).not.toHaveBeenCalled();
  });

  it('rejects invalid id without a db round-trip', async () => {
    const result = await call(convertProspectToActive(fd({})));
    expect(result).toEqual({ error: 'Invalid dealer id.' });
    expect(mocks.updates).toHaveLength(0);
  });
});
