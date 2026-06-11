import { assertCan } from '@/lib/auth/assert-can';
import { PageHeader } from '@/components/app/page-header';
import { LookupAdmin } from '@/features/schedule/lookup-admin';
import { loadCampaignStyles, loadAudienceSources } from '@/features/schedule/queries';
import { TaxRateMapping } from '@/features/tax-rates/tax-rate-mapping';
import { loadTaxMappingAdmin } from '@/features/tax-rates/queries';

export default async function LookupsPage() {
  await assertCan('admin:access'); // expected: server-only
  const [styles, sources, taxMapping] = await Promise.all([
    loadCampaignStyles(),
    loadAudienceSources(),
    loadTaxMappingAdmin(),
  ]);

  // The service catalog is mastered in QuickBooks (0071, synced on the QuickBooks
  // admin page). Sales-tax rates are QB-sourced too, but their province → QB-code
  // MAPPING is managed here (0076 — the rate follows the mapped code).
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Lookup Admin"
        description="Manage booking form event styles and data sources, and map each province's sales-tax rate to a QuickBooks tax code. Service items are mastered in QuickBooks — sync them on the QuickBooks admin page."
      />

      <div className="grid gap-5 lg:grid-cols-2">
        <LookupAdmin kind="styles" items={styles} />
        <LookupAdmin kind="sources" items={sources} />
      </div>

      <TaxRateMapping data={taxMapping} />
    </div>
  );
}
