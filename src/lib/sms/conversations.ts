import 'server-only';

import { and, desc, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import {
  smsMessages,
  smsSends,
  smsThreadMessages,
  smsThreads,
} from '@/lib/db/schema';

// Inbound conversation capture (0106 Phase 2). Attribution rule (D2): an
// inbound joins the phone's most recent conversation activity — the latest of
// (a) the phone's most-recently-active existing thread (`last_message_at`,
// which staff replies bump, so an ongoing or reassigned conversation keeps
// winning) and (b) the latest campaign launch send to that number
// (`sms_messages`), which creates/revives the (campaign, phone) thread. A
// number nothing ever texted has no attribution — the webhook acks and
// ignores it, same as pre-0106.

type Database = typeof db;
type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
type Executor = Database | Transaction;

export type CapturedInbound = { threadId: number; messageId: number };

// Find the thread this phone's next inbound belongs to. `existingOnly` is the
// STOP posture: a bare STOP never *creates* a thread (the opt-out registry is
// the enforcement record; the thread row is just conversation evidence).
async function resolveThread(
  phone: string,
  existingOnly: boolean,
  exec: Executor,
): Promise<number | null> {
  const [latestThread] = await exec
    .select({
      id: smsThreads.id,
      lastMessageAt: smsThreads.lastMessageAt,
    })
    .from(smsThreads)
    .where(eq(smsThreads.phone, phone))
    .orderBy(desc(smsThreads.lastMessageAt))
    .limit(1);

  if (existingOnly) return latestThread?.id ?? null;

  const [latestLaunch] = await exec
    .select({
      campaignId: smsSends.campaignId,
      createdAt: smsMessages.createdAt,
    })
    .from(smsMessages)
    .innerJoin(smsSends, eq(smsSends.id, smsMessages.sendId))
    .where(eq(smsMessages.phone, phone))
    .orderBy(desc(smsMessages.createdAt))
    .limit(1);

  if (
    latestThread &&
    (!latestLaunch || latestThread.lastMessageAt >= latestLaunch.createdAt)
  ) {
    return latestThread.id;
  }
  if (!latestLaunch) return null;

  // Find-or-create the (campaign, phone) thread. Insert-first with
  // onConflictDoNothing so two racing inbounds can't double-create against
  // the unique (campaign_id, phone) index; the loser falls through to select.
  const [created] = await exec
    .insert(smsThreads)
    .values({ campaignId: latestLaunch.campaignId, phone })
    .onConflictDoNothing()
    .returning({ id: smsThreads.id });
  if (created) return created.id;
  const [existing] = await exec
    .select({ id: smsThreads.id })
    .from(smsThreads)
    .where(
      and(
        eq(smsThreads.campaignId, latestLaunch.campaignId),
        eq(smsThreads.phone, phone),
      ),
    )
    .limit(1);
  return existing?.id ?? null;
}

async function appendInbound(
  threadId: number,
  body: string,
  messageSid: string | null,
  exec: Executor,
): Promise<CapturedInbound | null> {
  // Idempotent on the provider sid (partial unique) — a replayed webhook
  // inserts nothing and must NOT re-bump the thread's unread markers.
  const [inserted] = await exec
    .insert(smsThreadMessages)
    .values({
      threadId,
      direction: 'inbound',
      body,
      providerSid: messageSid,
    })
    .onConflictDoNothing()
    .returning({ id: smsThreadMessages.id });
  if (!inserted) return null;

  const now = new Date();
  await exec
    .update(smsThreads)
    .set({ lastMessageAt: now, lastInboundAt: now })
    .where(eq(smsThreads.id, threadId));

  return { threadId, messageId: inserted.id };
}

// Non-STOP inbound → persisted thread message. Null when the number has no
// campaign history to attribute to (ack-and-ignore) or the sid is a replay.
export async function captureInboundMessage(
  input: { from: string; body: string; messageSid: string | null },
  exec: Executor = db,
): Promise<CapturedInbound | null> {
  const threadId = await resolveThread(input.from, false, exec);
  if (threadId === null) return null;
  return appendInbound(threadId, input.body, input.messageSid, exec);
}

// STOP inbound → appended to the phone's most recent thread as conversation
// evidence, if one exists. Never creates a thread; the permanent opt-out row
// (written by the caller) is the compliance record either way.
export async function captureInboundStop(
  input: { from: string; body: string; messageSid: string | null },
  exec: Executor = db,
): Promise<CapturedInbound | null> {
  const threadId = await resolveThread(input.from, true, exec);
  if (threadId === null) return null;
  return appendInbound(threadId, input.body, input.messageSid, exec);
}
