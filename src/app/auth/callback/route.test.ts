import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  exchangeCodeForSession: vi.fn(),
  loadCurrentMembership: vi.fn(),
  getUser: vi.fn(),
}));

vi.mock('server-only', () => ({}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { exchangeCodeForSession: mocks.exchangeCodeForSession },
  }),
}));

vi.mock('@/lib/supabase/session', () => ({ getUser: mocks.getUser }));

vi.mock('@/lib/auth/load-team-membership', () => ({
  loadCurrentMembership: mocks.loadCurrentMembership,
  isStaffAppRole: (role: string) =>
    ['admin', 'staff', 'coach', 'viewer'].includes(role),
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
    mocks.getUser.mockResolvedValue({ id: 'user-uuid', app_metadata: { role: null } });
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

  it('admin (app_metadata.role) with no team_member_roles → still redirects to safe `next` (bootstrap path)', async () => {
    mocks.getUser.mockResolvedValue({ id: 'admin-uuid', app_metadata: { role: 'admin' } });
    mocks.loadCurrentMembership.mockResolvedValue(null);
    const res = await GET(makeRequest({ code: 'abc', next: '/admin/users' }));
    expect(res.headers.get('location')).toContain('/admin/users');
    // Confirm we short-circuit before touching the membership loader.
    expect(mocks.loadCurrentMembership).not.toHaveBeenCalled();
  });

  it('staff role → redirects to safe `next`', async () => {
    mocks.loadCurrentMembership.mockResolvedValue({
      contactId: 7,
      roles: ['admin'],
      coachContactId: null,
      hasDealerContact: false,
    });
    const res = await GET(makeRequest({ code: 'abc', next: '/calendar' }));
    expect(res.headers.get('location')).toContain('/calendar');
  });

  it('coach role → redirects to safe `next`', async () => {
    mocks.loadCurrentMembership.mockResolvedValue({
      contactId: 8,
      roles: ['coach'],
      coachContactId: 8,
      hasDealerContact: false,
    });
    const res = await GET(makeRequest({ code: 'abc' }));
    const loc = res.headers.get('location') ?? '';
    expect(loc).not.toContain('/auth/auth-error');
  });

  it('only dealer_contacts → "Portal not yet available"', async () => {
    mocks.loadCurrentMembership.mockResolvedValue({
      contactId: 9,
      roles: [],
      coachContactId: null,
      hasDealerContact: true,
    });
    const res = await GET(makeRequest({ code: 'abc' }));
    expect(res.headers.get('location')).toContain(
      '/auth/auth-error?reason=Portal+not+yet+available',
    );
  });

  it('only `dealer` role → does NOT land on the staff app (0023 regression guard)', async () => {
    // Closes the Codex High from 0023 Phase 1: a contact whose only
    // team_member_roles row is `dealer` is them-side, must not pass the
    // staff-app gate.
    mocks.loadCurrentMembership.mockResolvedValue({
      contactId: 12,
      roles: ['dealer'],
      coachContactId: null,
      hasDealerContact: true,
    });
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
      hasDealerContact: false,
    });
    const res = await GET(makeRequest({ code: 'abc' }));
    expect(res.headers.get('location')).toContain(
      '/auth/auth-error?reason=Account+not+provisioned',
    );
  });
});
