import { assertCan } from '@/lib/auth/assert-can';
import { PageHeader } from '@/components/app/page-header';
import { CampaignIndexList } from '@/features/sms/campaign-index-list';
import { loadSmsCampaignIndex } from '@/features/sms/queries';

// Global door to the per-campaign SMS ledger (0109): every SMS-relevant
// campaign — gate-active or with send/reply history — in one list, rows
// linking to the existing /calendar/<id>/sms pages. Exists so the event
// dialog stops being the only way in (it stays as a shortcut); /messages
// remains purely the conversation inbox. Gated `sms:send` — admin-only by
// the 0103 D4 mapping, same review-on-widening caveat as /messages.
export default async function SmsCampaignsPage() {
  await assertCan('sms:send'); // expected: server-only

  const index = await loadSmsCampaignIndex();
  const rows = index.map((r) => ({
    campaignId: r.campaignId,
    dealerName: r.dealerName,
    startDate: r.startDate,
    endDate: r.endDate,
    status: r.status,
    gateActive: r.gateActive,
    recipientCount: r.recipientCount,
    sendCount: r.sendCount,
    lastSendAtIso: r.lastSendAt ? r.lastSendAt.toISOString() : null,
    threadCount: r.threadCount,
    unreadThreads: r.unreadThreads,
    hotThreads: r.hotThreads,
    warmThreads: r.warmThreads,
    coldThreads: r.coldThreads,
  }));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="SMS"
        description="Every campaign with texting — import, launch, and watch replies without opening the calendar."
      />
      <CampaignIndexList rows={rows} />
    </div>
  );
}
