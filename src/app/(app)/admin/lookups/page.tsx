import { assertCan } from '@/lib/auth/assert-can';
import { PageHeader } from '@/components/app/page-header';
import { LookupAdmin } from '@/features/schedule/lookup-admin';
import { loadCampaignStyles, loadAudienceSources } from '@/features/schedule/queries';

export default async function LookupsPage() {
  await assertCan('admin:access'); // expected: server-only
  const [styles, sources] = await Promise.all([loadCampaignStyles(), loadAudienceSources()]);

  // Neither the service catalog nor the sales-tax rates are edited here anymore —
  // QuickBooks is the master for both (items: 0071; tax rates: 0075). Sync them on
  // the QuickBooks admin page.
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Lookup Admin"
        description="Manage booking form event styles and data sources. Service items and sales-tax rates are mastered in QuickBooks — sync them on the QuickBooks admin page."
      />

      <div className="grid gap-5 lg:grid-cols-2">
        <LookupAdmin kind="styles" items={styles} />
        <LookupAdmin kind="sources" items={sources} />
      </div>
    </div>
  );
}
