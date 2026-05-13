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

      <section className="rounded-2xl border border-stone-200 bg-white p-5 shadow-[0_1px_4px_rgba(15,30,60,0.08)]">
        <ReportsTabs byDealer={byDealer} byCoach={byCoach} byMonth={byMonth} full={full} />
      </section>
    </div>
  );
}
