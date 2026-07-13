import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';

// Twilio webhook signature scheme (structural cousin of
// `src/lib/boldsign/webhook-verify.ts`, but the crypto differs — per
// https://www.twilio.com/docs/usage/security#validating-requests):
//
//   X-Twilio-Signature: <base64 HMAC-SHA1>
//
// The signed payload is the FULL request URL (exactly as Twilio addressed it)
// concatenated with every POST form parameter as `<key><value>`, keys sorted
// alphabetically, no separators. The HMAC key is the account auth token.
//
// NB vs BoldSign: no timestamp component → no replay-tolerance window to
// enforce (Twilio's scheme simply doesn't carry one); a captured request
// could be replayed, but both handlers downstream are idempotent (status
// flips are monotonic, opt-out insert is ON CONFLICT DO NOTHING), so a
// replay is a no-op. The route builds the URL from the operator-configured
// SITE_URL, never the request Host header, so a spoofed Host can't move the
// signature base.
//
// Constant-time compare via `crypto.timingSafeEqual` so a timing oracle
// can't probe the signature byte-by-byte.

export type VerifyResult = { ok: true } | { error: string };

export function computeTwilioSignature(
  authToken: string,
  url: string,
  params: Record<string, string>,
): string {
  const data =
    url +
    Object.keys(params)
      .sort()
      .map((key) => key + params[key])
      .join('');
  return createHmac('sha1', authToken).update(data, 'utf8').digest('base64');
}

export function verifyTwilioSignature(input: {
  url: string;
  params: Record<string, string>;
  signatureHeader: string | null;
  authToken: string;
}): VerifyResult {
  if (!input.signatureHeader) {
    return { error: 'Missing X-Twilio-Signature header.' };
  }
  if (!input.authToken) {
    return { error: 'TWILIO_AUTH_TOKEN is not set.' };
  }

  const expected = computeTwilioSignature(input.authToken, input.url, input.params);
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(input.signatureHeader, 'utf8');
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { error: 'Signature mismatch.' };
  }
  return { ok: true };
}
