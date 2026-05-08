import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  loadCurrentMembership: vi.fn(),
  redirect: vi.fn((path: string) => {
    throw new Error(`redirect:${path}`);
  }),
}));

vi.mock('server-only', () => ({}));
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }));
vi.mock('@/lib/supabase/session', () => ({ getUser: mocks.getUser }));
vi.mock('@/lib/auth/load-team-membership', () => ({
  loadCurrentMembership: mocks.loadCurrentMembership,
}));

import { assertCan } from './assert-can';

const adminUser = { id: 'u-admin', app_metadata: { role: 'admin' } } as never;
const coachUser = { id: 'u-coach', app_metadata: {} } as never;
const orphanUser = { id: 'u-orphan', app_metadata: {} } as never;

describe('assertCan', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('redirects to /login when no user is signed in', async () => {
    mocks.getUser.mockResolvedValueOnce(null);
    await expect(assertCan('dealer:archive')).rejects.toThrow('redirect:/login');
    expect(mocks.loadCurrentMembership).not.toHaveBeenCalled();
  });

  it('admin via JWT passes without a membership row', async () => {
    mocks.getUser.mockResolvedValueOnce(adminUser);
    mocks.loadCurrentMembership.mockResolvedValueOnce(null);
    await expect(assertCan('production:export')).resolves.toBe(adminUser);
  });

  it('admin via roles list passes', async () => {
    mocks.getUser.mockResolvedValueOnce(coachUser);
    mocks.loadCurrentMembership.mockResolvedValueOnce({
      contactId: 7,
      roles: ['admin'],
      coachContactId: null,
      hasDealerContact: false,
    });
    await expect(assertCan('dealer:archive')).resolves.toBe(coachUser);
  });

  it('coach is denied for an admin-only capability', async () => {
    mocks.getUser.mockResolvedValueOnce(coachUser);
    mocks.loadCurrentMembership.mockResolvedValueOnce({
      contactId: 7,
      roles: ['coach'],
      coachContactId: 7,
      hasDealerContact: false,
    });
    await expect(assertCan('dealer:archive')).rejects.toThrow('redirect:/');
  });

  it('coach passes coach-availability:edit-own for matching resource', async () => {
    mocks.getUser.mockResolvedValueOnce(coachUser);
    mocks.loadCurrentMembership.mockResolvedValueOnce({
      contactId: 7,
      roles: ['coach'],
      coachContactId: 7,
      hasDealerContact: false,
    });
    await expect(
      assertCan('coach-availability:edit-own', {
        kind: 'coach_unavailable',
        coachId: 7,
      }),
    ).resolves.toBe(coachUser);
  });

  it('coach is denied coach-availability:edit-own for another coach\'s row', async () => {
    mocks.getUser.mockResolvedValueOnce(coachUser);
    mocks.loadCurrentMembership.mockResolvedValueOnce({
      contactId: 7,
      roles: ['coach'],
      coachContactId: 7,
      hasDealerContact: false,
    });
    await expect(
      assertCan('coach-availability:edit-own', {
        kind: 'coach_unavailable',
        coachId: 8,
      }),
    ).rejects.toThrow('redirect:/');
  });

  it('signed-in user with no membership row is denied', async () => {
    mocks.getUser.mockResolvedValueOnce(orphanUser);
    mocks.loadCurrentMembership.mockResolvedValueOnce(null);
    await expect(assertCan('person:edit')).rejects.toThrow('redirect:/');
  });
});
