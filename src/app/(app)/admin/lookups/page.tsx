import { assertCan } from '@/lib/auth/assert-can';
import { LookupAdmin } from '@/features/schedule/lookup-admin';
import { loadCampaignStyles, loadSalesLeadSources } from '@/features/schedule/queries';

export default async function LookupsPage() {
  await assertCan('admin:access'); // expected: server-only
  const [styles, sources] = await Promise.all([loadCampaignStyles(), loadSalesLeadSources()]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-3xl text-navy">Lookup Admin</h1>
        <p className="mt-1 text-sm text-stone-600">
          Manage booking form event styles and data sources.
        </p>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <LookupAdmin kind="styles" items={styles} />
        <LookupAdmin kind="sources" items={sources} />
      </div>
    </div>
  );
}
