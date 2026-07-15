import 'server-only';

import { and, desc, eq, gt, inArray, isNotNull, isNull, ne, or, sql } from 'drizzle-orm';
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
// live threads, so each thread ships with its recent message list (no paging).

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
  /** 0110: purge-safe customer-name snapshot; null = lead with the phone. */
  displayName: string | null;
  lastMessageAt: Date;
  /** New inbound since a staff member last read/replied. */
  unread: boolean;
  /** 0110 turn-state: the customer's message is last — the ball is ours. */
  awaitingReply: boolean;
  /** The number STOPped — the thread is halted, reply is refused server-side. */
  optedOut: boolean;
  messages: ConversationMessage[];
};

// Turn-state from the denormalized last_* pair: an inbound bumps both stamps
// to the same instant (last_inbound_at == last_message_at), a staff reply
// bumps only last_message_at past it — so "customer spoke last" is >=.
function awaitingReply(row: {
  lastInboundAt: Date | null;
  lastMessageAt: Date;
}): boolean {
  return row.lastInboundAt != null && row.lastInboundAt >= row.lastMessageAt;
}

export async function loadCampaignConversations(
  campaignId: number,
): Promise<CampaignConversation[]> {
  const threads = await db
    .select({
      id: smsThreads.id,
      phone: smsThreads.phone,
      displayName: smsThreads.displayName,
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
    // 500 most-recent messages per campaign bounds a customer-spam blowup;
    // anything older simply drops off the console view.
    .orderBy(desc(smsThreadMessages.createdAt))
    .limit(500);
  messages.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

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
    displayName: t.displayName,
    lastMessageAt: t.lastMessageAt,
    unread:
      t.lastInboundAt != null &&
      (t.lastReadAt == null || t.lastInboundAt > t.lastReadAt),
    awaitingReply: awaitingReply(t),
    optedOut: optedOut.has(t.phone),
    messages: messages
      .filter((m) => m.threadId === t.id)
      .map((m) => ({
        id: m.id,
        direction: m.direction,
        body: m.body,
        status: m.status,
        errorCode: m.errorCode,
        aiDrafted: m.aiDrafted,
        createdAt: m.createdAt,
      })),
  }));
}

export type InboxThread = CampaignConversation & {
  campaignId: number;
  dealerName: string;
  startDate: string;
  endDate: string;
};

// Global inbox read model (0107): the campaign-scoped shape above minus the
// campaignId filter, joined to campaigns/dealers so each row carries its
// dealer/event context. Needs-action-first — unread threads sort above read
// ones, recency within each group.
export async function loadSmsInbox(): Promise<InboxThread[]> {
  const threads = await db
    .select({
      id: smsThreads.id,
      campaignId: smsThreads.campaignId,
      dealerName: dealers.name,
      startDate: campaigns.startDate,
      endDate: campaigns.endDate,
      phone: smsThreads.phone,
      displayName: smsThreads.displayName,
      lastMessageAt: smsThreads.lastMessageAt,
      lastInboundAt: smsThreads.lastInboundAt,
      lastReadAt: smsThreads.lastReadAt,
    })
    .from(smsThreads)
    .innerJoin(campaigns, eq(campaigns.id, smsThreads.campaignId))
    .innerJoin(dealers, eq(dealers.id, campaigns.dealerId))
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
    // 1000 most-recent messages app-wide bounds the aggregate view (vs 500
    // per campaign above); the oldest threads' transcripts drop off the inbox
    // but stay fully readable on their per-event page. Unread state is
    // thread-column-derived, so it can't be starved by this bound.
    .orderBy(desc(smsThreadMessages.createdAt))
    .limit(1000);
  messages.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

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

  const rows = threads.map((t) => ({
    id: t.id,
    campaignId: t.campaignId,
    dealerName: t.dealerName,
    startDate: t.startDate,
    endDate: t.endDate,
    phone: t.phone,
    displayName: t.displayName,
    lastMessageAt: t.lastMessageAt,
    unread:
      t.lastInboundAt != null &&
      (t.lastReadAt == null || t.lastInboundAt > t.lastReadAt),
    awaitingReply: awaitingReply(t),
    optedOut: optedOut.has(t.phone),
    messages: messages
      .filter((m) => m.threadId === t.id)
      .map((m) => ({
        id: m.id,
        direction: m.direction,
        body: m.body,
        status: m.status,
        errorCode: m.errorCode,
        aiDrafted: m.aiDrafted,
        createdAt: m.createdAt,
      })),
  }));
  // Stable sort: unread block first, recency (the DB order) within each block.
  return rows.sort((a, b) => Number(b.unread) - Number(a.unread));
}

// Badge count (0107): threads with inbound newer than the global read pointer.
// Matches the `unread` derivation above — one number, polled by the nav badge.
export async function loadInboxUnreadCount(): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(smsThreads)
    .where(
      or(
        and(isNotNull(smsThreads.lastInboundAt), isNull(smsThreads.lastReadAt)),
        gt(smsThreads.lastInboundAt, smsThreads.lastReadAt),
      ),
    );
  return row?.count ?? 0;
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
      // Bounds customer-controlled prompt size/cost.
      .orderBy(desc(smsThreadMessages.createdAt))
      .limit(30),
    db
      .select({ id: smsOptOuts.id })
      .from(smsOptOuts)
      .where(eq(smsOptOuts.phone, thread.phone))
      .limit(1),
  ]);

  return {
    ...thread,
    optedOut: Boolean(optOut),
    messages: messages.reverse().map((m) => ({ ...m, body: m.body.slice(0, 500) })),
  };
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
