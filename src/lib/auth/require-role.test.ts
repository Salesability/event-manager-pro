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

import { requireRole } from './require-role';

const adminUser = { id: 'u-admin', app_metadata: { role: 'admin' } } as never;
const coachUser = { id: 'u-coach', app_metadata: {} } as never;
const orphanUser = { id: 'u-orphan', app_metadata: {} } as never;

describe('requireRole', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('redirects to /login when no user is signed in', async () => {
    mocks.getUser.mockResolvedValueOnce(null);
    await expect(requireRole('admin')).rejects.toThrow('redirect:/login');
    expect(mocks.loadCurrentMembership).not.toHaveBeenCalled();
  });

  it('admin via JWT app_metadata passes the requireRole("admin") check without a DB hit', async () => {
    mocks.getUser.mockResolvedValueOnce(adminUser);
    await expect(requireRole('admin')).resolves.toBe(adminUser);
    expect(mocks.loadCurrentMembership).not.toHaveBeenCalled();
  });

  it('admin passes when admin is one of several allowed roles', async () => {
    mocks.getUser.mockResolvedValueOnce(adminUser);
    await expect(requireRole(['admin', 'coach'])).resolves.toBe(adminUser);
    expect(mocks.loadCurrentMembership).not.toHaveBeenCalled();
  });

  it('coach passes for requireRole("coach") via team_member_roles lookup', async () => {
    mocks.getUser.mockResolvedValueOnce(coachUser);
    mocks.loadCurrentMembership.mockResolvedValueOnce({
      contactId: 7,
      roles: ['coach'],
      coachContactId: 7,
      hasDealerContact: false,
    });
    await expect(requireRole('coach')).resolves.toBe(coachUser);
  });

  it('coach passes when coach is one of several allowed roles', async () => {
    mocks.getUser.mockResolvedValueOnce(coachUser);
    mocks.loadCurrentMembership.mockResolvedValueOnce({
      contactId: 7,
      roles: ['coach'],
      coachContactId: 7,
      hasDealerContact: false,
    });
    await expect(requireRole(['admin', 'coach'])).resolves.toBe(coachUser);
  });

  it('coach is denied for requireRole("admin") and redirected to /', async () => {
    mocks.getUser.mockResolvedValueOnce(coachUser);
    mocks.loadCurrentMembership.mockResolvedValueOnce({
      contactId: 7,
      roles: ['coach'],
      coachContactId: 7,
      hasDealerContact: false,
    });
    await expect(requireRole('admin')).rejects.toThrow('redirect:/');
  });

  it('signed-in user with no team_member_roles row is redirected to /', async () => {
    mocks.getUser.mockResolvedValueOnce(orphanUser);
    mocks.loadCurrentMembership.mockResolvedValueOnce(null);
    await expect(requireRole('staff')).rejects.toThrow('redirect:/');
  });

  it('signed-in user whose roles do not intersect any allowed role is redirected to /', async () => {
    mocks.getUser.mockResolvedValueOnce(coachUser);
    mocks.loadCurrentMembership.mockResolvedValueOnce({
      contactId: 7,
      roles: ['viewer'],
      coachContactId: null,
      hasDealerContact: false,
    });
    await expect(requireRole(['admin', 'staff', 'coach'])).rejects.toThrow('redirect:/');
  });
});
