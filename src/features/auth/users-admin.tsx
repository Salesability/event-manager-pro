'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Dialog } from '@/components/ui/dialog';
import { toast } from '@/components/ui/toaster';
import {
  createUser,
  deactivateUser,
  setUserRoles,
} from '@/features/auth/actions';
import type { AdminUserRow } from '@/features/auth/queries';

const inputClass =
  'min-w-0 rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm text-stone-800 outline-none transition focus:border-accent focus:ring-3 focus:ring-accent/20';

const headerAddClass =
  'rounded-lg border border-accent/40 bg-white px-3 py-1 text-xs font-semibold text-accent transition hover:border-accent hover:bg-accent/10';

const rowEditClass =
  'rounded border border-stone-200 bg-white px-2 py-0.5 text-xs font-medium text-stone-600 transition hover:border-navy hover:text-navy';

const rowDeleteClass =
  'rounded border border-stone-200 bg-white px-2 py-0.5 text-xs font-bold text-status-red transition hover:border-status-red hover:bg-status-red/10 disabled:cursor-not-allowed disabled:opacity-50';

const submitClass =
  'rounded-lg bg-navy px-3 py-2 text-xs font-semibold text-white transition hover:bg-navy-light disabled:cursor-not-allowed disabled:opacity-60';

const chipBase =
  'inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide';

function fmtDateTime(iso: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function isActive(u: AdminUserRow) {
  if (!u.bannedUntil) return true;
  const t = Date.parse(u.bannedUntil);
  return Number.isFinite(t) && t < Date.now();
}

export function UsersAdmin({ users }: { users: AdminUserRow[] }) {
  const [addOpen, setAddOpen] = useState(false);

  return (
    <section className="rounded-2xl border border-stone-200 bg-white p-5 shadow-[0_1px_4px_rgba(15,30,60,0.08)]">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-display text-2xl text-navy">Team members</h2>
          <p className="text-xs text-stone-500">{users.length} accounts</p>
        </div>
        <button onClick={() => setAddOpen(true)} className={headerAddClass}>
          + Add user
        </button>
      </div>

      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-stone-200 text-left text-[11px] font-semibold uppercase tracking-wide text-stone-500">
              <th className="px-2 py-2">Email</th>
              <th className="px-2 py-2">Roles</th>
              <th className="px-2 py-2">Providers</th>
              <th className="px-2 py-2">Last sign-in</th>
              <th className="px-2 py-2">Status</th>
              <th className="px-2 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {users.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-2 py-6 text-center text-sm text-stone-500">
                  No users yet.
                </td>
              </tr>
            ) : (
              users.map((u) => <UserRow key={u.id} user={u} />)
            )}
          </tbody>
        </table>
      </div>

      <Dialog.Root open={addOpen} onClose={setAddOpen}>
        <Dialog.Backdrop />
        <Dialog.Panel>
          <Dialog.Title>Add user</Dialog.Title>
          <Dialog.Description>
            Creates an auth account with no password. The user signs in via magic link or Google.
          </Dialog.Description>
          {addOpen && <AddUserForm onSuccess={() => setAddOpen(false)} />}
        </Dialog.Panel>
      </Dialog.Root>
    </section>
  );
}

