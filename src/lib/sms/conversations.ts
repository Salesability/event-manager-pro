import 'server-only';

import { and, desc, eq } from 'drizzle-orm';
import { classifySmsThread } from '@/lib/ai/classify-sms-thread';
import { db } from '@/lib/db';
import {
  smsMessages,
  smsOptOuts,
  smsRecipients,
  smsSends,
  smsThreadMessages,
  smsThreads,
} from '@/lib/db/schema';
import { sendSms } from '@/lib/sms/send';

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

// 0110: purge-safe name snapshot. Resolve "First Last" from the campaign's
// recipient row at stamp time — thread creation below, and reassign (the
// other campaign's list may name the number differently). Null when the
// number isn't on that campaign's list; callers keep any prior snapshot then.
export async function lookupThreadDisplayName(
  campaignId: number,
  phone: string,
  exec: Executor = db,
): Promise<string | null> {
  const [recipient] = await exec
    .select({
      firstName: smsRecipients.firstName,
      lastName: smsRecipients.lastName,
    })
    .from(smsRecipients)
    .where(
      and(eq(smsRecipients.campaignId, campaignId), eq(smsRecipients.phone, phone)),
    )
    .limit(1);
  if (!recipient) return null;
  const name = [recipient.firstName, recipient.lastName]
    .filter((part) => part && part.trim())
    .join(' ')
    .trim();
  return name || null;
}

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
  const displayName = await lookupThreadDisplayName(
    latestLaunch.campaignId,
    phone,
    exec,
  );
  const [created] = await exec
    .insert(smsThreads)
    .values({ campaignId: latestLaunch.campaignId, phone, displayName })
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
  const captured = await appendInbound(threadId, input.body, input.messageSid, exec);
  // 0110: STOP always wins — a halted thread must not keep wearing a stale
  // "hot prospect" label (the classifier only runs on non-STOP inbounds).
  // Clearing returns the thread to unclassified; idempotent on replays.
  await exec
    .update(smsThreads)
    .set({ sentiment: null, prospectTemperature: null, classifiedAt: null })
    .where(eq(smsThreads.id, threadId));
  return captured;
}

// 0110 display-only classification (decision.md D1 — owner-blessed autonomous
// call). Best-effort by contract: every failure path (no key, timeout,
// refusal, malformed output) returns without touching the thread — the
// caller (the webhook) must never fail because of this. Same transcript
// bounds as `loadThreadDraftContext` (30 messages × 500 chars).
export async function classifyThreadFromInbound(
  threadId: number,
  exec: Executor = db,
): Promise<void> {
  // Cheap pre-check so keyless environments skip the transcript read too.
  if (!process.env.ANTHROPIC_API_KEY) return;

  const recent = await exec
    .select({
      direction: smsThreadMessages.direction,
      body: smsThreadMessages.body,
    })
    .from(smsThreadMessages)
    .where(eq(smsThreadMessages.threadId, threadId))
    .orderBy(desc(smsThreadMessages.createdAt))
    .limit(30);
  if (!recent.some((m) => m.direction === 'inbound')) return;

  const result = await classifySmsThread({
    conversation: recent
      .reverse()
      .map((m) => ({ direction: m.direction, body: m.body.slice(0, 500) })),
  });
  if ('error' in result) return;

  await exec
    .update(smsThreads)
    .set({
      sentiment: result.classification.sentiment,
      prospectTemperature: result.classification.temperature,
      classifiedAt: new Date(),
    })
    .where(eq(smsThreads.id, threadId));
}

export type ThreadReplyResult =
  | { ok: true; messageId: number }
  | { error: string };

// Staff (or approved-AI-draft) reply into a thread (0106 Phase 3). Persist-
// first like `launchSmsSend`: the outbound row exists as `queued` BEFORE the
// Twilio call, then the accept stamps `provider_sid` (status callbacks flip it
// from there) or the failure stamps `failed` + the error — either way the
// conversation shows what was attempted. The opt-out recheck runs immediately
// before dispatch: STOP always wins, human or AI, no exceptions. Replies are
// responses to a customer-initiated inbound (not CEM blasts), so no STOP
// footer and no booked/add-on gate — a customer who replies after the event
// completes still gets answered. Delivery redirects via `sendSms`'s doctrine
// (non-prod → SMS_DEV_TO or refuse).
export async function sendThreadReply(
  input: { threadId: number; body: string; userId: string; aiDrafted?: boolean },
  exec: Executor = db,
): Promise<ThreadReplyResult> {
  const [thread] = await exec
    .select({ id: smsThreads.id, phone: smsThreads.phone })
    .from(smsThreads)
    .where(eq(smsThreads.id, input.threadId))
    .limit(1);
  if (!thread) return { error: 'Conversation not found.' };

  const [optOut] = await exec
    .select({ id: smsOptOuts.id })
    .from(smsOptOuts)
    .where(eq(smsOptOuts.phone, thread.phone))
    .limit(1);
  if (optOut) {
    return {
      error:
        'This number has opted out (STOP) — no further messages can be sent to it.',
    };
  }

  const [message] = await exec
    .insert(smsThreadMessages)
    .values({
      threadId: thread.id,
      direction: 'outbound',
      body: input.body,
      status: 'queued',
      aiDrafted: input.aiDrafted ?? false,
      createdById: input.userId,
      updatedById: input.userId,
    })
    .returning({ id: smsThreadMessages.id });

  // Same status-callback posture as `launchSmsSend`: only attach on a public
  // https SITE_URL (Twilio 21609-rejects localhost/plain-http callbacks).
  const origin = process.env.SITE_URL?.trim().replace(/\/$/, '');
  const statusCallbackUrl = origin?.startsWith('https://')
    ? `${origin}/api/twilio/webhook`
    : undefined;

  const result = await sendSms({
    to: thread.phone,
    body: input.body,
    statusCallbackUrl,
  });
  if ('ok' in result) {
    await exec
      .update(smsThreadMessages)
      .set({ providerSid: result.sid })
      .where(eq(smsThreadMessages.id, message.id));
  } else {
    await exec
      .update(smsThreadMessages)
      .set({ status: 'failed', errorCode: result.error, statusUpdatedAt: new Date() })
      .where(eq(smsThreadMessages.id, message.id));
  }

  // Replying implies the staff member read the thread — clear the unread
  // marker along with the activity bump.
  const now = new Date();
  await exec
    .update(smsThreads)
    .set({ lastMessageAt: now, lastReadAt: now, updatedById: input.userId })
    .where(eq(smsThreads.id, thread.id));

  if ('ok' in result) return { ok: true, messageId: message.id };
  return { error: `SMS send failed: ${result.error}` };
}
