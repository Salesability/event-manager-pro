import { describe, expect, it, vi } from 'vitest';
import { createHmac } from 'node:crypto';

vi.mock('server-only', () => ({}));

import { verifyWebhookSignature } from './webhook-verify';

const SECRET = 'test-secret-not-real';

function hmacOf(eventTime: string, eventType: string, secret = SECRET): string {
  return createHmac('sha256', secret)
    .update(eventTime + eventType)
    .digest('hex');
}

describe('verifyWebhookSignature', () => {
  it('returns ok for a correctly-computed HMAC', () => {
    const t = '1779724800';
    const e = 'signature_request_all_signed';
    expect(verifyWebhookSignature(t, e, hmacOf(t, e), SECRET)).toEqual({
      ok: true,
    });
  });

  it('returns error when the HMAC was computed with a different secret', () => {
    const t = '1779724800';
    const e = 'signature_request_all_signed';
    const result = verifyWebhookSignature(t, e, hmacOf(t, e, 'other'), SECRET);
    expect(result).toEqual({ error: 'Signature mismatch.' });
  });

  it('returns error when event_type is altered post-signing', () => {
    const t = '1779724800';
    const sig = hmacOf(t, 'signature_request_all_signed');
    const result = verifyWebhookSignature(
      t,
      'signature_request_declined', // attacker swaps event type
      sig,
      SECRET,
    );
    expect(result).toEqual({ error: 'Signature mismatch.' });
  });

  it('returns error when event_time is altered post-signing', () => {
    const original = hmacOf('1779724800', 'signature_request_all_signed');
    const result = verifyWebhookSignature(
      '0', // replay-style time tampering
      'signature_request_all_signed',
      original,
      SECRET,
    );
    expect(result).toEqual({ error: 'Signature mismatch.' });
  });

  it('returns error when any field is empty', () => {
    expect(verifyWebhookSignature('', 't', 'h', SECRET)).toEqual({
      error: 'Missing event_time, event_type, or event_hash.',
    });
    expect(verifyWebhookSignature('1', '', 'h', SECRET)).toEqual({
      error: 'Missing event_time, event_type, or event_hash.',
    });
    expect(verifyWebhookSignature('1', 't', '', SECRET)).toEqual({
      error: 'Missing event_time, event_type, or event_hash.',
    });
  });

  it('returns error when secret is unset', () => {
    expect(verifyWebhookSignature('1', 't', 'h', '')).toEqual({
      error: 'DROPBOX_SIGN_WEBHOOK_SECRET is not set.',
    });
  });

  it('returns error on length-mismatched hash (short-circuits before timing compare)', () => {
    const t = '1779724800';
    const e = 'signature_request_all_signed';
    const truncated = hmacOf(t, e).slice(0, 10);
    expect(verifyWebhookSignature(t, e, truncated, SECRET)).toEqual({
      error: 'Signature mismatch.',
    });
  });
});
