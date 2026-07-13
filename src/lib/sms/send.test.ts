import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  messagesCreate: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('twilio', () => ({
  default: () => ({ messages: { create: mocks.messagesCreate } }),
}));

import { __resetForTests } from './client';
import { sendSms } from './send';

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  vi.clearAllMocks();
  __resetForTests();
  delete process.env.APP_ENV;
  delete process.env.SMS_DEV_TO;
  process.env.TWILIO_ACCOUNT_SID = 'AC_test';
  process.env.TWILIO_AUTH_TOKEN = 'token_test';
  process.env.TWILIO_MESSAGING_SERVICE_SID = 'MG_test';
  mocks.messagesCreate.mockResolvedValue({ sid: 'SM_123', status: 'queued' });
});

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL_ENV)) delete process.env[key];
  }
  Object.assign(process.env, ORIGINAL_ENV);
});

describe('sendSms (inverted dev-redirect)', () => {
  it('returns {error} when Twilio creds are unset', async () => {
    delete process.env.TWILIO_ACCOUNT_SID;
    const result = await sendSms({ to: '+19025551234', body: 'Hi' });
    expect(result).toEqual({ error: 'TWILIO_ACCOUNT_SID is not set.' });
    expect(mocks.messagesCreate).not.toHaveBeenCalled();
  });

  it('APP_ENV=production real-sends without redirect', async () => {
    process.env.APP_ENV = 'production';
    const result = await sendSms({ to: '+19025551234', body: 'Event Saturday' });
    expect(result).toEqual({ ok: true, sid: 'SM_123' });
    expect(mocks.messagesCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        to: '+19025551234',
        body: 'Event Saturday',
        messagingServiceSid: 'MG_test',
      }),
    );
  });

  it('APP_ENV=production ignores SMS_DEV_TO (still real-sends)', async () => {
    process.env.APP_ENV = 'production';
    process.env.SMS_DEV_TO = '+15005550006';
    await sendSms({ to: '+19025551234', body: 'X' });
    expect(mocks.messagesCreate).toHaveBeenCalledWith(
      expect.objectContaining({ to: '+19025551234', body: 'X' }),
    );
  });

  it('non-production with SMS_DEV_TO redirects + prefixes body', async () => {
    process.env.APP_ENV = 'development';
    process.env.SMS_DEV_TO = '+15005550006';
    await sendSms({ to: '+19025551234', body: 'Hello' });
    expect(mocks.messagesCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        to: '+15005550006',
        body: '[DEV→+19025551234] Hello',
      }),
    );
  });

  it('APP_ENV unset (defaults to non-prod) redirects when SMS_DEV_TO is set', async () => {
    process.env.SMS_DEV_TO = '+15005550006';
    await sendSms({ to: '+19025551234', body: 'X' });
    expect(mocks.messagesCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        to: '+15005550006',
        body: '[DEV→+19025551234] X',
      }),
    );
  });

  it('non-production without SMS_DEV_TO refuses to send (failsafe)', async () => {
    process.env.APP_ENV = 'staging';
    const result = await sendSms({ to: '+19025551234', body: 'X' });
    expect(result).toMatchObject({ error: expect.stringContaining('refused') });
    expect(mocks.messagesCreate).not.toHaveBeenCalled();
  });

  it('APP_ENV with case/whitespace variants is treated as production', async () => {
    process.env.APP_ENV = ' Production ';
    process.env.SMS_DEV_TO = '+15005550006';
    await sendSms({ to: '+19025551234', body: 'X' });
    expect(mocks.messagesCreate).toHaveBeenCalledWith(
      expect.objectContaining({ to: '+19025551234', body: 'X' }),
    );
  });

  it('forwards statusCallback when statusCallbackUrl is supplied', async () => {
    process.env.APP_ENV = 'production';
    await sendSms({
      to: '+19025551234',
      body: 'X',
      statusCallbackUrl: 'https://app.example.test/api/twilio/webhook',
    });
    expect(mocks.messagesCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCallback: 'https://app.example.test/api/twilio/webhook',
      }),
    );
  });

  it('omits statusCallback when statusCallbackUrl is not supplied', async () => {
    process.env.APP_ENV = 'production';
    await sendSms({ to: '+19025551234', body: 'X' });
    const call = mocks.messagesCreate.mock.calls[0][0];
    expect(call).not.toHaveProperty('statusCallback');
  });

  it('returns the Twilio error message when create throws', async () => {
    process.env.APP_ENV = 'production';
    mocks.messagesCreate.mockRejectedValueOnce(new Error('rate limited'));
    const result = await sendSms({ to: '+19025551234', body: 'X' });
    expect(result).toEqual({ error: 'rate limited' });
  });

  it('returns {error} when Twilio returns no sid', async () => {
    process.env.APP_ENV = 'production';
    mocks.messagesCreate.mockResolvedValueOnce({ status: 'queued' });
    const result = await sendSms({ to: '+19025551234', body: 'X' });
    expect(result).toEqual({ error: 'Twilio returned no message sid.' });
  });
});
