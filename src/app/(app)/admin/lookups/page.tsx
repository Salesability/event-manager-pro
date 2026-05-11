import { assertCan } from '@/lib/auth/assert-can';
import { LookupAdmin } from '@/features/schedule/lookup-admin';
import { loadCampaignStyles, loadAudienceSources } from '@/features/schedule/queries';
import { ServicesAdmin } from '@/features/services/services-admin';
import { loadServiceItems } from '@/features/services/queries';

export default async function LookupsPage() {
  await assertCan('admin:access'); // expected: server-only
  const [styles, sources, services] = await Promise.all([
    loadCampaignStyles(),
    loadAudienceSources(),
    loadServiceItems(),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-3xl text-navy">Lookup Admin</h1>
        <p className="mt-1 text-sm text-stone-600">
          Manage booking form event styles, data sources, and the quote-composer service catalog.
        </p>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <LookupAdmin kind="styles" items={styles} />
        <LookupAdmin kind="sources" items={sources} />
      </div>

      <ServicesAdmin items={services} />
    </div>
  );
}
