import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  adminCreateUser: vi.fn(),
  adminUpdateUserById: vi.fn(),
  // Queue of arrays returned by successive `db.select(...).from(...).where(...).limit?(...)` calls.
  selectResults: [] as unknown[][],
  // Each tx callback's nested selects use the same queue, plus mutation
  // capture below for later assertions.
  inserts: [] as Array<{ table: string; values: unknown }>,
  updates: [] as Array<{ table: string; patch: unknown }>,
}));

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({
  redirect: (path: string) => {
    throw new Error(`REDIRECT:${path}`);
  },
}));
vi.mock('@/lib/auth/require-admin', () => ({
  requireAdmin: mocks.requireAdmin,
  isAdmin: () => false,
}));
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    auth: {
      admin: {
        createUser: mocks.adminCreateUser,
        updateUserById: mocks.adminUpdateUserById,
      },
    },
  }),
}));

// Stub a tx + db that captures inserts/updates and answers `select` from the
// queue. Same shape as the 0018 actions.test.ts mock — predicate-blind by
// design; closing that gap is a parked follow-up. Defined inside the
// `vi.mock` factory because the factory is hoisted above other top-level
// declarations.
vi.mock('@/lib/db', () => {
  function tableName(t: unknown): string {
    if (typeof t === 'object' && t != null) {
      const sym = Object.getOwnPropertySymbols(t).find(
        (s) => s.description === 'drizzle:Name',
      );
      if (sym) return String((t as Record<symbol, unknown>)[sym]);
    }
    return 'unknown';
  }
  const txStub = {
    insert: (table: unknown) => ({
      values: (values: unknown) => {
        mocks.inserts.push({ table: tableName(table), values });
        return {
          returning: async () => [{ id: 999 }],
        };
      },
    }),
    update: (table: unknown) => ({
      set: (patch: unknown) => {
        mocks.updates.push({ table: tableName(table), patch });
        return {
          where: () => {
            const next = () => Promise.resolve(mocks.selectResults.shift() ?? []);
            return {
              returning: () => next(),
              then: (onFulfilled: (v: unknown[]) => unknown) =>
                next().then(onFulfilled),
            };
          },
        };
      },
    }),
    select: () => ({
      from: () => {
        const next = () => Promise.resolve(mocks.selectResults.shift() ?? []);
        const terminal = {
          limit: () => next(),
          orderBy: () => next(),
          then: (onFulfilled: (v: unknown[]) => unknown) => next().then(onFulfilled),
        };
        return {
          where: () => terminal,
          innerJoin: () => ({ where: () => terminal }),
        };
      },
    }),
  };
  return {
    db: {
      ...txStub,
      transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(txStub),
    },
  };
});

import { archivePerson, createPerson, updatePerson } from './actions';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAdmin.mockResolvedValue({
    id: 'admin-uuid',
    app_metadata: { role: 'admin' },
  });
  mocks.adminCreateUser.mockResolvedValue({
    data: { user: { id: 'new-auth-uuid' } },
    error: null,
  });
  mocks.adminUpdateUserById.mockResolvedValue({ error: null });
  mocks.selectResults = [];
  mocks.inserts = [];
  mocks.updates = [];
});

