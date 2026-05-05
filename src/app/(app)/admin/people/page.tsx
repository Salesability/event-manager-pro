import { requireAdmin } from '@/lib/auth/require-admin';
import { loadAdminPeople, loadOrphanAuthUsers } from '@/features/people/queries';
import { loadDealers } from '@/features/schedule/queries';
import { OrphanAuthUsers } from '@/features/people/orphan-auth-users';
import { PeopleAdmin } from '@/features/people/people-admin';

export default async function PeopleAdminPage() {
  await requireAdmin();
  const [people, dealers, orphans] = await Promise.all([
    loadAdminPeople(),
    loadDealers(),
    loadOrphanAuthUsers(),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-3xl text-navy">People</h1>
        <p className="mt-1 text-sm text-stone-600">
          One row per person. Toggle <strong>App access</strong> to grant them a sign-in. Add{' '}
          <strong>Coach</strong> to make them assignable on the calendar. Add{' '}
          <strong>Admin</strong> to grant management rights.
        </p>
      </div>

      <PeopleAdmin people={people} dealers={dealers} />

      {/* Hidden in the steady state — only renders when there's at least one
          orphan auth.users row (someone created via the Supabase dashboard
          fallback, or a legacy account from before the auto-link trigger). */}
      {orphans.length > 0 && <OrphanAuthUsers orphans={orphans} />}
    </div>
  );
}
