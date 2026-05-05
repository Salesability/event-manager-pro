import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  selectResults: [] as unknown[][],
}));

vi.mock('server-only', () => ({}));
// React's `cache()` is a no-op identity wrapper outside a Server Components
// runtime; the function we wrap stays callable, just without per-request memo.
vi.mock('react', async (importActual) => {
  const actual = await importActual<typeof import('react')>();
  return { ...actual, cache: <T,>(fn: T): T => fn };
});
vi.mock('@/lib/supabase/session', () => ({ getUser: mocks.getUser }));

vi.mock('@/lib/db', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => {
          const next = () => Promise.resolve(mocks.selectResults.shift() ?? []);
          return {
            limit: () => next(),
            then: (onFulfilled: (v: unknown[]) => unknown) => next().then(onFulfilled),
          };
        },
      }),
    }),
  },
}));

import { loadCurrentMembership } from './load-team-membership';

describe('loadCurrentMembership', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.selectResults = [];
  });

  it('returns null when not signed in', async () => {
    mocks.getUser.mockResolvedValue(null);
    expect(await loadCurrentMembership()).toBeNull();
  });

  it('returns null when the auth user has no contacts row', async () => {
    mocks.getUser.mockResolvedValue({ id: 'user-1' });
    mocks.selectResults = [[]]; // contact lookup returns no rows
    expect(await loadCurrentMembership()).toBeNull();
  });

  it('returns coachContactId for a coach user', async () => {
    mocks.getUser.mockResolvedValue({ id: 'user-1' });
    mocks.selectResults = [
      [{ id: 7 }], // contact row
      [{ role: 'coach' }], // team_member_roles
      [], // dealer_contacts probe
    ];
    expect(await loadCurrentMembership()).toEqual({
      contactId: 7,
      roles: ['coach'],
      coachContactId: 7,
      hasDealerContact: false,
    });
  });

  it('returns coachContactId null for an admin-only user', async () => {
    mocks.getUser.mockResolvedValue({ id: 'user-1' });
    mocks.selectResults = [
      [{ id: 9 }],
      [{ role: 'admin' }],
      [],
    ];
    expect(await loadCurrentMembership()).toEqual({
      contactId: 9,
      roles: ['admin'],
      coachContactId: null,
      hasDealerContact: false,
    });
  });

  it('handles multiple roles (admin + coach)', async () => {
    mocks.getUser.mockResolvedValue({ id: 'user-1' });
    mocks.selectResults = [
      [{ id: 12 }],
      [{ role: 'admin' }, { role: 'coach' }],
      [],
    ];
    expect(await loadCurrentMembership()).toEqual({
      contactId: 12,
      roles: ['admin', 'coach'],
      coachContactId: 12,
      hasDealerContact: false,
    });
  });

  it('reports hasDealerContact when the contact has only them-side rows', async () => {
    mocks.getUser.mockResolvedValue({ id: 'user-1' });
    mocks.selectResults = [
      [{ id: 5 }],
      [], // no team_member_roles
      [{ id: 99 }], // active dealer_contacts row
    ];
    expect(await loadCurrentMembership()).toEqual({
      contactId: 5,
      roles: [],
      coachContactId: null,
      hasDealerContact: true,
    });
  });

  it('returns coachContactId null when the contact has no team_member_roles or dealer_contacts', async () => {
    mocks.getUser.mockResolvedValue({ id: 'user-1' });
    mocks.selectResults = [
      [{ id: 5 }],
      [],
      [],
    ];
    expect(await loadCurrentMembership()).toEqual({
      contactId: 5,
      roles: [],
      coachContactId: null,
      hasDealerContact: false,
    });
  });
});
