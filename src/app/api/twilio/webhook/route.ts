import { NextResponse, type NextRequest } from 'next/server';
import { and, eq, inArray } from 'drizzle-orm';
import { db } from '@/lib/db';
import { smsMessages, smsOptOuts, smsThreadMessages } from '@/lib/db/schema';
import {
  captureInboundMessage,
  captureInboundStop,
  classifyThreadFromInbound,
} from '@/lib/sms/conversations';
import {
  classifyTwilioWebhook,
  isStopMessage,
  STATUS_RANK,
  type LedgerStatus,
} from '@/lib/sms/webhook-events';
import { verifyTwilioSignature } from '@/lib/sms/webhook-verify';

// authz: public — Twilio's webhook caller has no auth.users session. Gate is
// X-Twilio-Signature verification (base64 HMAC-SHA1 keyed on the account auth
// token), performed BEFORE any DB read or mutation — same posture as
// `/api/boldsign/webhook` (the external-caller exception to "mutations go
// through Server Actions").
//
// Twilio POSTs `application/x-www-form-urlencoded`. Two shapes land here:
//   • Message status callbacks (statusCallback on messages.create):
//     MessageSid + MessageStatus [+ ErrorCode] → flip the sms_messages ledger
//     row, monotonically (out-of-order callbacks never regress a status).
//   • Inbound messages to our number (Messaging Service inbound URL):
//     From + Body → STOP capture into the permanent opt-out registry; any
//     other inbound persists as a conversation-thread message (0106) when the
//     number has campaign history to attribute it to, else acked and ignored.
//
// The signature base URL is built from SITE_URL (operator-configured origin)
// + this route's path — never the request Host header, which a proxy-level
// attacker could spoof to move the signature base. This means the Twilio
// console/statusCallback MUST address the webhook via SITE_URL's host.
//
// Twilio expects a 2xx ack; signature failures 401 (Twilio alerts on
// persistent failures in the console debugger).

const WEBHOOK_PATH = '/api/twilio/webhook';

// authz: public — Twilio's webhook caller has no auth.users session; the gate
// is X-Twilio-Signature HMAC verification on the form params, performed
// before any DB read or mutation.
export async function POST(request: NextRequest): Promise<NextResponse> {
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!authToken) {
    return new NextResponse('Server misconfigured.', { status: 500 });
  }
  const origin = process.env.SITE_URL?.trim().replace(/\/$/, '');
  if (!origin) {
    return new NextResponse('Server misconfigured.', { status: 500 });
  }

  let rawBody: string;
  try {
    rawBody = await request.text();
  } catch (err) {
    return new NextResponse(
      err instanceof Error ? err.message : 'Failed to read body.',
      { status: 400 },
    );
  }
  const params = Object.fromEntries(new URLSearchParams(rawBody));

  const verifyResult = verifyTwilioSignature({
    url: `${origin}${WEBHOOK_PATH}`,
    params,
    signatureHeader: request.headers.get('x-twilio-signature'),
    authToken,
  });
  if ('error' in verifyResult) {
    return new NextResponse(verifyResult.error, { status: 401 });
  }

  const event = classifyTwilioWebhook(params);

  if (event.kind === 'status') {
    return handleStatusCallback(event.messageSid, event.status, event.errorCode);
  }
  if (event.kind === 'inbound') {
    return handleInbound(event.from, event.body, event.messageSid);
  }
  // Unrecognized-but-authentic payloads: ack so Twilio doesn't retry-spin.
  return new NextResponse(`OK (${event.reason}).`, { status: 200 });
}

