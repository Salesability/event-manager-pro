import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';

// BoldSign webhook signature scheme (D #4 from 0051-dropbox-sign-to-boldsign,
// per https://developers.boldsign.com/webhooks/verify-webhook-events/):
//
//   X-BoldSign-Signature: t=<epoch>, s0=<hex-sig>[, s1=<old-key-hex-sig>]
//
// The signed payload is the literal string `<timestamp> + "." + <raw body>`;
// the HMAC-SHA256 of that payload (using the per-endpoint webhook secret)
// must match either `s0` (current key) or `s1` (old key still in rotation).
// The route handler must read the request body via `request.text()` and
// pass the raw bytes here BEFORE calling JSON.parse — parse-then-reserialize
// would break the HMAC.
//
// Replay protection: `t` is the event-generation epoch (seconds). We refuse
// events whose timestamp is more than `toleranceSeconds` from the current
// epoch (default 300s, mirroring industry convention).
//
// Constant-time compare via `crypto.timingSafeEqual` so a timing oracle
// can't probe the hash byte-by-byte.

export type VerifyResult = { ok: true } | { error: string };

const DEFAULT_TOLERANCE_SECONDS = 300;

type ParsedHeader = {
  timestamp: string;
  signatures: string[];
};

function parseSignatureHeader(
  header: string,
): ParsedHeader | { error: string } {
  const parts = header.split(',').map((s) => s.trim());
  let timestamp: string | null = null;
  const signatures: string[] = [];
  for (const part of parts) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (key === 't') timestamp = value;
    else if (key === 's0' || key === 's1') signatures.push(value);
  }
  if (!timestamp || signatures.length === 0) {
    return { error: 'Malformed X-BoldSign-Signature header.' };
  }
  return { timestamp, signatures };
}

function constantTimeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
}

export function verifyWebhookSignature(
  rawBody: string,
  signatureHeader: string | null,
  secret: string,
  options?: { toleranceSeconds?: number; nowSeconds?: number },
): VerifyResult {
  if (!signatureHeader) {
    return { error: 'Missing X-BoldSign-Signature header.' };
  }
  if (!secret) {
    return { error: 'BOLDSIGN_WEBHOOK_SECRET is not set.' };
  }

  const parsed = parseSignatureHeader(signatureHeader);
  if ('error' in parsed) return parsed;

  const tolerance = options?.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS;
  const now = options?.nowSeconds ?? Math.floor(Date.now() / 1000);
  const eventTs = Number(parsed.timestamp);
  if (!Number.isFinite(eventTs)) {
    return { error: 'Invalid timestamp in signature header.' };
  }
  if (Math.abs(now - eventTs) > tolerance) {
    return { error: 'Webhook timestamp outside tolerance window.' };
  }

  const signedPayload = `${parsed.timestamp}.${rawBody}`;
  const computed = createHmac('sha256', secret)
    .update(signedPayload, 'utf8')
    .digest('hex');

  for (const candidate of parsed.signatures) {
    if (constantTimeEquals(computed, candidate)) {
      return { ok: true };
    }
  }
  return { error: 'Signature mismatch.' };
}
