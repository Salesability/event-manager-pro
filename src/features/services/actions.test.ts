import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  assertCan: vi.fn(),
  getUser: vi.fn(),
  dbResults: [] as unknown[][],
  inserts: [] as Array<{ table: string; values: unknown }>,
  updates: [] as Array<{ table: string; patch: unknown }>,
  insertError: null as unknown,
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
  return {
    db: {
      insert: (table: unknown) => ({
        values: (values: unknown) => {
          if (mocks.insertError) {
            const err = mocks.insertError;
            mocks.insertError = null;
            return Promise.reject(err);
          }
          mocks.inserts.push({ table: tableName(table), values });
          return Promise.resolve([{ id: 999 }]);
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
    },
  };
});

import { archiveServiceItem, createServiceItem, updateServiceItem } from './actions';

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

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.append(k, v);
  return f;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.assertCan.mockResolvedValue({
    id: 'admin-uuid',
    app_metadata: { role: 'admin' },
  });
  mocks.getUser.mockResolvedValue({
    id: 'admin-uuid',
    email: 'admin@test.local',
    app_metadata: { role: 'admin' },
  });
  mocks.dbResults = [];
  mocks.inserts = [];
  mocks.updates = [];
  mocks.insertError = null;
});

describe('createServiceItem', () => {
  it('inserts a flat-priced item with normalized money', async () => {
    const result = await call(
      createServiceItem(
        fd({
          code: 'add-on',
          label: 'Add-on widget',
          unitPrice: '12.5',
          sortOrder: '9',
        }),
      ),
    );
    expect(result).toEqual({ ok: true });
    expect(mocks.inserts).toHaveLength(1);
    expect(mocks.inserts[0].table).toBe('service_items');
    const values = mocks.inserts[0].values as Record<string, unknown>;
    expect(values).toMatchObject({
      code: 'add-on',
      label: 'Add-on widget',
      unitPrice: '12.50',
      description: null,
      sortOrder: 9,
    });
  });

  it('inserts a variable item (blank unit price → null)', async () => {
    await call(createServiceItem(fd({ code: 'variable-cost', label: 'Variable' })));
    const values = mocks.inserts[0].values as Record<string, unknown>;
    expect(values.unitPrice).toBeNull();
  });

  it('lowercases the supplied code', async () => {
    await call(createServiceItem(fd({ code: 'Mixed-CASE', label: 'l' })));
    expect((mocks.inserts[0].values as Record<string, unknown>).code).toBe('mixed-case');
  });

  it('rejects when label is missing', async () => {
    const result = await call(createServiceItem(fd({ code: 'x' })));
    expect(result).toMatchObject({ error: 'Label is required.' });
    expect(mocks.inserts).toHaveLength(0);
  });

  it('rejects when code is missing', async () => {
    const result = await call(createServiceItem(fd({ label: 'L' })));
    expect(result).toMatchObject({ error: 'Code is required.' });
    expect(mocks.inserts).toHaveLength(0);
  });

  it('rejects code with disallowed characters', async () => {
    const result = await call(
      createServiceItem(fd({ code: 'bad_code!', label: 'L' })),
    );
    expect(result).toMatchObject({
      error: 'Code must be lowercase kebab-case (letters, digits, hyphens).',
    });
    expect(mocks.inserts).toHaveLength(0);
  });

  it('rejects negative price', async () => {
    const result = await call(
      createServiceItem(
        fd({ code: 'x', label: 'L', unitPrice: '-1' }),
      ),
    );
    expect(result).toMatchObject({
      error: 'Unit price must be a non-negative dollar amount with at most 8 whole digits and 2 decimal places.',
    });
  });

  it('rejects price with more than 2 decimal places (no IEEE-754 rounding)', async () => {
    const result = await call(
      createServiceItem(fd({ code: 'x', label: 'L', unitPrice: '2.675' })),
    );
    expect((result as { error: string }).error).toContain('2 decimal places');
    expect(mocks.inserts).toHaveLength(0);
  });

  it('rejects price over numeric(10,2) max', async () => {
    const result = await call(
      createServiceItem(
        fd({ code: 'x', label: 'L', unitPrice: '100000000' }),
      ),
    );
    expect((result as { error: string }).error).toContain('8 whole digits');
    expect(mocks.inserts).toHaveLength(0);
  });

  it('truncates trailing decimal silently to 2 places when input has exactly 2', async () => {
    await call(
      createServiceItem(fd({ code: 'x', label: 'L', unitPrice: '12.5' })),
    );
    expect((mocks.inserts[0].values as Record<string, unknown>).unitPrice).toBe('12.50');
  });

  it('rejects negative sortOrder', async () => {
    const result = await call(
      createServiceItem(fd({ code: 'x', label: 'L', sortOrder: '-3' })),
    );
    expect(result).toMatchObject({ error: 'Sort order must be a non-negative integer.' });
  });

  it('rejects sortOrder over PG integer max', async () => {
    const result = await call(
      createServiceItem(
        fd({ code: 'x', label: 'L', sortOrder: '2147483648' }),
      ),
    );
    expect(result).toMatchObject({ error: 'Sort order must be a non-negative integer.' });
  });

  it('un-archives an existing archived row with the same code (no fresh insert)', async () => {
    // First db round-trip (the un-archive UPDATE) returns one row → restored.
    mocks.dbResults.push([{ id: 7 }]);
    const result = await call(
      createServiceItem(
        fd({ code: 'base-event', label: 'Restored', unitPrice: '6900' }),
      ),
    );
    expect(result).toEqual({ ok: true });
    expect(mocks.inserts).toHaveLength(0);
    expect(mocks.updates).toHaveLength(1);
    const patch = mocks.updates[0].patch as Record<string, unknown>;
    expect(patch.archivedAt).toBeNull();
    expect(patch.label).toBe('Restored');
    expect(patch.unitPrice).toBe('6900.00');
  });

  it('maps unique-violation on code to a friendly error', async () => {
    mocks.insertError = Object.assign(new Error('duplicate key value violates unique constraint "service_items_code_unique"'), {
      code: '23505',
    });
    const result = await call(
      createServiceItem(fd({ code: 'base-event', label: 'L' })),
    );
    expect(result).toMatchObject({ error: 'That code is already in use.' });
  });

  it('rethrows non-duplicate db errors', async () => {
    mocks.insertError = new Error('connection refused');
    const r = await createServiceItem(
      fd({ code: 'x', label: 'L' }),
    );
    expect(r?.serverError).toBeTruthy();
  });

  // 0045 Phase 3 — schema-as-contract: action surfaces `fieldErrors` alongside
  // `error` so the A-shape `ServiceForm` can route per-field via `setError`.
  it('surfaces per-field errors on safeParse failure', async () => {
    const result = (await call(
      createServiceItem(
        fd({ code: 'bad_code!', label: '' }),
      ),
    )) as { error: string; fieldErrors: Record<string, string[]> };
    expect(result.fieldErrors.code?.[0]).toMatch(/kebab/i);
    expect(result.fieldErrors.label?.[0]).toBe('Label is required.');
    expect(mocks.inserts).toHaveLength(0);
  });
});