describe('createPerson', () => {
  it('rejects without admin', async () => {
    mocks.requireAdmin.mockImplementation(async () => {
      throw new Error('REDIRECT:/');
    });
    const fd = new FormData();
    fd.set('firstName', 'Tilley');
    fd.set('lastName', 'Shaye');
    await expect(createPerson(fd)).rejects.toThrow('REDIRECT:/');
    expect(mocks.adminCreateUser).not.toHaveBeenCalled();
    expect(mocks.inserts.length).toBe(0);
  });

  it('rejects when first/last name missing', async () => {
    const fd = new FormData();
    fd.set('firstName', '');
    fd.set('lastName', '');
    expect(await createPerson(fd)).toEqual({
      error: 'First and last name are both required.',
    });
  });

  it('rejects an invalid email', async () => {
    const fd = new FormData();
    fd.set('firstName', 'Tilley');
    fd.set('lastName', 'Shaye');
    fd.set('email', 'not-an-email');
    expect(await createPerson(fd)).toEqual({ error: 'Email looks invalid.' });
  });

  it('rejects roles without app access', async () => {
    const fd = new FormData();
    fd.set('firstName', 'Tilley');
    fd.set('lastName', 'Shaye');
    fd.append('roles', 'coach');
    expect(await createPerson(fd)).toEqual({
      error: 'App access is required to assign roles.',
    });
  });

  it('rejects an unsupported role like "staff"', async () => {
    const fd = new FormData();
    fd.set('firstName', 'Tilley');
    fd.set('lastName', 'Shaye');
    fd.set('appAccess', '1');
    fd.set('email', 'tilley@example.test');
    fd.append('roles', 'staff');
    expect(await createPerson(fd)).toEqual({
      error: "Role 'staff' is not selectable in v1 (admin and coach only).",
    });
  });

  it('rejects app access without an email', async () => {
    const fd = new FormData();
    fd.set('firstName', 'Tilley');
    fd.set('lastName', 'Shaye');
    fd.set('appAccess', '1');
    expect(await createPerson(fd)).toEqual({
      error: 'Email is required when granting app access.',
    });
  });

  it('rejects malformed dealer link', async () => {
    const fd = new FormData();
    fd.set('firstName', 'Tilley');
    fd.set('lastName', 'Shaye');
    fd.append('dealerLinks', 'not-a-link');
    expect(await createPerson(fd)).toEqual({
      error: "Invalid dealer link: 'not-a-link'.",
    });
  });

  it('rejects an invalid dealer-contact role', async () => {
    const fd = new FormData();
    fd.set('firstName', 'Tilley');
    fd.set('lastName', 'Shaye');
    fd.append('dealerLinks', '100:bogus');
    expect(await createPerson(fd)).toEqual({
      error: "Invalid dealer-contact role: 'bogus'.",
    });
  });

  it('creates a contact with no app access (Sales-Coach-style flow)', async () => {
    const fd = new FormData();
    fd.set('firstName', 'New');
    fd.set('lastName', 'Coach');
    // identifier swap reads its current state (no existing primary)
    mocks.selectResults = [
      [], // swap email: no existing
      [], // swap email: no conflict — actually swap returns early without inserting if empty value, so we won't reach here for missing email
    ];
    const result = await createPerson(fd);
    expect(result).toEqual({ ok: true, contactId: 999 });
    expect(mocks.adminCreateUser).not.toHaveBeenCalled();
    // Inserted contacts row.
    expect(mocks.inserts.some((i) => i.values && (i.values as { firstName?: string }).firstName === 'New')).toBe(true);
  });

  it('creates a contact + auth user + admin role end-to-end', async () => {
    const fd = new FormData();
    fd.set('firstName', 'Brand');
    fd.set('lastName', 'New');
    fd.set('email', 'brand@example.test');
    fd.set('appAccess', '1');
    fd.append('roles', 'admin');

    // queue, in order of consumption:
    // 1) swapPrimaryIdentifier(email): existing primary → none
    // 2) swapPrimaryIdentifier(email): conflict probe → none
    // 3) syncTeamMemberRoles: existing → none (phone is unset so swap-phone is gated and never runs)
    // 4) Conditional UPDATE … RETURNING after auth.admin.createUser → won the link
    mocks.selectResults = [[], [], [], [{ id: 999 }]];

    const result = await createPerson(fd);
    expect(result).toEqual({ ok: true, contactId: 999 });
    expect(mocks.adminCreateUser).toHaveBeenCalledWith({
      email: 'brand@example.test',
      email_confirm: true,
    });
    expect(mocks.adminUpdateUserById).toHaveBeenCalledWith('new-auth-uuid', {
      app_metadata: { role: 'admin' },
    });
  });

  it('compensates by banning the just-created auth user when the post-create link races and loses', async () => {
    const fd = new FormData();
    fd.set('firstName', 'Brand');
    fd.set('lastName', 'New');
    fd.set('email', 'brand@example.test');
    fd.set('appAccess', '1');
    fd.append('roles', 'admin');

    mocks.selectResults = [
      [], [], [], // identifier swaps (email × 2) + role-set sync
      [], // Conditional UPDATE … RETURNING → zero rows (lost the race)
      [{ userId: 'someone-else' }], // linkedNow check → different user_id
    ];

    const result = await createPerson(fd);
    expect(result).toEqual({
      error:
        'Auth user provisioning raced with another writer; the new auth user has been disabled. Refresh and check the People page.',
    });
    // Compensating ban on the orphan auth user.
    expect(mocks.adminUpdateUserById).toHaveBeenCalledWith('new-auth-uuid', {
      ban_duration: '876000h',
      app_metadata: { role: null },
    });
  });

  it('treats trigger-won link as the same outcome (UPDATE returns 0 but linked to our auth user)', async () => {
    const fd = new FormData();
    fd.set('firstName', 'Brand');
    fd.set('lastName', 'New');
    fd.set('email', 'brand@example.test');
    fd.set('appAccess', '1');

    // No roles → no syncTeamMemberRoles consumption inside the tx.
    mocks.selectResults = [
      [], [], // swap email existing + conflict
      [], // Conditional UPDATE → 0 rows
      [{ userId: 'new-auth-uuid' }], // linkedNow → same auth user (trigger won)
    ];

    const result = await createPerson(fd);
    expect(result).toEqual({ ok: true, contactId: 999 });
    // No compensating ban.
    expect(mocks.adminUpdateUserById).not.toHaveBeenCalledWith(
      'new-auth-uuid',
      expect.objectContaining({ ban_duration: expect.anything() }),
    );
  });

  it('returns partial-success warning if auth.admin.createUser fails post-DB-commit', async () => {
    mocks.adminCreateUser.mockResolvedValue({
      data: { user: null },
      error: { message: 'Service unavailable' },
    });
    const fd = new FormData();
    fd.set('firstName', 'Brand');
    fd.set('lastName', 'New');
    fd.set('email', 'brand@example.test');
    fd.set('appAccess', '1');
    mocks.selectResults = [[], []];

    // Partial success: contact was committed, auth-side failed. The UI must
    // refresh and close (the row exists), with a warning toast.
    const result = await createPerson(fd);
    expect(result).toEqual({
      ok: true,
      contactId: 999,
      warning:
        'Person created, but app access did not provision: Service unavailable. Open the row and retry.',
    });
  });
});

