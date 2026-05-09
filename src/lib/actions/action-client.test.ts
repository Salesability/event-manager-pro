import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

// Next.js redirect throws an `Error` with `digest: 'NEXT_REDIRECT;...'`. The
// safe-action client's `isNavigationError` check recognises this digest and
// re-throws so the redirect propagates instead of being caught and turned
// into a `serverError`. The test mock matches that shape.
const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  loadCurrentMembership: vi.fn(),
  redirect: vi.fn((path: string) => {
    const err = new Error(`NEXT_REDIRECT;replace;${path};307;`);
    (err as Error & { digest: string }).digest = `NEXT_REDIRECT;replace;${path};307;`;
    throw err;
  }),
}));

vi.mock('server-only', () => ({}));
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }));
vi.mock('@/lib/supabase/session', () => ({ getUser: mocks.getUser }));
vi.mock('@/lib/auth/load-team-membership', async (importOriginal) => {
  const real = await importOriginal<
    typeof import('@/lib/auth/load-team-membership')
  >();
  return {
    ...real,
    loadCurrentMembership: mocks.loadCurrentMembership,
  };
});

import { authedClient, baseClient, capabilityClient } from './action-client';

const adminUser = {
  id: 'u-admin',
  email: 'a@x',
  app_metadata: { role: 'admin' },
} as never;
const coachUser = {
  id: 'u-coach',
  email: 'c@x',
  app_metadata: {},
} as never;

describe('action-client tiers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.redirect.mockImplementation((p: string) => {
      const err = new Error(`NEXT_REDIRECT;replace;${p};307;`);
      (err as Error & { digest: string }).digest = `NEXT_REDIRECT;replace;${p};307;`;
      throw err;
    });
  });

  describe('baseClient', () => {
    it('runs the action body without checking auth', async () => {
      const action = baseClient
        .schema(z.object({ x: z.string() }))
        .action(async ({ parsedInput }) => ({ ok: true, x: parsedInput.x }));
      const result = await action({ x: 'hi' });
      expect(result.data).toEqual({ ok: true, x: 'hi' });
      expect(mocks.getUser).not.toHaveBeenCalled();
    });
  });

  describe('authedClient', () => {
    it('redirects /login when no user is signed in', async () => {
      mocks.getUser.mockResolvedValue(null);
      const action = authedClient
        .schema(z.object({}))
        .action(async ({ ctx }) => ({ user: ctx.user.id }));
      await expect(action({})).rejects.toThrow('NEXT_REDIRECT;replace;/login');
    });

    it('passes ctx.user when signed in', async () => {
      mocks.getUser.mockResolvedValue(adminUser);
      const action = authedClient
        .schema(z.object({}))
        .action(async ({ ctx }) => ({ ok: true, id: ctx.user.id }));
      const result = await action({});
      expect(result.data).toEqual({ ok: true, id: 'u-admin' });
    });
  });

  describe('capabilityClient', () => {
    it('redirects /login when no user is signed in', async () => {
      mocks.getUser.mockResolvedValue(null);
      const action = capabilityClient('person:create')
        .schema(z.object({}))
        .action(async () => ({ ok: true }));
      await expect(action({})).rejects.toThrow('NEXT_REDIRECT;replace;/login');
    });

    it('redirects / when capability deny (coach trying admin-only cap)', async () => {
      mocks.getUser.mockResolvedValue(coachUser);
      mocks.loadCurrentMembership.mockResolvedValue({
        contactId: 7,
        roles: ['coach'],
        coachContactId: 7,
        hasDealerContact: false,
      });
      const action = capabilityClient('person:create')
        .schema(z.object({}))
        .action(async () => ({ ok: true }));
      await expect(action({})).rejects.toThrow('NEXT_REDIRECT;replace;/;');
    });

    it('passes when admin via JWT app_metadata', async () => {
      mocks.getUser.mockResolvedValue(adminUser);
      // assertCan loads membership unconditionally; the admin shortcut inside
      // can() admits via app_metadata.role even when the role list is empty.
      const action = capabilityClient('person:create')
        .schema(z.object({}))
        .action(async ({ ctx }) => ({ ok: true, id: ctx.user.id }));
      const result = await action({});
      expect(result.data).toEqual({ ok: true, id: 'u-admin' });
    });

    it('admits coach for a multi-role capability (availability:edit)', async () => {
      mocks.getUser.mockResolvedValue(coachUser);
      mocks.loadCurrentMembership.mockResolvedValue({
        contactId: 7,
        roles: ['coach'],
        coachContactId: 7,
        hasDealerContact: false,
      });
      const action = capabilityClient('availability:edit')
        .schema(z.object({}))
        .action(async () => ({ ok: true }));
      const result = await action({});
      expect(result.data).toEqual({ ok: true });
    });

    it('denies coach for an admin-only capability (admin:access)', async () => {
      mocks.getUser.mockResolvedValue(coachUser);
      mocks.loadCurrentMembership.mockResolvedValue({
        contactId: 7,
        roles: ['coach'],
        coachContactId: 7,
        hasDealerContact: false,
      });
      const action = capabilityClient('admin:access')
        .schema(z.object({}))
        .action(async () => ({ ok: true }));
      await expect(action({})).rejects.toThrow('NEXT_REDIRECT;replace;/;');
    });
  });
});
