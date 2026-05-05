import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  adminCreateUser: vi.fn(),
  adminUpdateUserById: vi.fn(),
  // Queue of arrays returned by successive `db.select(...).from(...).where(...).limit(...)` calls.
  selectResults: [] as unknown[][],
  // For conditional UPDATE … RETURNING: queue of returned-row arrays. If empty,
  // an unconditional `await` on a `update().set().where()` resolves with no rows.
  updateReturning: [] as unknown[][],
  updateCalls: [] as unknown[],
}));

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/headers', () => ({ headers: vi.fn() }));
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

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));

vi.mock('@/lib/db', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => {
          // Two terminal styles: `.limit(n)` and `.orderBy(...)`. Each returns
          // the next queued array (resolving to thenable for `await` directly).
          const next = () => Promise.resolve(mocks.selectResults.shift() ?? []);
          const chain = {
            limit: () => next(),
            orderBy: () => next(),
            then: (onFulfilled: (v: unknown[]) => unknown) => next().then(onFulfilled),
          };
          return chain;
        },
      }),
    }),
    update: () => ({
      set: (patch: unknown) => ({
        where: () => {
          mocks.updateCalls.push(patch);
          const returnRows = () =>
            Promise.resolve(mocks.updateReturning.shift() ?? [{ id: 0 }]);
          // Both shapes are used: bare `await update().set().where()` and the
          // conditional `update().set().where().returning(...)`. The thenable
          // is the bare path; `.returning()` is the conditional path.
          const chain = {
            returning: () => returnRows(),
            then: (onFulfilled: (v: unknown) => unknown) => returnRows().then(onFulfilled),
          };
          return chain;
        },
      }),
    }),
    transaction: async (fn: (tx: unknown) => Promise<void>) => fn({}),
  },
}));

import { createUser, linkUserToContact } from './actions';

describe('createUser', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAdmin.mockResolvedValue({ id: 'admin-id', app_metadata: { role: 'admin' } });
    mocks.adminUpdateUserById.mockResolvedValue({ error: null });
    mocks.selectResults = [];
    mocks.updateReturning = [];
    mocks.updateCalls = [];
  });

  it('non-admin caller is rejected by requireAdmin (throws redirect)', async () => {
    mocks.requireAdmin.mockImplementation(async () => {
      throw new Error('REDIRECT:/');
    });
    const fd = new FormData();
    fd.set('email', 'someone@example.com');
    await expect(createUser(fd)).rejects.toThrow('REDIRECT:/');
    expect(mocks.adminCreateUser).not.toHaveBeenCalled();
  });

  it('rejects an empty or invalid email before hitting Supabase', async () => {
    const fd = new FormData();
    fd.set('email', 'not-an-email');
    const result = await createUser(fd);
    expect(result).toEqual({ error: 'A valid email is required.' });
    expect(mocks.adminCreateUser).not.toHaveBeenCalled();
  });

  it('surfaces a duplicate-email error from Supabase verbatim', async () => {
    mocks.adminCreateUser.mockResolvedValue({
      data: { user: null },
      error: { message: 'A user with this email address has already been registered' },
    });
    const fd = new FormData();
    fd.set('email', 'taken@example.com');
    const result = await createUser(fd);
    expect(result).toEqual({
      error: 'A user with this email address has already been registered',
    });
  });

  it('rejects an unsupported role like "staff" with a clear message', async () => {
    const fd = new FormData();
    fd.set('email', 'new@example.com');
    fd.append('roles', 'staff');
    const result = await createUser(fd);
    expect(result).toEqual({
      error: "Role 'staff' is not selectable in v1 (admin and coach only).",
    });
    expect(mocks.adminCreateUser).not.toHaveBeenCalled();
  });
});

describe('linkUserToContact', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAdmin.mockResolvedValue({ id: 'admin-id', app_metadata: { role: 'admin' } });
    mocks.selectResults = [];
    mocks.updateReturning = [];
    mocks.updateCalls = [];
  });

  it('links an unlinked contact to the user (happy path)', async () => {
    // Calls in order:
    // 1) fetch target contact → unarchived, user_id null
    // 2) check user not already linked elsewhere → empty
    // 3) conditional UPDATE … RETURNING returns the row id (we won the race)
    mocks.selectResults = [
      [{ id: 42, userId: null, archivedAt: null }],
      [],
    ];
    mocks.updateReturning = [[{ id: 42 }]];
    const fd = new FormData();
    fd.set('userId', 'user-uuid-1');
    fd.set('contactId', '42');
    const result = await linkUserToContact(fd);
    expect(result).toEqual({ ok: true });
    expect(mocks.updateCalls).toEqual([{ userId: 'user-uuid-1' }]);
  });

  it('returns a refresh prompt when a concurrent writer won the race', async () => {
    // Pre-checks pass, but the conditional UPDATE returns zero rows because
    // another admin set user_id between the read and the write.
    mocks.selectResults = [
      [{ id: 42, userId: null, archivedAt: null }],
      [],
    ];
    mocks.updateReturning = [[]];
    const fd = new FormData();
    fd.set('userId', 'user-uuid-1');
    fd.set('contactId', '42');
    const result = await linkUserToContact(fd);
    expect(result).toEqual({
      error:
        'Contact was just linked to another user (or archived) by someone else. Refresh and retry.',
    });
  });

  it('errors when the contact is linked to a different user', async () => {
    mocks.selectResults = [
      [{ id: 42, userId: 'other-user', archivedAt: null }],
    ];
    const fd = new FormData();
    fd.set('userId', 'user-uuid-1');
    fd.set('contactId', '42');
    const result = await linkUserToContact(fd);
    expect(result).toEqual({
      error: 'Contact 42 is already linked to a different user.',
    });
    expect(mocks.updateCalls).toEqual([]);
  });

  it('is idempotent when the contact is already linked to the same user', async () => {
    mocks.selectResults = [
      [{ id: 42, userId: 'user-uuid-1', archivedAt: null }],
    ];
    const fd = new FormData();
    fd.set('userId', 'user-uuid-1');
    fd.set('contactId', '42');
    const result = await linkUserToContact(fd);
    expect(result).toEqual({ ok: true });
    expect(mocks.updateCalls).toEqual([]);
  });

  it('errors when the user is already linked to a different contact', async () => {
    mocks.selectResults = [
      [{ id: 42, userId: null, archivedAt: null }],
      [{ id: 17 }],
    ];
    const fd = new FormData();
    fd.set('userId', 'user-uuid-1');
    fd.set('contactId', '42');
    const result = await linkUserToContact(fd);
    expect(result).toEqual({ error: 'User is already linked to contact 17.' });
    expect(mocks.updateCalls).toEqual([]);
  });

  it('rejects a non-admin caller', async () => {
    mocks.requireAdmin.mockImplementation(async () => {
      throw new Error('REDIRECT:/');
    });
    const fd = new FormData();
    fd.set('userId', 'user-uuid-1');
    fd.set('contactId', '42');
    await expect(linkUserToContact(fd)).rejects.toThrow('REDIRECT:/');
  });

  it('rejects when contactId is missing or invalid', async () => {
    const fd = new FormData();
    fd.set('userId', 'user-uuid-1');
    const result = await linkUserToContact(fd);
    expect(result).toEqual({ error: 'Invalid contact id.' });
  });
});
