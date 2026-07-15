// Pure classification + mapping for Twilio webhook payloads (0103 Phase 4).
// No DB, no env — the route handler stays a thin verified shell and these
// rules get unit-tested directly.

import type { smsMessageStatus } from '@/lib/db/schema';

export type LedgerStatus = (typeof smsMessageStatus.enumValues)[number];

export type TwilioWebhookEvent =
  | { kind: 'status'; messageSid: string; status: LedgerStatus; errorCode: string | null }
  | { kind: 'inbound'; messageSid: string | null; from: string; body: string }
  | { kind: 'ignored'; reason: string };

// Twilio message statuses collapse onto the ledger enum: the pre-carrier
// states (accepted/queued/sending/scheduled) all read as `queued`; `receiving/
// received/read` never apply to outbound; anything unknown is ignored rather
// than guessed.
const STATUS_MAP: Record<string, LedgerStatus> = {
  accepted: 'queued',
  scheduled: 'queued',
  queued: 'queued',
  sending: 'queued',
  sent: 'sent',
  delivered: 'delivered',
  undelivered: 'undelivered',
  failed: 'failed',
};

// Callbacks can land out of order (`delivered` racing `sent`). Rank makes the
// flip monotonic: a lower-or-equal-ranked callback never regresses the row.
// The three terminal states share a rank — whichever lands first sticks.
export const STATUS_RANK: Record<LedgerStatus, number> = {
  queued: 0,
  sent: 1,
  delivered: 2,
  undelivered: 2,
  failed: 2,
};

// CTIA/Twilio standard opt-out keywords; the keyword must be (essentially)
// the whole message — "please stop calling me about stops" is not an opt-out,
// "STOP." / " stop " is.
const STOP_KEYWORDS = /^\s*(stop|stopall|unsubscribe|cancel|end|quit)\s*[.!]*\s*$/i;

export function isStopMessage(body: string): boolean {
  return STOP_KEYWORDS.test(body);
}

export function classifyTwilioWebhook(
  params: Record<string, string>,
): TwilioWebhookEvent {
  // Status callback: carries MessageStatus (inbound messages don't).
  const messageStatus = params.MessageStatus;
  if (messageStatus) {
    const sid = params.MessageSid || params.SmsSid;
    if (!sid) return { kind: 'ignored', reason: 'status callback without MessageSid' };
    const status = STATUS_MAP[messageStatus.toLowerCase()];
    if (!status) {
      return { kind: 'ignored', reason: `unknown MessageStatus '${messageStatus}'` };
    }
    return {
      kind: 'status',
      messageSid: sid,
      status,
      errorCode: params.ErrorCode || null,
    };
  }

  // Inbound message to our number (SmsStatus=received): STOP capture into the
  // opt-out registry, everything else into the conversation console (0106).
  if (params.SmsStatus?.toLowerCase() === 'received' || (params.From && 'Body' in params)) {
    if (!params.From) return { kind: 'ignored', reason: 'inbound without From' };
    return {
      kind: 'inbound',
      messageSid: params.MessageSid || params.SmsSid || null,
      from: params.From,
      body: params.Body ?? '',
    };
  }

  return { kind: 'ignored', reason: 'unrecognized webhook shape' };
}