describe('updatePerson', () => {
  it('rejects without admin', async () => {
    mocks.requireAdmin.mockImplementation(async () => {
      throw new Error('REDIRECT:/');
    });
    const fd = new FormData();
    fd.set('contactId', '1');
    fd.set('firstName', 'X');
    fd.set('lastName', 'Y');
    await expect(updatePerson(fd)).rejects.toThrow('REDIRECT:/');
  });

  it('rejects when contact is missing', async () => {
    const fd = new FormData();
    fd.set('contactId', '1');
    fd.set('firstName', 'X');
    fd.set('lastName', 'Y');
    mocks.selectResults = [[]]; // current-state lookup returns no row
    expect(await updatePerson(fd)).toEqual({ error: 'Person not found.' });
  });

  it('rejects when contact is archived', async () => {
    const fd = new FormData();
    fd.set('contactId', '1');
    fd.set('firstName', 'X');
    fd.set('lastName', 'Y');
    mocks.selectResults = [
      [{ id: 1, userId: null, archivedAt: '2026-01-01T00:00:00Z' }],
    ];
    expect(await updatePerson(fd)).toEqual({ error: 'Person not found.' });
  });

  it('off→on app access provisions the auth user and links it', async () => {
    const fd = new FormData();
    fd.set('contactId', '1');
    fd.set('firstName', 'X');
    fd.set('lastName', 'Y');
    fd.set('email', 'x@example.test');
    fd.set('appAccess', '1');
    fd.append('roles', 'coach');
    // queue (each `await` on the chained Drizzle builder shifts one entry):
    // 1) current-state lookup → unarchived, no user_id yet
    // 2) tx.update(contacts).set(firstName/lastName).where(...) — bare await
    // 3,4) swap email: existing + conflict
    // 5) swap phone (newValue=''): existing only, returns early
    // 6) syncTeamMemberRoles: existing
    // 7) syncDealerLinks: existing
    // 8) Conditional UPDATE … RETURNING after auth.admin.createUser → won
    mocks.selectResults = [
      [{ id: 1, userId: null, archivedAt: null }],
      [],
      [],
      [],
      [],
      [],
      [],
      [{ id: 1 }],
    ];
    const result = await updatePerson(fd);
    expect(result).toEqual({ ok: true, contactId: 1 });
    expect(mocks.adminCreateUser).toHaveBeenCalledOnce();
    expect(mocks.adminUpdateUserById).toHaveBeenCalledWith('new-auth-uuid', {
      app_metadata: { role: null }, // coach but not admin
    });
  });

  it('off→on app access compensates by banning the new auth user when the link races and loses', async () => {
    const fd = new FormData();
    fd.set('contactId', '1');
    fd.set('firstName', 'X');
    fd.set('lastName', 'Y');
    fd.set('email', 'x@example.test');
    fd.set('appAccess', '1');
    fd.append('roles', 'admin');
    mocks.selectResults = [
      [{ id: 1, userId: null, archivedAt: null }],
      [], [], [], [], [], [], // current update + 2 swap email + swap phone + sync roles + sync dealer (6 entries)
      [], // Conditional UPDATE … RETURNING → zero rows (raced)
    ];
    const result = await updatePerson(fd);
    expect(result).toEqual({
      error:
        'App access was just provisioned by another admin. Refresh and re-check the row.',
    });
    // Compensating ban — the just-created auth user is disabled before
    // syncAuthMetadata could mint admin privilege on it.
    expect(mocks.adminUpdateUserById).toHaveBeenCalledWith('new-auth-uuid', {
      ban_duration: '876000h',
      app_metadata: { role: null },
    });
  });

  it('coerces roles=[] when appAccess is being toggled off (stale UI defence)', async () => {
    const fd = new FormData();
    fd.set('contactId', '1');
    fd.set('firstName', 'X');
    fd.set('lastName', 'Y');
    fd.append('roles', 'coach'); // stale: UI didn't clear when toggling off
    // appAccess unset → off
    mocks.selectResults = [
      [{ id: 1, userId: 'existing-auth', archivedAt: null }],
      [], [], [], [], [], // identifier swaps + role/dealer sync
    ];
    const result = await updatePerson(fd);
    expect(result).toEqual({ ok: true, contactId: 1 });
    // The on→off branch bans the auth user. The role-set is the empty list,
    // so syncTeamMemberRoles archives the coach row rather than restoring it.
    expect(mocks.adminUpdateUserById).toHaveBeenCalledWith('existing-auth', {
      ban_duration: '876000h',
      app_metadata: { role: null },
    });
    // No new auth user created from this stale state.
    expect(mocks.adminCreateUser).not.toHaveBeenCalled();
  });

  it('on→off app access bans the auth user and clears app_metadata.role', async () => {
    const fd = new FormData();
    fd.set('contactId', '1');
    fd.set('firstName', 'X');
    fd.set('lastName', 'Y');
    // appAccess unset → off
    mocks.selectResults = [
      [{ id: 1, userId: 'existing-auth', archivedAt: null }],
      [],
      [],
      [],
      [],
      [],
      [],
    ];
    const result = await updatePerson(fd);
    expect(result).toEqual({ ok: true, contactId: 1 });
    expect(mocks.adminUpdateUserById).toHaveBeenCalledWith('existing-auth', {
      ban_duration: '876000h',
      app_metadata: { role: null },
    });
    expect(mocks.adminCreateUser).not.toHaveBeenCalled();
  });
});