async function handleStatusCallback(
  messageSid: string,
  status: LedgerStatus,
  errorCode: string | null,
): Promise<NextResponse> {
  // Monotonic flip in one guarded UPDATE: only move forward in rank (the
  // rank CASE mirrors STATUS_RANK — keep them in lock-step). A same-rank
  // terminal never overwrites another terminal (first one sticks).
  const eligibleCurrent = (
    Object.entries(STATUS_RANK) as Array<[LedgerStatus, number]>
  )
    .filter(([, rank]) => rank < STATUS_RANK[status])
    .map(([s]) => s);

  // A `queued` callback (rank 0) can never move a row forward — rows are born
  // queued. Ack without touching the DB (also keeps inArray non-empty below).
  if (!eligibleCurrent.length) {
    return new NextResponse('OK (no forward transition).', { status: 200 });
  }

  const updated = await db
    .update(smsMessages)
    .set({
      status,
      errorCode,
      statusUpdatedAt: new Date(),
    })
    .where(
      and(
        eq(smsMessages.providerSid, messageSid),
        inArray(smsMessages.status, eligibleCurrent),
      ),
    )
    .returning({ id: smsMessages.id });

  if (updated.length) return new NextResponse('OK', { status: 200 });

  // A callback sid can also belong to a conversation-thread reply (0106) —
  // same monotonic flip on that ledger.
  const updatedReply = await db
    .update(smsThreadMessages)
    .set({
      status,
      errorCode,
      statusUpdatedAt: new Date(),
    })
    .where(
      and(
        eq(smsThreadMessages.providerSid, messageSid),
        inArray(smsThreadMessages.status, eligibleCurrent),
      ),
    )
    .returning({ id: smsThreadMessages.id });
  if (updatedReply.length) return new NextResponse('OK', { status: 200 });

  // Either the sid is unknown (404 — lets Twilio retry a callback that raced
  // our post-dispatch provider_sid write) or the row is already at/past this
  // rank (200 — replay/out-of-order, nothing to do).
  const [existing] = await db
    .select({ id: smsMessages.id })
    .from(smsMessages)
    .where(eq(smsMessages.providerSid, messageSid))
    .limit(1);
  if (existing) {
    return new NextResponse('OK (no forward transition).', { status: 200 });
  }
  const [existingReply] = await db
    .select({ id: smsThreadMessages.id })
    .from(smsThreadMessages)
    .where(eq(smsThreadMessages.providerSid, messageSid))
    .limit(1);
  if (existingReply) {
    return new NextResponse('OK (no forward transition).', { status: 200 });
  }
  return new NextResponse('Message not found for the supplied sid.', { status: 404 });
}

async function handleInbound(
  from: string,
  body: string,
  messageSid: string | null,
): Promise<NextResponse> {
  if (!isStopMessage(body)) {
    // 0106: non-STOP inbound persists as a conversation-thread message,
    // attributed to the campaign that most recently texted the number. A
    // number with no campaign history stays ack-and-ignore.
    const captured = await captureInboundMessage({ from, body, messageSid });
    if (!captured) {
      return new NextResponse('OK (inbound ignored).', { status: 200 });
    }
    // 0110: display-only sentiment/temperature stamp, post-commit (owner-
    // blessed autonomous call, decision.md D1). Best-effort — the classifier
    // has its own tight timeout and every failure path is swallowed; the
    // inbound is already persisted, so Twilio gets its 200 regardless.
    try {
      await classifyThreadFromInbound(captured.threadId);
    } catch {
      // Never fail the webhook over a display-only label.
    }
    return new NextResponse('OK', { status: 200 });
  }

  // Permanent + idempotent: a repeat STOP (or a replayed webhook) is a no-op.
  // `from` arrives E.164 from Twilio; the CHECK constraint guards the rest.
  await db
    .insert(smsOptOuts)
    .values({
      phone: from,
      source: 'stop_reply',
      providerMessageSid: messageSid,
    })
    .onConflictDoNothing({ target: smsOptOuts.phone });

  // The opt-out registry above is the enforcement record; if the number has
  // an active thread, also append the STOP there so the console shows why
  // the conversation halted. Never creates a thread.
  await captureInboundStop({ from, body, messageSid });

  return new NextResponse('OK', { status: 200 });
}
