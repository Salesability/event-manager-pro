import { requireAdmin } from '@/lib/auth/require-admin';
import { loadAdminUsers } from '@/features/auth/queries';
import { UsersAdmin } from '@/features/auth/users-admin';

export default async function UsersAdminPage() {
  await requireAdmin();
  const users = await loadAdminUsers();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-3xl text-navy">Users</h1>
        <p className="mt-1 text-sm text-stone-600">
          Provision team members and assign roles. Admin and Coach are the only role checkboxes
          wired in v1.
        </p>
      </div>

      <UsersAdmin users={users} />
    </div>
  );
}
