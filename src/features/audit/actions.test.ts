import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  inserts: [] as Array<{ table: string; values: unknown }>,
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/session', () => ({ getUser: mocks.getUser }));
vi.mock('@/lib/db', () => ({
  db: {
    insert: (table: unknown) => ({
      values: (values: unknown) => {
        mocks.inserts.push({ table: tableName(table), values });
        return Promise.resolve();
      },
    }),
  },
}));

function tableName(t: unknown): string {
  if (typeof t === 'object' && t != null) {
    const sym = Object.getOwnPropertySymbols(t).find(
      (s) => s.description === 'drizzle:Name',
    );
    if (sym) return String((t as Record<symbol, unknown>)[sym]);
  }
  return 'unknown';
}

import { recordAudit } from './actions';

describe('recordAudit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.inserts = [];
  });

  it('writes a row to audit_log with actor identity + denormalised role', async () => {
    mocks.getUser.mockResolvedValueOnce({
      id: 'admin-uuid',
      app_metadata: { role: 'admin' },
    });
    await recordAudit({
      action: 'campaign.cancelled',
      targetTable: 'campaigns',
      targetId: 42,
      payload: { reason: 'no-show' },
    });
    expect(mocks.inserts).toHaveLength(1);
    expect(mocks.inserts[0].table).toBe('audit_log');
    expect(mocks.inserts[0].values).toMatchObject({
      actorUserId: 'admin-uuid',
      actorRole: 'admin',
      action: 'campaign.cancelled',
      targetTable: 'campaigns',
      targetId: 42,
      payload: { reason: 'no-show' },
    });
  });

  it('actorRole is null when app_metadata.role is missing', async () => {
    mocks.getUser.mockResolvedValueOnce({
      id: 'coach-uuid',
      app_metadata: {},
    });
    await recordAudit({
      action: 'dealer.archived',
      targetTable: 'dealers',
      targetId: 7,
    });
    expect(mocks.inserts[0].values).toMatchObject({
      actorUserId: 'coach-uuid',
      actorRole: null,
      action: 'dealer.archived',
      payload: null,
    });
  });

  it('throws when called without a signed-in user (wired-it-wrong assertion)', async () => {
    mocks.getUser.mockResolvedValueOnce(null);
    await expect(
      recordAudit({
        action: 'user.deactivated',
        targetTable: 'contacts',
        targetId: 1,
      }),
    ).rejects.toThrow('recordAudit called without a signed-in user');
    expect(mocks.inserts).toHaveLength(0);
  });

  it('payload defaults to null when omitted', async () => {
    mocks.getUser.mockResolvedValueOnce({
      id: 'u',
      app_metadata: { role: 'admin' },
    });
    await recordAudit({
      action: 'dealer.archived',
      targetTable: 'dealers',
      targetId: 1,
    });
    expect(mocks.inserts[0].values).toMatchObject({ payload: null });
  });

  it('targetId can be null for events without a single target row', async () => {
    mocks.getUser.mockResolvedValueOnce({
      id: 'u',
      app_metadata: { role: 'admin' },
    });
    await recordAudit({
      action: 'user.role_changed',
      targetTable: 'contacts',
      targetId: null,
      payload: { note: 'bulk' },
    });
    expect(mocks.inserts[0].values).toMatchObject({ targetId: null });
  });

});
