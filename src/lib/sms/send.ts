import 'server-only';
import { client } from './client';

export type SendSmsInput = {
  /** Recipient in E.164 (e.g. +19025551234). */
  to: string;
  body: string;
  /** Twilio status-callback URL for per-message delivery tracking
   *  (queued → sent → delivered/failed lands at /api/twilio/webhook). */
  statusCallbackUrl?: string;
};

export type SendSmsResult = { ok: true; sid: string } | { error: string };

// Mirrors the Resend redirect doctrine in `src/lib/email/send.ts:34-58`
// applied to SMS: real-send to the caller-provided number requires explicit
// APP_ENV=production; any other environment redirects `to` to SMS_DEV_TO (a
// dev-owned phone number), or refuses the send if that env is unset — so a
// misconfigured deploy that forgets APP_ENV can never silently text a real
// customer. SMS gets its own env var (not EMAIL_DEV_TO) because the dev
// target is a phone number, not an inbox; the refuse-when-unset failsafe
// keeps the one-is-set-and-the-other-isn't foot-gun from leaking sends.
type RedirectDecision =
  | { redirect: true; to: string }
  | { redirect: false; reason: 'production' | 'no-dev-target' };

function decideRedirect(): RedirectDecision {
  // Normalise APP_ENV so `Production`, ` production`, etc. don't accidentally
  // fall through as non-production and silently redirect to a dev phone.
  const appEnv = process.env.APP_ENV?.trim().toLowerCase();
  if (appEnv === 'production') {
    return { redirect: false, reason: 'production' };
  }
  const devTo = process.env.SMS_DEV_TO?.trim();
  if (!devTo) {
    return { redirect: false, reason: 'no-dev-target' };
  }
  return { redirect: true, to: devTo };
}

export async function sendSms(input: SendSmsInput): Promise<SendSmsResult> {
  const c = client();
  if ('error' in c) return c;

  const decision = decideRedirect();
  if (!decision.redirect && decision.reason === 'no-dev-target') {
    return {
      error:
        'SMS send refused: APP_ENV is not "production" and SMS_DEV_TO is not set. Set SMS_DEV_TO to redirect, or APP_ENV=production to real-send.',
    };
  }

  let { to, body } = input;
  if (decision.redirect) {
    // SMS has no subject line — prefix the body so the dev phone can still
    // see who the message was meant for (analog of the [DEV→…] subject prefix).
    body = `[DEV→${to}] ${body}`;
    to = decision.to;
  }

  try {
    const message = await c.client.messages.create({
      to,
      body,
      messagingServiceSid: c.messagingServiceSid,
      ...(input.statusCallbackUrl ? { statusCallback: input.statusCallbackUrl } : {}),
    });
    if (!message?.sid) {
      return { error: 'Twilio returned no message sid.' };
    }
    return { ok: true, sid: message.sid };
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : 'SMS send failed.',
    };
  }
}
