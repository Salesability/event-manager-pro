import { assertCan } from '@/lib/auth/assert-can';
import { loadAdminPeople, loadOrphanAuthUsers } from '@/features/people/queries';
import { loadDealers } from '@/features/schedule/queries';
import { OrphanAuthUsers } from '@/features/people/orphan-auth-users';
import { PeopleAdmin } from '@/features/people/people-admin';

export default async function PeopleAdminPage() {
  await assertCan('admin:access'); // expected: server-only
  const [people, dealers, orphans] = await Promise.all([
    loadAdminPeople(),
    loadDealers(),
    loadOrphanAuthUsers(),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-display text-3xl text-navy">People</h1>

      <PeopleAdmin people={people} dealers={dealers} />

      {/* Hidden in the steady state — only renders when there's at least one
          orphan auth.users row (someone created via the Supabase dashboard
          fallback, or a legacy account from before the auto-link trigger). */}
      {orphans.length > 0 && <OrphanAuthUsers orphans={orphans} />}
    </div>
  );
}
