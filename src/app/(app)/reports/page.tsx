import { assertCan } from '@/lib/auth/assert-can';
import { PageHeader } from '@/components/app/page-header';
import {
  loadCampaignsByCoach,
  loadCampaignsByDealer,
  loadCampaignsByMonth,
  loadFullProductionReport,
} from '@/features/schedule/queries';
import { ReportsTabs } from '@/features/reports/reports-tabs';

export default async function ReportsPage() {
  await assertCan('reports:view'); // expected: server-only

  // Billing-figure edits are admin-only (0059) — gated client-side via
  // `useCan('reports:edit-billing')` in <ReportsTabs> and enforced server-side
  // by the `setBillingAdjustment` action's `capabilityClient`.
  const [byDealer, byCoach, byMonth, full] = await Promise.all([
    loadCampaignsByDealer(),
    loadCampaignsByCoach(),
    loadCampaignsByMonth(),
    loadFullProductionReport(),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Reports"
        description="Booking summary across dealers, coaches, and months — plus the full production list."
      />

      <section className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-[0_1px_4px_rgba(15,30,60,0.08)]">
        <ReportsTabs byDealer={byDealer} byCoach={byCoach} byMonth={byMonth} full={full} />
      </section>
    </div>
  );
}
