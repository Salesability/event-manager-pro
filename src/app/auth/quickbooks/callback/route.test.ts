import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Hoisted controllable state for the mocks.
const h = vi.hoisted(() => ({
  user: null as { id: string; app_metadata: Record<string, unknown> } | null,
  saveConnection: vi.fn(),
  exchange: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/session', () => ({ getUser: async () => h.user }));
vi.mock('@/lib/quickbooks/connection', () => ({ saveConnection: h.saveConnection }));
// Keep verifyState / quickbooksRedirectUri / QBO_STATE_COOKIE real; stub only the network exchange.
vi.mock('@/lib/quickbooks/client', async (orig) => {
  const real = await orig<typeof import('@/lib/quickbooks/client')>();
  return { ...real, exchangeCodeForTokens: h.exchange };
});

import { GET } from './route';

const ADMIN = { id: 'u-admin', app_metadata: { role: 'admin' } };
const TOKENS = {
  accessToken: 'access-1',
  refreshToken: 'refresh-1',
  expiresIn: 3600,
  refreshTokenExpiresIn: 8_640_000,
};

function request(params: Record<string, string>, cookieState?: string): NextRequest {
  const url = new URL('http://localhost:3000/auth/quickbooks/callback');
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const headers: Record<string, string> = {};
  if (cookieState !== undefined) headers.cookie = `qbo_oauth_state=${cookieState}`;
  return new NextRequest(url, { headers });
}

function location(res: Response): string {
  return res.headers.get('location') ?? '';
}

describe('GET /auth/quickbooks/callback', () => {
  beforeEach(() => {
    delete process.env.SITE_URL;
    h.user = ADMIN;
    h.saveConnection.mockReset().mockResolvedValue(undefined);
    h.exchange.mockReset().mockResolvedValue(TOKENS);
  });
  afterEach(() => vi.clearAllMocks());

  it('rejects a forged state (param ≠ cookie) without exchanging or saving', async () => {
    const res = await GET(request({ code: 'c1', realmId: 'r1', state: 'FORGED' }, 'REALSTATE'));
    expect(location(res)).toContain('/admin/quickbooks');
    expect(location(res)).toContain('error=');
    expect(h.exchange).not.toHaveBeenCalled();
    expect(h.saveConnection).not.toHaveBeenCalled();
  });

  it('rejects a missing state cookie', async () => {
    const res = await GET(request({ code: 'c1', realmId: 'r1', state: 'S' }));
    expect(location(res)).toContain('error=');
    expect(h.saveConnection).not.toHaveBeenCalled();
  });

  it('rejects a non-admin even with a valid state', async () => {
    h.user = { id: 'u-coach', app_metadata: { role: 'coach' } };
    const res = await GET(request({ code: 'c1', realmId: 'r1', state: 'S1' }, 'S1'));
    expect(location(res)).toContain('error=');
    expect(h.saveConnection).not.toHaveBeenCalled();
  });

  it('errors when code/realmId are missing', async () => {
    const res = await GET(request({ state: 'S1' }, 'S1'));
    expect(location(res)).toContain('error=');
    expect(h.exchange).not.toHaveBeenCalled();
  });

  it('exchanges the code and saves realmId + tokens on a valid admin callback', async () => {
    const res = await GET(request({ code: 'the-code', realmId: 'realm-9', state: 'S1' }, 'S1'));

    expect(h.exchange).toHaveBeenCalledWith(
      'the-code',
      'http://localhost:3000/auth/quickbooks/callback',
    );
    expect(h.saveConnection).toHaveBeenCalledWith({
      realmId: 'realm-9',
      tokens: TOKENS,
      connectedById: 'u-admin',
    });
    expect(location(res)).toContain('connected=1');
  });

  it('surfaces a token-exchange failure as an error redirect', async () => {
    h.exchange.mockRejectedValue(new Error('token exchange boom'));
    const res = await GET(request({ code: 'c1', realmId: 'r1', state: 'S1' }, 'S1'));
    expect(location(res)).toContain('error=');
    expect(location(res).toLowerCase()).toContain('boom');
    expect(h.saveConnection).not.toHaveBeenCalled();
  });
});
