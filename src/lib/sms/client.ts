import 'server-only';
import twilio, { Twilio } from 'twilio';

export type ClientResult =
  | { ok: true; client: Twilio; messagingServiceSid: string }
  | { error: string };

let cached: { client: Twilio; messagingServiceSid: string } | null = null;

// Sends address the Messaging Service, not a raw phone number — the sender
// (one Salesability-owned verified toll-free number, per the 0103 research
// spike) is attached to the service in the Twilio console, so it can be
// swapped/upgraded (e.g. to a short code) without a code change. Canada has
// no 10DLC registry; deliverability hangs on the toll-free number being
// verified, which is owner-driven provisioning (see
// docs/chunks/0103-sms-service/research.md).
export function client(): ClientResult {
  if (cached) return { ok: true, ...cached };

  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  if (!accountSid) return { error: 'TWILIO_ACCOUNT_SID is not set.' };

  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!authToken) return { error: 'TWILIO_AUTH_TOKEN is not set.' };

  const messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID;
  if (!messagingServiceSid) {
    return { error: 'TWILIO_MESSAGING_SERVICE_SID is not set.' };
  }

  cached = { client: twilio(accountSid, authToken), messagingServiceSid };
  return { ok: true, ...cached };
}

export function __resetForTests() {
  cached = null;
}
