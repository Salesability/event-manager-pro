import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  adminCreateUser: vi.fn(),
  adminUpdateUserById: vi.fn(),
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
        where: () => ({
          limit: async () => [],
        }),
      }),
    }),
    transaction: async (fn: (tx: unknown) => Promise<void>) => fn({}),
  },
}));

import { createUser } from './actions';

describe('createUser', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAdmin.mockResolvedValue({ id: 'admin-id', app_metadata: { role: 'admin' } });
    mocks.adminUpdateUserById.mockResolvedValue({ error: null });
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
