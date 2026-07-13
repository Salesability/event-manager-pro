import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  ctorCalls: [] as Array<{ accountSid?: string; authToken?: string }>,
}));

vi.mock('server-only', () => ({}));
vi.mock('twilio', () => ({
  default: (accountSid?: string, authToken?: string) => {
    mocks.ctorCalls.push({ accountSid, authToken });
    return { messages: { create: vi.fn() } };
  },
}));

import { __resetForTests, client } from './client';

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  mocks.ctorCalls = [];
  __resetForTests();
  delete process.env.TWILIO_ACCOUNT_SID;
  delete process.env.TWILIO_AUTH_TOKEN;
  delete process.env.TWILIO_MESSAGING_SERVICE_SID;
});

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL_ENV)) delete process.env[key];
  }
  Object.assign(process.env, ORIGINAL_ENV);
});

describe('sms client', () => {
  it('returns {error} when TWILIO_ACCOUNT_SID is unset', () => {
    const result = client();
    expect(result).toEqual({ error: 'TWILIO_ACCOUNT_SID is not set.' });
    expect(mocks.ctorCalls).toHaveLength(0);
  });

  it('returns {error} when TWILIO_AUTH_TOKEN is unset', () => {
    process.env.TWILIO_ACCOUNT_SID = 'AC_test';
    const result = client();
    expect(result).toEqual({ error: 'TWILIO_AUTH_TOKEN is not set.' });
    expect(mocks.ctorCalls).toHaveLength(0);
  });

  it('returns {error} when TWILIO_MESSAGING_SERVICE_SID is unset', () => {
    process.env.TWILIO_ACCOUNT_SID = 'AC_test';
    process.env.TWILIO_AUTH_TOKEN = 'token_test';
    const result = client();
    expect(result).toEqual({ error: 'TWILIO_MESSAGING_SERVICE_SID is not set.' });
    expect(mocks.ctorCalls).toHaveLength(0);
  });

  it('configures the Twilio client from env and carries the messaging service sid', () => {
    process.env.TWILIO_ACCOUNT_SID = 'AC_test';
    process.env.TWILIO_AUTH_TOKEN = 'token_test';
    process.env.TWILIO_MESSAGING_SERVICE_SID = 'MG_test';
    const result = client();
    expect('ok' in result && result.ok).toBe(true);
    if ('ok' in result) {
      expect(result.messagingServiceSid).toBe('MG_test');
    }
    expect(mocks.ctorCalls).toEqual([{ accountSid: 'AC_test', authToken: 'token_test' }]);
  });

  it('caches the configured client across calls (singleton)', () => {
    process.env.TWILIO_ACCOUNT_SID = 'AC_test';
    process.env.TWILIO_AUTH_TOKEN = 'token_test';
    process.env.TWILIO_MESSAGING_SERVICE_SID = 'MG_test';
    const first = client();
    const second = client();
    expect(mocks.ctorCalls).toHaveLength(1);
    if ('ok' in first && 'ok' in second) {
      expect(first.client).toBe(second.client);
    }
  });
});
