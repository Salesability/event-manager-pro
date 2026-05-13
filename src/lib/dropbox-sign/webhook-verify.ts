import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';

// Dropbox Sign webhook signature scheme: `event_hash` is HMAC-SHA256 over
// `event_time + event_type`, hex-encoded, with the account-level webhook
// secret (Open Question #8 → `DROPBOX_SIGN_WEBHOOK_SECRET`).
//
// Per their docs the signing key for account-level callbacks is the API key,
// but app-callbacks (the path 0041 takes) use a dedicated per-app secret.
// We treat the secret as opaque; rotate by changing the env var.
//
// Constant-time compare via `crypto.timingSafeEqual` so a timing oracle
// can't probe the hash byte-by-byte. The buffers are coerced to the same
// length before compare — a length mismatch returns false fast without
// throwing.

export type VerifyResult = { ok: true } | { error: string };

export function verifyWebhookSignature(
  eventTime: string,
  eventType: string,
  eventHash: string,
  secret: string,
): VerifyResult {
  if (!eventTime || !eventType || !eventHash) {
    return { error: 'Missing event_time, event_type, or event_hash.' };
  }
  if (!secret) {
    return { error: 'DROPBOX_SIGN_WEBHOOK_SECRET is not set.' };
  }

  const computed = createHmac('sha256', secret)
    .update(eventTime + eventType)
    .digest('hex');

  if (computed.length !== eventHash.length) {
    return { error: 'Signature mismatch.' };
  }
  const a = Buffer.from(computed, 'utf8');
  const b = Buffer.from(eventHash, 'utf8');
  if (!timingSafeEqual(a, b)) {
    return { error: 'Signature mismatch.' };
  }
  return { ok: true };
}
