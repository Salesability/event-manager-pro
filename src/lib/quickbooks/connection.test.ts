import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { accessTokenFresh, computeExpiry, getValidAccessToken } from './connection';
import type { QboTokens } from './client';

vi.mock('server-only', () => ({}));

// Shared mock state (hoisted so the vi.mock factories can see it).
const h = vi.hoisted(() => ({
  row: null as Record<string, unknown> | null,
  saved: null as Record<string, unknown> | null,
  refresh: vi.fn(),
}));

// Minimal drizzle stub: select→from→limit yields the configured row (or none);
// insert→values→onConflictDoUpdate captures what would be persisted.
vi.mock('@/lib/db', () => ({
  db: {
    select: () => ({ from: () => ({ limit: async () => (h.row ? [h.row] : []) }) }),
    insert: () => ({
      values: (v: Record<string, unknown>) => ({ onConflictDoUpdate: async () => { h.saved = v; } }),
    }),
    delete: () => ({ then: (r: (v: unknown) => unknown) => Promise.resolve(undefined).then(r) }),
  },
}));

// Keep the real client (qboConfig, types) but stub the network refresh call.
vi.mock('./client', async (orig) => {
  const real = await orig<typeof import('./client')>();
  return { ...real, refreshTokens: h.refresh };
});

const tokens: QboTokens = {
  accessToken: 'a',
  refreshToken: 'r',
  expiresIn: 3600,
  refreshTokenExpiresIn: 8_640_000,
};

describe('computeExpiry', () => {
  it('turns token lifetimes into absolute instants from `now`', () => {
    const now = new Date('2026-06-08T12:00:00.000Z');
    const { accessTokenExpiresAt, refreshTokenExpiresAt } = computeExpiry(tokens, now);
    expect(accessTokenExpiresAt.toISOString()).toBe('2026-06-08T13:00:00.000Z'); // +3600s
    expect(refreshTokenExpiresAt.toISOString()).toBe('2026-09-16T12:00:00.000Z'); // +8_640_000s (100d)
  });
});

describe('accessTokenFresh', () => {
  const now = new Date('2026-06-08T12:00:00.000Z');
  it('is true well before expiry', () => {
    expect(accessTokenFresh(new Date(now.getTime() + 5 * 60_000), now)).toBe(true);
  });
  it('is false inside the 60s skew window', () => {
    expect(accessTokenFresh(new Date(now.getTime() + 30_000), now)).toBe(false);
  });
  it('is false once expired', () => {
    expect(accessTokenFresh(new Date(now.getTime() - 1000), now)).toBe(false);
  });
});

describe('getValidAccessToken', () => {
  // Use the real sealed-box so the test also proves stored tokens are encrypted.
  let encrypt: (s: string) => string;
  let decrypt: (s: string) => string;
  const now = new Date('2026-06-08T12:00:00.000Z');

  beforeEach(async () => {
    process.env.QBO_TOKEN_ENC_KEY = Buffer.alloc(32, 9).toString('base64');
    ({ encrypt, decrypt } = await import('@/lib/crypto/sealed-box'));
    h.row = null;
    h.saved = null;
    h.refresh.mockReset();
  });
  afterEach(() => {
    delete process.env.QBO_TOKEN_ENC_KEY;
  });

  function storedRow(accessExpiresAt: Date) {
    return {
      realmId: 'realm-1',
      accessTokenEnc: encrypt('old-access'),
      refreshTokenEnc: encrypt('old-refresh'),
      accessTokenExpiresAt: accessExpiresAt,
      refreshTokenExpiresAt: new Date(now.getTime() + 100 * 86_400_000),
      connectedById: 'u-admin',
      updatedAt: now,
    };
  }

  it('returns the stored token without refreshing when it is still fresh', async () => {
    h.row = storedRow(new Date(now.getTime() + 30 * 60_000));
    const res = await getValidAccessToken(now);
    expect(res).toEqual({ realmId: 'realm-1', accessToken: 'old-access' });
    expect(h.refresh).not.toHaveBeenCalled();
    expect(h.saved).toBeNull();
  });

  it('refreshes on expiry and persists the ROTATED refresh token (encrypted)', async () => {
    h.row = storedRow(new Date(now.getTime() + 10_000)); // inside skew → refresh
    h.refresh.mockResolvedValue({
      accessToken: 'new-access',
      refreshToken: 'new-refresh',
      expiresIn: 3600,
      refreshTokenExpiresIn: 8_640_000,
    });

    const res = await getValidAccessToken(now);

    expect(h.refresh).toHaveBeenCalledWith('old-refresh'); // sent the old token
    expect(res.accessToken).toBe('new-access');
    // Persisted the rotated token, encrypted (not plaintext).
    expect(h.saved?.refreshTokenEnc).not.toBe('new-refresh');
    expect(decrypt(h.saved?.refreshTokenEnc as string)).toBe('new-refresh');
    expect(decrypt(h.saved?.accessTokenEnc as string)).toBe('new-access');
  });

  it('throws when nothing is connected', async () => {
    h.row = null;
    await expect(getValidAccessToken(now)).rejects.toThrow(/not connected/i);
  });
});
