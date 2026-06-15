import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  dbResults: [] as unknown[][],
  updates: [] as Array<{ table: string; patch: unknown }>,
  inserts: [] as Array<{ table: string; values: unknown }>,
}));

vi.mock('server-only', () => ({}));
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
  const next = () => Promise.resolve(mocks.dbResults.shift() ?? []);
  return {
    db: {
      update: (table: unknown) => ({
        set: (patch: unknown) => {
          mocks.updates.push({ table: tableName(table), patch });
          return {
            where: () => ({ returning: () => next() }),
          };
        },
      }),
      insert: (table: unknown) => ({
        values: (values: unknown) => {
          mocks.inserts.push({ table: tableName(table), values });
          return next();
        },
      }),
      select: () => ({
        from: () => ({
          where: () => ({
            limit: () => next(),
          }),
        }),
      }),
    },
  };
});

import { markMsaDeclined, markMsaSigned } from './lifecycle';

beforeEach(() => {
  mocks.dbResults = [];
  mocks.updates = [];
  mocks.inserts = [];
});

describe('markMsaSigned', () => {
  it('flips pending → active, stamps signedAt + expiresAt + signedPdfStorageKey, emits audit', async () => {
    // Guarded UPDATE returns one matched row.
    mocks.dbResults.push([{ id: 1, dealerId: 7 }]);

    const before = Date.now();
    const result = await markMsaSigned('sig-req-abc', 'msa/1/signed.pdf');
    const after = Date.now();

    expect(result).toEqual({
      ok: true,
      transitioned: true,
      msaId: 1,
      dealerId: 7,
    });
    expect(mocks.updates).toHaveLength(1);
    const patch = mocks.updates[0].patch as Record<string, unknown>;
    expect(patch.status).toBe('active');
    expect(patch.signedPdfStorageKey).toBe('msa/1/signed.pdf');
    const signedAt = patch.signedAt as Date;
    const expiresAt = patch.expiresAt as Date;
    expect(signedAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(signedAt.getTime()).toBeLessThanOrEqual(after);
    // expiresAt = signedAt + 12 months (within ~366 days)
    const daysApart =
      (expiresAt.getTime() - signedAt.getTime()) / (24 * 60 * 60 * 1000);
    expect(daysApart).toBeGreaterThan(364);
    expect(daysApart).toBeLessThan(367);

    expect(mocks.inserts).toHaveLength(1);
    expect(mocks.inserts[0].table).toBe('audit_log');
    const auditRow = mocks.inserts[0].values as Record<string, unknown>;
    expect(auditRow.actorUserId).toBeNull();
    expect(auditRow.actorRole).toBe('system');
    expect(auditRow.action).toBe('msa.signed');
    expect(auditRow.targetId).toBe(1);
  });

  it('0082: flips ONLY the MSA — no quote or dealer side effects', async () => {
    // The signing event no longer accepts a bundled quote or promotes the
    // dealer (the quote has its own accept lifecycle, which promotes). Just the
    // MSA UPDATE + the msa.signed audit.
    mocks.dbResults.push([{ id: 1, dealerId: 7 }]);
    const result = await markMsaSigned('sig-req-abc', 'msa/1/signed.pdf');
    expect(result).toEqual({ ok: true, transitioned: true, msaId: 1, dealerId: 7 });
    expect(mocks.updates.map((u) => u.table)).toEqual(['master_service_agreements']);
    expect(mocks.inserts.map((i) => (i.values as { action: string }).action)).toEqual([
      'msa.signed',
    ]);
  });

  it('returns idempotent ok (transitioned=false) when the MSA is already active (replay)', async () => {
    // Guarded UPDATE misses (no pending row with that doc id) → re-select →
    // row exists with status='active'.
    mocks.dbResults.push([]);
    mocks.dbResults.push([{ id: 1, status: 'active' }]);
    const result = await markMsaSigned('sig-req-abc', 'msa/1/signed.pdf');
    expect(result).toEqual({
      ok: true,
      transitioned: false,
      msaId: null,
      dealerId: null,
    });
    expect(mocks.inserts).toHaveLength(0); // no audit emit on replay
  });

  it('returns error when the provider document id has no matching row', async () => {
    mocks.dbResults.push([]); // UPDATE miss
    mocks.dbResults.push([]); // re-select also empty
    const result = await markMsaSigned('sig-req-unknown', 'msa/1/signed.pdf');
    expect((result as { error: string }).error).toContain('MSA not found');
    expect(mocks.inserts).toHaveLength(0);
  });

  it('returns error when the MSA is in a terminal non-active status', async () => {
    mocks.dbResults.push([]); // UPDATE miss
    mocks.dbResults.push([{ id: 1, status: 'terminated' }]);
    const result = await markMsaSigned('sig-req-abc', 'msa/1/signed.pdf');
    expect((result as { error: string }).error).toContain(
      "cannot be signed from status 'terminated'",
    );
    expect(mocks.inserts).toHaveLength(0);
  });
});

describe('markMsaDeclined', () => {
  it('flips pending → terminated and emits audit', async () => {
    mocks.dbResults.push([{ id: 1, dealerId: 7 }]);
    const result = await markMsaDeclined('sig-req-abc');
    expect(result).toEqual({
      ok: true,
      transitioned: true,
      msaId: 1,
      dealerId: 7,
    });
    const patch = mocks.updates[0].patch as Record<string, unknown>;
    expect(patch.status).toBe('terminated');
    expect(mocks.inserts[0].table).toBe('audit_log');
    const auditRow = mocks.inserts[0].values as Record<string, unknown>;
    expect(auditRow.action).toBe('msa.declined');
  });

  it('is idempotent when already terminated', async () => {
    mocks.dbResults.push([]);
    mocks.dbResults.push([{ id: 1, status: 'terminated' }]);
    const result = await markMsaDeclined('sig-req-abc');
    expect(result).toEqual({
      ok: true,
      transitioned: false,
      msaId: null,
      dealerId: null,
    });
    expect(mocks.inserts).toHaveLength(0);
  });

  it('returns error when the document id is unknown', async () => {
    mocks.dbResults.push([]);
    mocks.dbResults.push([]);
    const result = await markMsaDeclined('sig-req-unknown');
    expect((result as { error: string }).error).toContain('MSA not found');
  });
});
