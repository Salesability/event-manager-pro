import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  dbResults: [] as unknown[][],
  updates: [] as Array<{ patch: unknown }>,
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/db', () => {
  const next = () => Promise.resolve(mocks.dbResults.shift() ?? []);
  return {
    db: {
      update: () => ({
        set: (patch: unknown) => {
          mocks.updates.push({ patch });
          return { where: () => ({ returning: () => next() }) };
        },
      }),
      select: () => ({
        from: () => ({ where: () => ({ limit: () => next() }) }),
      }),
    },
  };
});

import { markQuoteAcceptedViaEnvelope } from './lifecycle';

beforeEach(() => {
  mocks.dbResults = [];
  mocks.updates = [];
});

describe('markQuoteAcceptedViaEnvelope', () => {
  it('flips draft → accepted and stamps acceptedAt', async () => {
    mocks.dbResults.push([{ id: 42 }]); // guarded UPDATE matches
    const before = Date.now();
    const result = await markQuoteAcceptedViaEnvelope(42);
    const after = Date.now();
    expect(result).toEqual({ ok: true, transitioned: true });
    const patch = mocks.updates[0].patch as Record<string, unknown>;
    expect(patch.status).toBe('accepted');
    const acceptedAt = patch.acceptedAt as Date;
    expect(acceptedAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(acceptedAt.getTime()).toBeLessThanOrEqual(after);
  });

  it('is idempotent when the quote is already accepted', async () => {
    mocks.dbResults.push([]); // UPDATE miss
    mocks.dbResults.push([{ status: 'accepted' }]); // re-select
    const result = await markQuoteAcceptedViaEnvelope(42);
    expect(result).toEqual({ ok: true, transitioned: false });
  });

  it('errors when the quote is in a non-draft, non-accepted status', async () => {
    mocks.dbResults.push([]); // UPDATE miss
    mocks.dbResults.push([{ status: 'sent' }]); // re-select
    const result = await markQuoteAcceptedViaEnvelope(42);
    expect((result as { error: string }).error).toContain(
      "cannot be accepted from status 'sent'",
    );
  });

  it('errors when the quote does not exist', async () => {
    mocks.dbResults.push([]); // UPDATE miss
    mocks.dbResults.push([]); // re-select empty
    const result = await markQuoteAcceptedViaEnvelope(42);
    expect((result as { error: string }).error).toContain('Quote not found');
  });
});
