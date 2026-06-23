import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  // Queue of arrays returned by successive `db.select(...).from(...).where(...).orderBy?(...)` chains.
  selectResults: [] as unknown[][],
  listUsers: vi.fn(),
}));

vi.mock('server-only', () => ({}));

vi.mock('@/lib/db', () => ({
  db: {
    select: () => ({
      from: () => {
        const next = () => Promise.resolve(mocks.selectResults.shift() ?? []);
        const terminal = {
          orderBy: () => next(),
          // Bare `await` on the chain works too.
          then: (onFulfilled: (v: unknown[]) => unknown) => next().then(onFulfilled),
        };
        // Both shapes appear: `.from(...).where(...)` AND
        // `.from(...).innerJoin(...).where(...)`.
        return {
          where: () => terminal,
          innerJoin: () => ({ where: () => terminal }),
        };
      },
    }),
  },
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    auth: { admin: { listUsers: mocks.listUsers } },
  }),
}));

import { loadAdminPeople } from './queries';

describe('loadAdminPeople', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.selectResults = [];
    mocks.listUsers.mockResolvedValue({ data: { users: [] }, error: null });
  });

  it('returns an empty list when there are no contacts', async () => {
    mocks.selectResults = [[]]; // contacts query returns no rows
    const result = await loadAdminPeople();
    expect(result).toEqual([]);
    // Skips downstream queries when there are no contact ids to expand.
    expect(mocks.listUsers).not.toHaveBeenCalled();
  });

  it('renders a contact with no auth user (Shaye state — contacts row but user_id null)', async () => {
    mocks.selectResults = [
      [
        {
          contactId: 5,
          firstName: 'Tilley',
          lastName: 'Shaye',
          displayName: 'Tilley Shaye',
          userId: null,
        },
      ],
      [], // roles
      [], // dealer links
      [{ contactId: 5, kind: 'email', value: 'tilleyshaye@gmail.com' }], // identifiers
    ];
    const result = await loadAdminPeople();
    expect(result).toEqual([
      {
        contactId: 5,
        firstName: 'Tilley',
        lastName: 'Shaye',
        displayName: 'Tilley Shaye',
        email: 'tilleyshaye@gmail.com',
        phone: null,
        hasAppAccess: false,
        authUser: null,
        roles: [],
        dealerLinks: [],
      },
    ]);
    // No linked user_id → no admin.listUsers round-trip.
    expect(mocks.listUsers).not.toHaveBeenCalled();
  });

  it('renders a contact with auth user + admin role (David / Shannon state)', async () => {
    mocks.selectResults = [
      [
        {
          contactId: 1,
          firstName: 'David',
          lastName: 'Hogan',
          displayName: 'David Hogan',
          userId: 'user-uuid-1',
        },
      ],
      [{ contactId: 1, role: 'admin' }],
      [],
      [
        { contactId: 1, kind: 'email', value: 'david.hogan@networknode.ca' },
        { contactId: 1, kind: 'phone', value: '555-0100' },
      ],
    ];
    mocks.listUsers.mockResolvedValue({
      data: {
        users: [
          {
            id: 'user-uuid-1',
            email: 'david.hogan@networknode.ca',
            last_sign_in_at: '2026-05-05T00:00:00Z',
            banned_until: null,
            identities: [{ provider: 'google' }],
            app_metadata: { role: 'admin' },
          },
        ],
      },
      error: null,
    });

    const [row] = await loadAdminPeople();
    expect(row).toEqual({
      contactId: 1,
      firstName: 'David',
      lastName: 'Hogan',
      displayName: 'David Hogan',
      email: 'david.hogan@networknode.ca',
      phone: '555-0100',
      hasAppAccess: true,
      authUser: {
        userId: 'user-uuid-1',
        email: 'david.hogan@networknode.ca',
        lastSignInAt: '2026-05-05T00:00:00Z',
        bannedUntil: null,
        providers: ['google'],
        appMetadataRole: 'admin',
      },
      roles: ['admin'],
      dealerLinks: [],
    });
  });

  it('renders a contact with dealer-side relationships only (customer-side person)', async () => {
    mocks.selectResults = [
      [
        {
          contactId: 9,
          firstName: 'Maya',
          lastName: 'Customer',
          displayName: 'Maya Customer',
          userId: null,
        },
      ],
      [], // no team_member_roles
      [
        {
          contactId: 9,
          dealerId: 100,
          dealerName: 'Capital Ford',
          isPrimary: true,
          title: 'General Manager',
        },
        {
          contactId: 9,
          dealerId: 200,
          dealerName: 'Lakeside Toyota',
          isPrimary: false,
          title: null,
        },
      ],
      [], // identifiers
    ];
    const [row] = await loadAdminPeople();
    expect(row.dealerLinks).toEqual([
      { dealerId: 100, dealerName: 'Capital Ford', isPrimary: true, title: 'General Manager' },
      { dealerId: 200, dealerName: 'Lakeside Toyota', isPrimary: false, title: null },
    ]);
    expect(row.roles).toEqual([]);
    expect(row.hasAppAccess).toBe(false);
  });

  it('falls back to providers=["email"] when the auth user has no identities array', async () => {
    mocks.selectResults = [
      [
        {
          contactId: 2,
          firstName: 'Magic',
          lastName: 'Linker',
          displayName: 'Magic Linker',
          userId: 'user-uuid-2',
        },
      ],
      [{ contactId: 2, role: 'coach' }],
      [],
      [],
    ];
    mocks.listUsers.mockResolvedValue({
      data: {
        users: [
          {
            id: 'user-uuid-2',
            email: 'magic@example.test',
            last_sign_in_at: null,
            banned_until: null,
            identities: [],
            app_metadata: {},
          },
        ],
      },
      error: null,
    });
    const [row] = await loadAdminPeople();
    expect(row.authUser?.providers).toEqual(['email']);
    expect(row.authUser?.appMetadataRole).toBeNull();
  });

  it('throws when admin.listUsers errors', async () => {
    mocks.selectResults = [
      [
        {
          contactId: 1,
          firstName: 'David',
          lastName: 'Hogan',
          displayName: 'David Hogan',
          userId: 'user-uuid-1',
        },
      ],
      [],
      [],
      [],
    ];
    mocks.listUsers.mockResolvedValue({
      data: { users: [] },
      error: { message: 'Service role key missing' },
    });
    await expect(loadAdminPeople()).rejects.toMatchObject({
      message: 'Service role key missing',
    });
  });
});
