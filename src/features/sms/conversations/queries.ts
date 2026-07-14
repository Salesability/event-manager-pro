import 'server-only';

import { and, asc, desc, eq, inArray, ne } from 'drizzle-orm';
import { db } from '@/lib/db';
import {
  campaigns,
  dealers,
  smsMessages,
  smsOptOuts,
  smsSends,
  smsThreadMessages,
  smsThreads,
} from '@/lib/db/schema';

// Read model for the per-campaign conversation console (0106 Phase 3).
// Campaign-scoped like `loadSmsSendLog` — a campaign has at most a handful of
// live threads, so each thread ships with its full message list (no paging).

export type ConversationMessage = {
  id: number;
  direction: 'inbound' | 'outbound';
  body: string;
  status: string | null;
  errorCode: string | null;
  aiDrafted: boolean;
  createdAt: Date;
};

export type CampaignConversation = {
  id: number;
  phone: string;
  lastMessageAt: Date;
  /** New inbound since a staff member last read/replied. */
  unread: boolean;
  /** The number STOPped — the thread is halted, reply is refused server-side. */
  optedOut: boolean;
  messages: ConversationMessage[];
};

export async function loadCampaignConversations(
  campaignId: number,
): Promise<CampaignConversation[]> {
  const threads = await db
    .select({
      id: smsThreads.id,
      phone: smsThreads.phone,
      lastMessageAt: smsThreads.lastMessageAt,
      lastInboundAt: smsThreads.lastInboundAt,
      lastReadAt: smsThreads.lastReadAt,
    })
    .from(smsThreads)
    .where(eq(smsThreads.campaignId, campaignId))
    .orderBy(desc(smsThreads.lastMessageAt));
  if (!threads.length) return [];

  const messages = await db
    .select({
      id: smsThreadMessages.id,
      threadId: smsThreadMessages.threadId,
      direction: smsThreadMessages.direction,
      body: smsThreadMessages.body,
      status: smsThreadMessages.status,
      errorCode: smsThreadMessages.errorCode,
      aiDrafted: smsThreadMessages.aiDrafted,
      createdAt: smsThreadMessages.createdAt,
    })
    .from(smsThreadMessages)
    .where(
      inArray(
        smsThreadMessages.threadId,
        threads.map((t) => t.id),
      ),
    )
    .orderBy(asc(smsThreadMessages.createdAt));

  const optedOut = new Set<string>();
  const optOutRows = await db
    .select({ phone: smsOptOuts.phone })
    .from(smsOptOuts)
    .where(
      inArray(
        smsOptOuts.phone,
        threads.map((t) => t.phone),
      ),
    );
  for (const r of optOutRows) optedOut.add(r.phone);

  return threads.map((t) => ({
    id: t.id,
    phone: t.phone,
    lastMessageAt: t.lastMessageAt,
    unread:
      t.lastInboundAt != null &&
      (t.lastReadAt == null || t.lastInboundAt > t.lastReadAt),
    optedOut: optedOut.has(t.phone),
    messages: messages
      .filter((m) => m.threadId === t.id)
      .map(({ threadId: _threadId, ...m }) => m),
  }));
}

export type ThreadDraftContext = {
  threadId: number;
  phone: string;
  dealerName: string;
  startDate: string;
  endDate: string;
  optedOut: boolean;
  messages: Array<{ direction: 'inbound' | 'outbound'; body: string }>;
};

// Everything the AI draft needs (0106 Phase 4): the campaign facts the prompt
// is constrained to (dealer name + event dates) plus the transcript, and the
// opt-out flag so a halted thread is refused before any model call.
export async function loadThreadDraftContext(
  threadId: number,
): Promise<ThreadDraftContext | null> {
  const [thread] = await db
    .select({
      threadId: smsThreads.id,
      phone: smsThreads.phone,
      dealerName: dealers.name,
      startDate: campaigns.startDate,
      endDate: campaigns.endDate,
    })
    .from(smsThreads)
    .innerJoin(campaigns, eq(campaigns.id, smsThreads.campaignId))
    .innerJoin(dealers, eq(dealers.id, campaigns.dealerId))
    .where(eq(smsThreads.id, threadId))
    .limit(1);
  if (!thread) return null;

  const [messages, [optOut]] = await Promise.all([
    db
      .select({
        direction: smsThreadMessages.direction,
        body: smsThreadMessages.body,
      })
      .from(smsThreadMessages)
      .where(eq(smsThreadMessages.threadId, threadId))
      .orderBy(asc(smsThreadMessages.createdAt)),
    db
      .select({ id: smsOptOuts.id })
      .from(smsOptOuts)
      .where(eq(smsOptOuts.phone, thread.phone))
      .limit(1),
  ]);

  return { ...thread, optedOut: Boolean(optOut), messages };
}

export type ReassignCandidate = {
  campaignId: number;
  dealerName: string;
  startDate: string;
};

// D2 reassign targets for a thread: the other campaigns whose launches have
// texted this number (attribution can only ever be wrong between campaigns
// that actually share the phone, so that's the whole candidate set).
export async function loadReassignCandidates(
  threadId: number,
): Promise<ReassignCandidate[]> {
  const [thread] = await db
    .select({ phone: smsThreads.phone, campaignId: smsThreads.campaignId })
    .from(smsThreads)
    .where(eq(smsThreads.id, threadId))
    .limit(1);
  if (!thread) return [];

  const rows = await db
    .selectDistinct({
      campaignId: campaigns.id,
      dealerName: dealers.name,
      startDate: campaigns.startDate,
    })
    .from(smsMessages)
    .innerJoin(smsSends, eq(smsSends.id, smsMessages.sendId))
    .innerJoin(campaigns, eq(campaigns.id, smsSends.campaignId))
    .innerJoin(dealers, eq(dealers.id, campaigns.dealerId))
    .where(
      and(
        eq(smsMessages.phone, thread.phone),
        ne(campaigns.id, thread.campaignId),
      ),
    )
    .orderBy(desc(campaigns.startDate));
  return rows;
}
