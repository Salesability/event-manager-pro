import { assertCan } from '@/lib/auth/assert-can';
import { PageHeader } from '@/components/app/page-header';
import { SmsInboxView } from '@/features/sms/conversations/inbox-view';
import {
  loadReassignCandidates,
  loadSmsInbox,
} from '@/features/sms/conversations/queries';

// Global SMS inbox (0107): every campaign's conversation threads in one
// master–detail surface, needs-action-first, so inbound replies (and soon,
// AI reply approvals) can't sit unseen behind a per-event page. Gated
// `sms:send` — admin-only today by the 0103 D4 capability mapping, and the
// admin-only posture is deliberate (intent.md): this page exposes every
// campaign's conversations, so if `sms:send` is ever widened to coaches the
// gate here gets its own review.
export default async function MessagesPage() {
  await assertCan('sms:send'); // expected: server-only

  const inbox = await loadSmsInbox();
  const threads = await Promise.all(
    inbox.map(async (t) => ({
      id: t.id,
      campaignId: t.campaignId,
      dealerName: t.dealerName,
      startDate: t.startDate,
      endDate: t.endDate,
      phone: t.phone,
      displayName: t.displayName,
      lastMessageAtIso: t.lastMessageAt.toISOString(),
      unread: t.unread,
      awaitingReply: t.awaitingReply,
      optedOut: t.optedOut,
      sentiment: t.sentiment,
      prospectTemperature: t.prospectTemperature,
      messages: t.messages.map((m) => ({
        id: m.id,
        direction: m.direction,
        body: m.body,
        status: m.status,
        errorCode: m.errorCode,
        aiDrafted: m.aiDrafted,
        createdAtIso: m.createdAt.toISOString(),
      })),
      reassignCandidates: await loadReassignCandidates(t.id),
    })),
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Messages"
        description="SMS conversations across every campaign — unread first."
      />
      <SmsInboxView threads={threads} />
    </div>
  );
}
