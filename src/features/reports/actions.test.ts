import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  assertCan: vi.fn(),
  getUser: vi.fn(),
  deletes: [] as Array<{ table: string }>,
  inserts: [] as Array<{ table: string; values: unknown; conflict: unknown }>,
  throwOnWrite: false,
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

vi.mock('@/lib/db', () => {
  function tableName(t: unknown): string {
    if (typeof t === 'object' && t != null) {
      const sym = Object.getOwnPropertySymbols(t).find((s) => s.description === 'drizzle:Name');
      if (sym) return String((t as Record<symbol, unknown>)[sym]);
    }
    return 'unknown';
  }
  return {
    db: {
      delete: (table: unknown) => ({
        where: async () => {
          if (mocks.throwOnWrite) throw new Error('boom');
          mocks.deletes.push({ table: tableName(table) });
          return [];
        },
      }),
      insert: (table: unknown) => ({
        values: (values: unknown) => ({
          onConflictDoUpdate: async (conflict: unknown) => {
            if (mocks.throwOnWrite) throw new Error('boom');
            mocks.inserts.push({ table: tableName(table), values, conflict });
            return [];
          },
        }),
      }),
    },
  };
});

import { setBillingAdjustment } from './actions';

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.append(k, v);
  return f;
}

// Unwrap the next-safe-action envelope to the action's ActionResult.
async function callData(form: FormData) {
  const r = await setBillingAdjustment(form);
  if (!r) throw new Error('null result');
  if (r.serverError) throw new Error(`unexpected serverError: ${r.serverError}`);
  return r.data as { ok: true } | { error: string };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.deletes = [];
  mocks.inserts = [];
  mocks.throwOnWrite = false;
  mocks.getUser.mockResolvedValue({ id: 'admin-uuid' });
  mocks.assertCan.mockResolvedValue({ id: 'admin-uuid' });
});

describe('setBillingAdjustment', () => {
  it('upserts a present value on (campaign_id, field)', async () => {
    const result = await callData(fd({ campaignId: '42', field: 'qty_records', value: '1750' }));
    expect(result).toEqual({ ok: true });
    expect(mocks.deletes).toHaveLength(0);
    expect(mocks.inserts).toHaveLength(1);
    expect(mocks.inserts[0].table).toBe('billing_adjustments');
    expect(mocks.inserts[0].values).toMatchObject({
      campaignId: 42,
      field: 'qty_records',
      value: 1750,
      createdById: 'admin-uuid',
      updatedById: 'admin-uuid',
    });
  });

  it('deletes the adjustment when the value is cleared (original recoverable)', async () => {
    const result = await callData(fd({ campaignId: '42', field: 'bdc', value: '' }));
    expect(result).toEqual({ ok: true });
    expect(mocks.inserts).toHaveLength(0);
    expect(mocks.deletes).toEqual([{ table: 'billing_adjustments' }]);
  });

  it('treats a whitespace-only value as a clear', async () => {
    await callData(fd({ campaignId: '42', field: 'letters', value: '   ' }));
    expect(mocks.inserts).toHaveLength(0);
    expect(mocks.deletes).toHaveLength(1);
  });

  it('rejects an unknown field without touching the db', async () => {
    const result = await callData(fd({ campaignId: '42', field: 'qty_widgets', value: '5' }));
    expect(result).toEqual({ error: 'Unknown billing field.' });
    expect(mocks.inserts).toHaveLength(0);
    expect(mocks.deletes).toHaveLength(0);
  });

  it('rejects an invalid campaign id', async () => {
    const result = await callData(fd({ campaignId: '0', field: 'qty_records', value: '5' }));
    expect(result).toEqual({ error: 'Invalid campaign id.' });
    expect(mocks.inserts).toHaveLength(0);
  });

  it.each(['-1', '3.5', 'abc', '9999999999'])(
    'rejects a non-whole / out-of-range value (%s)',
    async (bad) => {
      const result = await callData(fd({ campaignId: '42', field: 'sms_email', value: bad }));
      expect('error' in result).toBe(true);
      expect(mocks.inserts).toHaveLength(0);
      expect(mocks.deletes).toHaveLength(0);
    },
  );

  it('accepts zero as a valid override (distinct from clearing)', async () => {
    const result = await callData(fd({ campaignId: '42', field: 'letters', value: '0' }));
    expect(result).toEqual({ ok: true });
    expect(mocks.inserts).toHaveLength(1);
    expect(mocks.inserts[0].values).toMatchObject({ value: 0 });
    expect(mocks.deletes).toHaveLength(0);
  });

  it('returns a friendly error when the write throws (e.g. FK violation)', async () => {
    mocks.throwOnWrite = true;
    const result = await callData(fd({ campaignId: '42', field: 'qty_records', value: '5' }));
    expect(result).toEqual({
      error: 'Could not save the adjustment — the campaign may no longer exist.',
    });
  });
});
