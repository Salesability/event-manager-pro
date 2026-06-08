import { describe, expect, it, vi } from 'vitest';
import { accessTokenFresh, computeExpiry } from './connection';
import type { QboTokens } from './client';

vi.mock('server-only', () => ({}));

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
