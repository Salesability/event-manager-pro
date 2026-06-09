import { assertCan } from '@/lib/auth/assert-can';
import { PageHeader } from '@/components/app/page-header';
import { LookupAdmin } from '@/features/schedule/lookup-admin';
import { loadCampaignStyles, loadAudienceSources } from '@/features/schedule/queries';
import { TaxRatesAdmin } from '@/features/tax-rates/tax-rates-admin';
import { loadTaxRates } from '@/features/tax-rates/queries';

export default async function LookupsPage() {
  await assertCan('admin:access'); // expected: server-only
  const [styles, sources, taxRates] = await Promise.all([
    loadCampaignStyles(),
    loadAudienceSources(),
    loadTaxRates(),
  ]);

  // The quote-composer service catalog is no longer edited here — QuickBooks is
  // the item master (0071). Items are synced (read-only) on /admin/quickbooks.
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Lookup Admin"
        description="Manage booking form event styles and data sources. Service items are mastered in QuickBooks — sync them on the QuickBooks admin page."
      />

      <div className="grid gap-5 lg:grid-cols-2">
        <LookupAdmin kind="styles" items={styles} />
        <LookupAdmin kind="sources" items={sources} />
      </div>

      <TaxRatesAdmin items={taxRates} />
    </div>
  );
}
