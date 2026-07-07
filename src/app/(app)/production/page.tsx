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
import { ProductionFeedShare } from './production-feed-share';

export default async function ProductionPage() {
  await assertCan('admin:access'); // expected: server-only

  const [campaigns, dealers, coaches, styles, sources] = await Promise.all([
    loadCampaigns(),
    loadDealers(),
    loadCoaches(),
    loadCampaignStyles(),
    loadAudienceSources(),
  ]);

  // 0097: the ready-to-paste IMPORTDATA formula for the third-party Google Sheet.
  // Token comes from server env (this page is admin-gated); null when unwired.
  const feedToken = process.env.PRODUCTION_FEED_TOKEN;
  const feedOrigin = process.env.SITE_URL || 'http://localhost:3000';
  const feedFormula = feedToken
    ? `=IMPORTDATA("${feedOrigin}/api/production-feed?token=${feedToken}")`
    : null;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Production List"
        description="All campaigns imported from the legacy spreadsheet."
        actions={<ProductionPageActions />}
      />
      <ProductionFeedShare formula={feedFormula} />
      <ProductionAdmin
        campaigns={campaigns}
        dealers={dealers}
        coaches={coaches}
        styles={styles}
        sources={sources}
      />
    </div>
  );
}
