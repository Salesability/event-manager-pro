import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  loadCurrentMembership: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/auth/load-team-membership', () => ({
  loadCurrentMembership: mocks.loadCurrentMembership,
}));

import { ensureAvailabilityOwnership } from './availability-authz';

const adminUser = { id: 'u-admin', app_metadata: { role: 'admin' } } as never;
const coachUser = { id: 'u-coach', app_metadata: {} } as never;

describe('ensureAvailabilityOwnership', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('admin is always allowed (skips ownership check via can() admin shortcut)', async () => {
    // Post-0029 the implementation delegates the predicate to capabilities.ts's
    // can(), which always loads membership but admit-shortcuts on JWT admin.
    // Membership returns are arbitrary here — admin doesn't read the row.
    mocks.loadCurrentMembership.mockResolvedValueOnce(null);
    expect(
      await ensureAvailabilityOwnership(adminUser, {
        kind: 'statutory_holiday',
        coachId: null,
      }),
    ).toBeNull();
  });

  it('admin allowed for any combination of facets', async () => {
    mocks.loadCurrentMembership.mockResolvedValueOnce(null);
    expect(
      await ensureAvailabilityOwnership(
        adminUser,
        { kind: 'company_closure', coachId: null },
        { kind: 'coach_unavailable', coachId: 99 },
      ),
    ).toBeNull();
  });

  it('coach allowed for their own coach_unavailable block', async () => {
    mocks.loadCurrentMembership.mockResolvedValueOnce({
      contactId: 7,
      roles: ['coach'],
      coachContactId: 7,
      hasDealerContact: false,
    });
    expect(
      await ensureAvailabilityOwnership(coachUser, {
        kind: 'coach_unavailable',
        coachId: 7,
      }),
    ).toBeNull();
  });

  it("coach denied when input is another coach's block", async () => {
    mocks.loadCurrentMembership.mockResolvedValueOnce({
      contactId: 7,
      roles: ['coach'],
      coachContactId: 7,
      hasDealerContact: false,
    });
    const result = await ensureAvailabilityOwnership(coachUser, {
      kind: 'coach_unavailable',
      coachId: 8,
    });
    expect(result).toEqual({ error: 'You can only modify your own availability.' });
  });

  it('coach denied for statutory_holiday or company_closure', async () => {
    mocks.loadCurrentMembership.mockResolvedValueOnce({
      contactId: 7,
      roles: ['coach'],
      coachContactId: 7,
      hasDealerContact: false,
    });
    const result = await ensureAvailabilityOwnership(coachUser, {
      kind: 'statutory_holiday',
      coachId: null,
    });
    expect(result).toEqual({ error: 'You can only modify your own availability.' });
  });

  it('update path: existing OK, but input transfers ownership → denied', async () => {
    mocks.loadCurrentMembership.mockResolvedValueOnce({
      contactId: 7,
      roles: ['coach'],
      coachContactId: 7,
      hasDealerContact: false,
    });
    const result = await ensureAvailabilityOwnership(
      coachUser,
      { kind: 'coach_unavailable', coachId: 7 }, // existing — owned
      { kind: 'coach_unavailable', coachId: 8 }, // desired — transfers to coach 8
    );
    expect(result).toEqual({ error: 'You can only modify your own availability.' });
  });

  it("update path: input OK, but existing is someone else's → denied", async () => {
    mocks.loadCurrentMembership.mockResolvedValueOnce({
      contactId: 7,
      roles: ['coach'],
      coachContactId: 7,
      hasDealerContact: false,
    });
    const result = await ensureAvailabilityOwnership(
      coachUser,
      { kind: 'coach_unavailable', coachId: 8 }, // existing — owned by another coach
      { kind: 'coach_unavailable', coachId: 7 }, // desired — transfer to me
    );
    expect(result).toEqual({ error: 'You can only modify your own availability.' });
  });

  it('user with no coachContactId is denied for any facet', async () => {
    mocks.loadCurrentMembership.mockResolvedValueOnce({
      contactId: 7,
      roles: ['viewer'],
      coachContactId: null,
      hasDealerContact: false,
    });
    const result = await ensureAvailabilityOwnership(coachUser, {
      kind: 'coach_unavailable',
      coachId: 7,
    });
    expect(result).toEqual({ error: 'You can only modify your own availability.' });
  });

  it('user with no membership row at all is denied', async () => {
    mocks.loadCurrentMembership.mockResolvedValueOnce(null);
    const result = await ensureAvailabilityOwnership(coachUser, {
      kind: 'coach_unavailable',
      coachId: 7,
    });
    expect(result).toEqual({ error: 'You can only modify your own availability.' });
  });
});
