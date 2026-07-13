import { notFound } from 'next/navigation';
import { assertCan } from '@/lib/auth/assert-can';
import { Button } from '@/components/catalyst/button';
import { PageHeader } from '@/components/app/page-header';
import { loadCampaign } from '@/features/schedule/queries';
import {
  evaluateCampaignRecipients,
  loadSmsSendLog,
} from '@/features/sms/queries';
import { SmsPanel } from '@/features/sms/sms-panel';

// Campaign SMS surface (0103 Phase 5): import the dealer's list, review the
// compliance exclusions, compose + launch, and read the delivery log. Reached
// from the event dialog's "SMS" button (which only renders when the add-on
// gate is active); deep-navigating to a campaign without the add-on gets the
// explanatory empty state below, not a working composer — the D1 gate is
// enforced server-side at launch either way.

export default async function CampaignSmsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await assertCan('sms:send');

  const { id: idParam } = await params;
  const campaignId = Number(idParam);
  if (!Number.isInteger(campaignId) || campaignId <= 0) notFound();

  const campaign = await loadCampaign(campaignId);
  if (!campaign) notFound();

  const backHref = `/calendar?event=${campaign.id}`;
  const gateActive = campaign.status === 'booked' && (campaign.smsEmail ?? 0) > 0;

  if (!gateActive) {
    return (
      <div className="space-y-6">
        <PageHeader
          title={`Campaign SMS — ${campaign.dealerName}`}
          description={eventDateLabel(campaign.startDate, campaign.endDate)}
          actions={
            <Button outline compact href={backHref}>
              Back to event
            </Button>
          }
        />
        <p className="max-w-xl text-sm text-zinc-600">
          {campaign.status !== 'booked'
            ? `SMS is only available for booked campaigns (this one is ${campaign.status}).`
            : 'The SMS add-on is not active for this campaign — its accepted quote has no Digital (SMS / Email) touches. Add the line to the quote (or accept one that carries it) and this surface lights up.'}
        </p>
      </div>
    );
  }

  const [{ recipients, summary }, sendLogRaw] = await Promise.all([
    evaluateCampaignRecipients(campaign.id),
    loadSmsSendLog(campaign.id),
  ]);

  const excluded = recipients
    .filter((r) => !r.eligibility.eligible)
    .map((r) => ({
      phone: r.phone,
      reason: r.eligibility.eligible ? ('stale_consent' as const) : r.eligibility.reason,
    }));

  const defaultBody = `Hi {{first_name}}, {{dealer_name}} is hosting a private sales event ${eventDateLabel(campaign.startDate, campaign.endDate)}. Reply to book your appointment.`;

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Campaign SMS — ${campaign.dealerName}`}
        description={eventDateLabel(campaign.startDate, campaign.endDate)}
        actions={
          <Button outline compact href={backHref}>
            Back to event
          </Button>
        }
      />
      <SmsPanel
        campaignId={campaign.id}
        summary={summary}
        excluded={excluded}
        defaultBody={defaultBody}
        sendLog={sendLogRaw.map((s) => ({
          id: s.id,
          body: s.body,
          createdAtIso: s.createdAt.toISOString(),
          totalRecipients: s.totalRecipients,
          excludedOptOut: s.excludedOptOut,
          excludedStaleConsent: s.excludedStaleConsent,
          messageCounts: s.messageCounts,
        }))}
      />
    </div>
  );
}

function eventDateLabel(startIso: string, endIso: string): string {
  const fmt = (iso: string) => {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      timeZone: 'UTC',
    });
  };
  return startIso === endIso ? fmt(startIso) : `${fmt(startIso)} – ${fmt(endIso)}`;
}
