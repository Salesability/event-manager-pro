import { assertCan } from '@/lib/auth/assert-can';
import { PageHeader } from '@/components/app/page-header';
import {
  loadCampaignStyles,
  loadCampaigns,
  loadCoaches,
  loadDealers,
  loadAudienceSources,
} from '@/features/schedule/queries';
import { ProductionAdmin } from './production-admin';
import { ProductionPageActions } from './production-page-actions';
import { todayIso } from './filter';

export default async function ProductionPage() {
  await assertCan('admin:access'); // expected: server-only

  const [campaigns, dealers, coaches, styles, sources] = await Promise.all([
    loadCampaigns(),
    loadDealers(),
    loadCoaches(),
    loadCampaignStyles(),
    loadAudienceSources(),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Production List"
        description="All campaigns imported from the legacy spreadsheet."
        actions={<ProductionPageActions />}
      />
      <ProductionAdmin
        campaigns={campaigns}
        dealers={dealers}
        coaches={coaches}
        styles={styles}
        sources={sources}
        todayIso={todayIso()}
      />
    </div>
  );
}
