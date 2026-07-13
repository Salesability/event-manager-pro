import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { computeTwilioSignature, verifyTwilioSignature } from './webhook-verify';

const AUTH_TOKEN = 'test_auth_token_123';
const URL = 'https://app.example.test/api/twilio/webhook';

// Independent re-derivation of Twilio's documented scheme so the test doesn't
// just assert the implementation against itself.
function referenceSignature(url: string, params: Record<string, string>): string {
  const data =
    url +
    Object.keys(params)
      .sort()
      .map((k) => k + params[k])
      .join('');
  return createHmac('sha1', AUTH_TOKEN).update(data, 'utf8').digest('base64');
}

describe('verifyTwilioSignature', () => {
  const params = {
    MessageSid: 'SM123',
    MessageStatus: 'delivered',
    To: '+19025551234',
  };

  it('accepts a correctly signed request', () => {
    expect(
      verifyTwilioSignature({
        url: URL,
        params,
        signatureHeader: referenceSignature(URL, params),
        authToken: AUTH_TOKEN,
      }),
    ).toEqual({ ok: true });
  });

  it('signature is insensitive to param insertion order (keys are sorted)', () => {
    const shuffled = { To: '+19025551234', MessageStatus: 'delivered', MessageSid: 'SM123' };
    expect(computeTwilioSignature(AUTH_TOKEN, URL, shuffled)).toBe(
      computeTwilioSignature(AUTH_TOKEN, URL, params),
    );
  });

  it('rejects a tampered param value', () => {
    expect(
      verifyTwilioSignature({
        url: URL,
        params: { ...params, MessageStatus: 'failed' },
        signatureHeader: referenceSignature(URL, params),
        authToken: AUTH_TOKEN,
      }),
    ).toEqual({ error: 'Signature mismatch.' });
  });

  it('rejects a signature computed against a different URL (Host confusion)', () => {
    expect(
      verifyTwilioSignature({
        url: URL,
        params,
        signatureHeader: referenceSignature('https://evil.example.test/api/twilio/webhook', params),
        authToken: AUTH_TOKEN,
      }),
    ).toEqual({ error: 'Signature mismatch.' });
  });

  it('rejects the wrong auth token', () => {
    expect(
      verifyTwilioSignature({
        url: URL,
        params,
        signatureHeader: referenceSignature(URL, params),
        authToken: 'some_other_token',
      }),
    ).toEqual({ error: 'Signature mismatch.' });
  });

  it('rejects a missing header / missing token with named errors', () => {
    expect(
      verifyTwilioSignature({ url: URL, params, signatureHeader: null, authToken: AUTH_TOKEN }),
    ).toEqual({ error: 'Missing X-Twilio-Signature header.' });
    expect(
      verifyTwilioSignature({
        url: URL,
        params,
        signatureHeader: referenceSignature(URL, params),
        authToken: '',
      }),
    ).toEqual({ error: 'TWILIO_AUTH_TOKEN is not set.' });
  });
});