describe('archivePerson', () => {
  it('rejects without admin', async () => {
    mocks.requireAdmin.mockImplementation(async () => {
      throw new Error('REDIRECT:/');
    });
    const fd = new FormData();
    fd.set('contactId', '1');
    await expect(archivePerson(fd)).rejects.toThrow('REDIRECT:/');
  });

  it('refuses self-archive', async () => {
    const fd = new FormData();
    fd.set('contactId', '1');
    mocks.selectResults = [
      [{ id: 1, userId: 'admin-uuid', archivedAt: null }],
    ];
    expect(await archivePerson(fd)).toEqual({
      error: 'You cannot archive your own account.',
    });
  });

  it('archives team_member_roles + dealer_contacts but NOT contacts', async () => {
    const fd = new FormData();
    fd.set('contactId', '1');
    mocks.selectResults = [
      [{ id: 1, userId: 'someone-else', archivedAt: null }],
    ];
    const result = await archivePerson(fd);
    expect(result).toEqual({ ok: true, contactId: 1 });
    // Verify: no UPDATE on contacts table itself.
    const tablesUpdated = mocks.updates.map((u) => u.table);
    expect(tablesUpdated).not.toContain('contacts');
    expect(tablesUpdated).toContain('team_member_roles');
    expect(tablesUpdated).toContain('dealer_contacts');
    // Auth user banned.
    expect(mocks.adminUpdateUserById).toHaveBeenCalledWith('someone-else', {
      ban_duration: '876000h',
      app_metadata: { role: null },
    });
  });

  it('skips the auth-side ban when the contact has no user_id', async () => {
    const fd = new FormData();
    fd.set('contactId', '1');
    mocks.selectResults = [
      [{ id: 1, userId: null, archivedAt: null }],
    ];
    expect(await archivePerson(fd)).toEqual({ ok: true, contactId: 1 });
    expect(mocks.adminUpdateUserById).not.toHaveBeenCalled();
  });
});
