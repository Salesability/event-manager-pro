import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  exchangeCodeForSession: vi.fn(),
  loadCurrentMembership: vi.fn(),
  dealerContactRows: [] as Array<{ id: number }>,
}));

vi.mock('server-only', () => ({}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { exchangeCodeForSession: mocks.exchangeCodeForSession },
  }),
}));

vi.mock('@/lib/auth/load-team-membership', () => ({
  loadCurrentMembership: mocks.loadCurrentMembership,
}));

vi.mock('@/lib/db', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => mocks.dealerContactRows,
        }),
      }),
    }),
  },
}));

import { GET } from './route';

function makeRequest(qs: Record<string, string>): NextRequest {
  const url = new URL('https://example.test/auth/callback');
  for (const [k, v] of Object.entries(qs)) url.searchParams.set(k, v);
  return new NextRequest(url);
}

describe('/auth/callback role-aware routing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.exchangeCodeForSession.mockResolvedValue({ error: null });
    mocks.dealerContactRows = [];
  });

  it('missing code → redirects to auth-error', async () => {
    const res = await GET(makeRequest({}));
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('/auth/auth-error?reason=Missing+code');
    expect(mocks.exchangeCodeForSession).not.toHaveBeenCalled();
  });

  it('exchange error → redirects to auth-error with the message', async () => {
    mocks.exchangeCodeForSession.mockResolvedValue({ error: { message: 'Code expired' } });
    const res = await GET(makeRequest({ code: 'abc' }));
    expect(res.headers.get('location')).toMatch(/\/auth\/auth-error\?reason=Code\+expired/);
  });

  it('staff role → redirects to safe `next`', async () => {
    mocks.loadCurrentMembership.mockResolvedValue({
      contactId: 7,
      roles: ['admin'],
      coachContactId: null,
    });
    const res = await GET(makeRequest({ code: 'abc', next: '/calendar' }));
    expect(res.headers.get('location')).toContain('/calendar');
  });

  it('coach role → redirects to safe `next`', async () => {
    mocks.loadCurrentMembership.mockResolvedValue({
      contactId: 8,
      roles: ['coach'],
      coachContactId: 8,
    });
    const res = await GET(makeRequest({ code: 'abc' }));
    // safeNextPath default falls to '/'
    const loc = res.headers.get('location') ?? '';
    expect(loc).not.toContain('/auth/auth-error');
  });

  it('only dealer_contacts → "Portal not yet available"', async () => {
    mocks.loadCurrentMembership.mockResolvedValue({
      contactId: 9,
      roles: [],
      coachContactId: null,
    });
    mocks.dealerContactRows = [{ id: 100 }];
    const res = await GET(makeRequest({ code: 'abc' }));
    expect(res.headers.get('location')).toContain(
      '/auth/auth-error?reason=Portal+not+yet+available',
    );
  });

  it('no contacts row → "Account not provisioned"', async () => {
    mocks.loadCurrentMembership.mockResolvedValue(null);
    const res = await GET(makeRequest({ code: 'abc' }));
    expect(res.headers.get('location')).toContain(
      '/auth/auth-error?reason=Account+not+provisioned',
    );
  });

  it('contacts row but no roles and no dealer_contacts → "Account not provisioned"', async () => {
    mocks.loadCurrentMembership.mockResolvedValue({
      contactId: 11,
      roles: [],
      coachContactId: null,
    });
    mocks.dealerContactRows = [];
    const res = await GET(makeRequest({ code: 'abc' }));
    expect(res.headers.get('location')).toContain(
      '/auth/auth-error?reason=Account+not+provisioned',
    );
  });
});