function UserRow({ user }: { user: AdminUserRow }) {
  const router = useRouter();
  const [editOpen, setEditOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const active = isActive(user);

  function onDeactivate() {
    if (
      !confirm(
        `Deactivate ${user.email}? They will be banned from sign-in and their team-member roles archived. The auth row stays for audit history.`,
      )
    ) {
      return;
    }
    startTransition(async () => {
      const fd = new FormData();
      fd.set('userId', user.id);
      const result = await deactivateUser(fd);
      if ('ok' in result) {
        toast.success('User deactivated');
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <tr className={active ? '' : 'opacity-60'}>
      <td className="px-2 py-2 align-middle">
        <div className="font-medium text-stone-800">{user.email ?? '—'}</div>
        {user.displayName && (
          <div className="text-xs text-stone-500">{user.displayName}</div>
        )}
      </td>
      <td className="px-2 py-2 align-middle">
        <div className="flex flex-wrap gap-1">
          {user.roles.length === 0 ? (
            <span className="text-xs text-stone-400">—</span>
          ) : (
            user.roles.map((r) => (
              <span
                key={r}
                className={`${chipBase} ${
                  r === 'admin'
                    ? 'bg-accent/15 text-accent'
                    : r === 'coach'
                      ? 'bg-navy/10 text-navy'
                      : 'bg-stone-100 text-stone-600'
                }`}
              >
                {r}
              </span>
            ))
          )}
        </div>
      </td>
      <td className="px-2 py-2 align-middle text-xs text-stone-600">
        {user.providers.join(', ')}
      </td>
      <td className="px-2 py-2 align-middle text-xs text-stone-600">
        {fmtDateTime(user.lastSignInAt)}
      </td>
      <td className="px-2 py-2 align-middle">
        <span className={`${chipBase} ${active ? 'bg-status-green/15 text-status-green' : 'bg-stone-200 text-stone-600'}`}>
          {active ? 'active' : 'deactivated'}
        </span>
      </td>
      <td className="px-2 py-2 align-middle">
        <div className="flex shrink-0 items-center justify-end gap-1">
          <button
            onClick={() => setEditOpen(true)}
            disabled={!user.contactId}
            title={user.contactId ? 'Edit roles' : 'Link this user to a contact (Phase 3) before assigning roles.'}
            className={rowEditClass}
          >
            Roles
          </button>
          {active && (
            <button
              onClick={onDeactivate}
              disabled={pending}
              aria-label={`Deactivate ${user.email}`}
              className={rowDeleteClass}
            >
              ✕
            </button>
          )}
        </div>
        <Dialog.Root open={editOpen} onClose={setEditOpen}>
          <Dialog.Backdrop />
          <Dialog.Panel>
            <Dialog.Title>Edit roles — {user.email}</Dialog.Title>
            {editOpen && <RolesForm user={user} onSuccess={() => setEditOpen(false)} />}
          </Dialog.Panel>
        </Dialog.Root>
      </td>
    </tr>
  );
}

function AddUserForm({ onSuccess }: { onSuccess: () => void }) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [admin, setAdmin] = useState(false);
  const [coach, setCoach] = useState(false);
  const [pending, startTransition] = useTransition();

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const trimmed = email.trim().toLowerCase();
    if (!trimmed) {
      toast.error('Email is required.');
      return;
    }
    startTransition(async () => {
      const fd = new FormData();
      fd.set('email', trimmed);
      if (admin) fd.append('roles', 'admin');
      if (coach) fd.append('roles', 'coach');
      const result = await createUser(fd);
      if ('ok' in result) {
        toast.success('User created');
        router.refresh();
        onSuccess();
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <form onSubmit={submit} className="mt-4 flex flex-col gap-3">
      <label className="flex flex-col gap-1 text-xs font-medium text-stone-600">
        Email
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={inputClass}
          autoFocus
          required
        />
      </label>

      <div className="flex flex-col gap-1 rounded-lg border border-stone-200 bg-stone-50/40 px-3 py-2">
        <span className="text-xs font-medium text-stone-600">Roles</span>
        <label className="flex items-center gap-2 text-sm text-stone-700">
          <input type="checkbox" checked={admin} onChange={(e) => setAdmin(e.target.checked)} />
          Admin — gates <code className="text-xs">/admin/*</code>
        </label>
        <label className="flex items-center gap-2 text-sm text-stone-700">
          <input type="checkbox" checked={coach} onChange={(e) => setCoach(e.target.checked)} />
          Coach — auto-filters their <code className="text-xs">/calendar</code>
        </label>
        <p className="text-[11px] text-stone-500">
          Roles can only be assigned to a user already linked to a contact. (Contact linkage ships in
          Phase 3.) For a brand-new email, create the user first, then link a contact and edit roles.
        </p>
      </div>

      <div className="mt-2 flex justify-end gap-2">
        <Dialog.Close className={rowEditClass}>Cancel</Dialog.Close>
        <button type="submit" disabled={pending} className={submitClass}>
          {pending ? 'Creating…' : 'Create user'}
        </button>
      </div>
    </form>
  );
}

function RolesForm({ user, onSuccess }: { user: AdminUserRow; onSuccess: () => void }) {
  const router = useRouter();
  const [admin, setAdmin] = useState(user.roles.includes('admin'));
  const [coach, setCoach] = useState(user.roles.includes('coach'));
  const [pending, startTransition] = useTransition();

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    startTransition(async () => {
      const fd = new FormData();
      fd.set('userId', user.id);
      if (admin) fd.append('roles', 'admin');
      if (coach) fd.append('roles', 'coach');
      const result = await setUserRoles(fd);
      if ('ok' in result) {
        toast.success('Roles updated');
        router.refresh();
        onSuccess();
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <form onSubmit={submit} className="mt-4 flex flex-col gap-3">
      <div className="flex flex-col gap-1 rounded-lg border border-stone-200 bg-stone-50/40 px-3 py-2">
        <label className="flex items-center gap-2 text-sm text-stone-700">
          <input type="checkbox" checked={admin} onChange={(e) => setAdmin(e.target.checked)} />
          Admin
        </label>
        <label className="flex items-center gap-2 text-sm text-stone-700">
          <input type="checkbox" checked={coach} onChange={(e) => setCoach(e.target.checked)} />
          Coach
        </label>
      </div>
      <div className="mt-2 flex justify-end gap-2">
        <Dialog.Close className={rowEditClass}>Cancel</Dialog.Close>
        <button type="submit" disabled={pending} className={submitClass}>
          {pending ? 'Saving…' : 'Save'}
        </button>
      </div>
    </form>
  );
}
