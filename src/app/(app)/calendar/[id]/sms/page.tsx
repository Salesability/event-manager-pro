import { notFound } from 'next/navigation';
import { assertCan } from '@/lib/auth/assert-can';
import { Button } from '@/components/catalyst/button';
import { PageHeader } from '@/components/app/page-header';
import { loadCampaign } from '@/features/schedule/queries';
import { ConversationsPanel } from '@/features/sms/conversations/conversations-panel';
import {
  loadCampaignConversations,
  loadReassignCandidates,
} from '@/features/sms/conversations/queries';
import {
  evaluateCampaignRecipients,
  loadRecipientHistory,
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

  // Conversations render on BOTH branches (0106): a customer can reply after
  // the event completes and the launch gate lapses — the thread must stay
  // visible and answerable either way.
  const conversationsRaw = await loadCampaignConversations(campaign.id);
  const conversations = await Promise.all(
    conversationsRaw.map(async (c) => ({
      id: c.id,
      phone: c.phone,
      displayName: c.displayName,
      lastMessageAtIso: c.lastMessageAt.toISOString(),
      unread: c.unread,
      awaitingReply: c.awaitingReply,
      optedOut: c.optedOut,
      messages: c.messages.map((m) => ({
        id: m.id,
        direction: m.direction,
        body: m.body,
        status: m.status,
        errorCode: m.errorCode,
        aiDrafted: m.aiDrafted,
        createdAtIso: m.createdAt.toISOString(),
      })),
      reassignCandidates: await loadReassignCandidates(c.id),
    })),
  );

  if (!gateActive) {
    const sendLogRaw = await loadSmsSendLog(campaign.id);
    const sendLog = sendLogRaw.map((s) => ({
      id: s.id,
      body: s.body,
      createdAtIso: s.createdAt.toISOString(),
      totalRecipients: s.totalRecipients,
      excludedOptOut: s.excludedOptOut,
      excludedStaleConsent: s.excludedStaleConsent,
      messageCounts: s.messageCounts,
    }));

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
        {sendLog.length > 0 && <ReadOnlySendLog sendLog={sendLog} />}
        <ConversationsPanel conversations={conversations} />
      </div>
    );
  }

  const [{ recipients, summary }, sendLogRaw, history] = await Promise.all([
    evaluateCampaignRecipients(campaign.id),
    loadSmsSendLog(campaign.id),
    loadRecipientHistory(campaign.id),
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
        history={history.map((h) => ({
          phone: h.phone,
          priorCount: h.priorCount,
          lastStatus: h.lastStatus,
          lastAtIso: h.lastAt.toISOString(),
          identity: h.identity,
        }))}
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
      <ConversationsPanel conversations={conversations} />
    </div>
  );
}

function ReadOnlySendLog({
  sendLog,
}: {
  sendLog: Array<{
    id: number;
    body: string;
    createdAtIso: string;
    totalRecipients: number;
    excludedOptOut: number;
    excludedStaleConsent: number;
    messageCounts: Record<string, number>;
  }>;
}) {
  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-zinc-900">Send log</h2>
      <ul className="mt-3 space-y-3">
        {sendLog.map((send) => (
          <li key={send.id} className="rounded-lg border border-zinc-200 p-3">
            <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
              <span>{formatDateTime(send.createdAtIso)}</span>
              <span>·</span>
              <span>
                {send.totalRecipients} on list, {send.excludedOptOut} opted out,{' '}
                {send.excludedStaleConsent} stale
              </span>
            </div>
            <p className="mt-1 line-clamp-3 whitespace-pre-wrap text-sm text-zinc-800">
              {send.body}
            </p>
            <div className="mt-2 flex flex-wrap gap-2 text-xs text-zinc-600">
              {(['queued', 'sent', 'delivered', 'undelivered', 'failed'] as const).map((status) =>
                send.messageCounts[status] ? (
                  <span key={status} className="rounded-md bg-zinc-100 px-2 py-1">
                    {send.messageCounts[status]} {status}
                  </span>
                ) : null,
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
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

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}