describe('updateServiceItem', () => {
  it('updates label/price on an active row', async () => {
    mocks.dbResults.push([{ id: 42 }]);
    const result = await call(
      updateServiceItem(
        fd({
          id: '42',
          label: 'Renamed',
          unitPrice: '750',
          sortOrder: '2',
        }),
      ),
    );
    expect(result).toEqual({ ok: true });
    expect(mocks.updates).toHaveLength(1);
    expect(mocks.updates[0].table).toBe('service_items');
    const patch = mocks.updates[0].patch as Record<string, unknown>;
    expect(patch).toMatchObject({
      label: 'Renamed',
      unitPrice: '750.00',
      sortOrder: 2,
    });
    expect(patch).not.toHaveProperty('code');
  });

  it('rejects invalid id', async () => {
    const result = await call(
      updateServiceItem(fd({ label: 'L' })),
    );
    expect(result).toMatchObject({ error: 'Invalid service-item id.' });
    expect(mocks.updates).toHaveLength(0);
  });

  it('returns not-found when no row matched', async () => {
    mocks.dbResults.push([]);
    const result = await call(
      updateServiceItem(fd({ id: '99', label: 'L' })),
    );
    expect(result).toMatchObject({ error: 'Service item not found.' });
  });
});

describe('archiveServiceItem', () => {
  it('sets archivedAt on an active row', async () => {
    mocks.dbResults.push([]);
    const result = await call(archiveServiceItem(fd({ id: '42' })));
    expect(result).toEqual({ ok: true });
    expect(mocks.updates).toHaveLength(1);
    const patch = mocks.updates[0].patch as Record<string, unknown>;
    expect(patch.archivedAt).toBeInstanceOf(Date);
  });

  it('rejects invalid id', async () => {
    const result = await call(archiveServiceItem(fd({})));
    expect(result).toMatchObject({ error: 'Invalid service-item id.' });
    expect(mocks.updates).toHaveLength(0);
  });
});
