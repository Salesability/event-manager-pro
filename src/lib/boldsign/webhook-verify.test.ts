import { describe, expect, it, vi } from 'vitest';
import { createHmac } from 'node:crypto';

vi.mock('server-only', () => ({}));

import { verifyWebhookSignature } from './webhook-verify';

const SECRET = 'test-secret-not-real';

function hmacOf(timestamp: string, body: string, secret = SECRET): string {
  return createHmac('sha256', secret)
    .update(`${timestamp}.${body}`)
    .digest('hex');
}

describe('verifyWebhookSignature', () => {
  const now = 1779724800;
  const tsHeader = String(now);
  const body = '{"event":{"eventType":"Signed"}}';

  it('returns ok for a correctly-computed s0 HMAC', () => {
    const sig = hmacOf(tsHeader, body);
    const header = `t=${tsHeader}, s0=${sig}`;
    expect(
      verifyWebhookSignature(body, header, SECRET, { nowSeconds: now }),
    ).toEqual({ ok: true });
  });

  it('returns ok when only s1 (rotated key) matches', () => {
    const sig = hmacOf(tsHeader, body);
    const stale = 'deadbeef' + '0'.repeat(56);
    const header = `t=${tsHeader}, s0=${stale}, s1=${sig}`;
    expect(
      verifyWebhookSignature(body, header, SECRET, { nowSeconds: now }),
    ).toEqual({ ok: true });
  });

  it('accepts header parts without spaces after commas', () => {
    const sig = hmacOf(tsHeader, body);
    const header = `t=${tsHeader},s0=${sig}`;
    expect(
      verifyWebhookSignature(body, header, SECRET, { nowSeconds: now }),
    ).toEqual({ ok: true });
  });

  it('returns error when the HMAC was computed with a different secret', () => {
    const sig = hmacOf(tsHeader, body, 'other');
    const header = `t=${tsHeader}, s0=${sig}`;
    expect(
      verifyWebhookSignature(body, header, SECRET, { nowSeconds: now }),
    ).toEqual({ error: 'Signature mismatch.' });
  });

  it('returns error when body is altered post-signing', () => {
    const sig = hmacOf(tsHeader, body);
    const header = `t=${tsHeader}, s0=${sig}`;
    expect(
      verifyWebhookSignature(
        '{"event":{"eventType":"Declined"}}',
        header,
        SECRET,
        { nowSeconds: now },
      ),
    ).toEqual({ error: 'Signature mismatch.' });
  });

  it('returns error when timestamp is outside tolerance window', () => {
    const sig = hmacOf(tsHeader, body);
    const header = `t=${tsHeader}, s0=${sig}`;
    expect(
      verifyWebhookSignature(body, header, SECRET, { nowSeconds: now + 600 }),
    ).toEqual({ error: 'Webhook timestamp outside tolerance window.' });
  });

  it('accepts a custom tolerance window', () => {
    const sig = hmacOf(tsHeader, body);
    const header = `t=${tsHeader}, s0=${sig}`;
    expect(
      verifyWebhookSignature(body, header, SECRET, {
        nowSeconds: now + 600,
        toleranceSeconds: 900,
      }),
    ).toEqual({ ok: true });
  });

  it('returns error when timestamp is non-numeric', () => {
    const header = `t=not-a-number, s0=abc`;
    expect(
      verifyWebhookSignature(body, header, SECRET, { nowSeconds: now }),
    ).toEqual({ error: 'Invalid timestamp in signature header.' });
  });

  it('returns error when header is missing', () => {
    expect(verifyWebhookSignature(body, null, SECRET)).toEqual({
      error: 'Missing X-BoldSign-Signature header.',
    });
  });

  it('returns error when secret is unset', () => {
    const sig = hmacOf(tsHeader, body);
    const header = `t=${tsHeader}, s0=${sig}`;
    expect(verifyWebhookSignature(body, header, '')).toEqual({
      error: 'BOLDSIGN_WEBHOOK_SECRET is not set.',
    });
  });

  it('returns error when header has no t= field', () => {
    const header = `s0=abc`;
    expect(
      verifyWebhookSignature(body, header, SECRET, { nowSeconds: now }),
    ).toEqual({ error: 'Malformed X-BoldSign-Signature header.' });
  });

  it('returns error when header has no s0/s1 fields', () => {
    const header = `t=${tsHeader}`;
    expect(
      verifyWebhookSignature(body, header, SECRET, { nowSeconds: now }),
    ).toEqual({ error: 'Malformed X-BoldSign-Signature header.' });
  });

  it('returns error on length-mismatched signature (short-circuits before timing compare)', () => {
    const sig = hmacOf(tsHeader, body).slice(0, 10);
    const header = `t=${tsHeader}, s0=${sig}`;
    expect(
      verifyWebhookSignature(body, header, SECRET, { nowSeconds: now }),
    ).toEqual({ error: 'Signature mismatch.' });
  });
});
