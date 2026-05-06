import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  resendSend: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('resend', () => ({
  Resend: class MockResend {
    emails = { send: mocks.resendSend };
  },
}));

import { sendEmail } from './send';

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  vi.clearAllMocks();
  // Reset to a known baseline
  delete process.env.APP_ENV;
  delete process.env.EMAIL_DEV_TO;
  process.env.RESEND_API_KEY = 'test-key';
  process.env.RESEND_FROM_EMAIL = 'noreply@example.test';
  mocks.resendSend.mockResolvedValue({ data: { id: 'msg_123' }, error: null });
});

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL_ENV)) delete process.env[key];
  }
  Object.assign(process.env, ORIGINAL_ENV);
});

describe('sendEmail (Phase 7: inverted dev-redirect)', () => {
  it('APP_ENV=production real-sends without redirect', async () => {
    process.env.APP_ENV = 'production';
    const result = await sendEmail({
      to: 'customer@example.test',
      subject: 'Confirmation',
      text: 'Body',
    });
    expect(result).toEqual({ ok: true, id: 'msg_123' });
    expect(mocks.resendSend).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'customer@example.test', subject: 'Confirmation' }),
    );
  });

  it('APP_ENV=production ignores EMAIL_DEV_TO (still real-sends)', async () => {
    process.env.APP_ENV = 'production';
    process.env.EMAIL_DEV_TO = 'dev@example.test';
    await sendEmail({ to: 'customer@example.test', subject: 'X', text: 'B' });
    expect(mocks.resendSend).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'customer@example.test', subject: 'X' }),
    );
  });

  it('non-production with EMAIL_DEV_TO redirects + prefixes subject', async () => {
    process.env.APP_ENV = 'development';
    process.env.EMAIL_DEV_TO = 'dev@example.test';
    await sendEmail({ to: 'customer@example.test', subject: 'Hello', text: 'B' });
    expect(mocks.resendSend).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'dev@example.test',
        subject: '[DEV→customer@example.test] Hello',
      }),
    );
  });

  it('APP_ENV unset (defaults to non-prod) redirects when EMAIL_DEV_TO is set', async () => {
    process.env.EMAIL_DEV_TO = 'dev@example.test';
    await sendEmail({ to: 'customer@example.test', subject: 'X', text: 'B' });
    expect(mocks.resendSend).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'dev@example.test',
        subject: '[DEV→customer@example.test] X',
      }),
    );
  });

  it('non-production without EMAIL_DEV_TO refuses to send (failsafe)', async () => {
    process.env.APP_ENV = 'staging';
    const result = await sendEmail({
      to: 'customer@example.test',
      subject: 'X',
      text: 'B',
    });
    expect(result).toMatchObject({ error: expect.stringContaining('refused') });
    expect(mocks.resendSend).not.toHaveBeenCalled();
  });

  it('APP_ENV unset AND EMAIL_DEV_TO unset refuses to send', async () => {
    const result = await sendEmail({ to: 'customer@example.test', subject: 'X', text: 'B' });
    expect(result).toMatchObject({ error: expect.stringContaining('refused') });
    expect(mocks.resendSend).not.toHaveBeenCalled();
  });

  it('APP_ENV with case/whitespace variants is treated as production', async () => {
    process.env.APP_ENV = ' Production ';
    await sendEmail({ to: 'customer@example.test', subject: 'X', text: 'B' });
    expect(mocks.resendSend).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'customer@example.test', subject: 'X' }),
    );
  });

  it('returns Resend error verbatim when SDK fails', async () => {
    process.env.APP_ENV = 'production';
    mocks.resendSend.mockResolvedValueOnce({
      data: null,
      error: { message: 'rate limited' },
    });
    const result = await sendEmail({ to: 'a@b.test', subject: 'X', text: 'B' });
    expect(result).toEqual({ error: 'rate limited' });
  });

  it('refuses if RESEND_FROM_EMAIL is missing', async () => {
    process.env.APP_ENV = 'production';
    delete process.env.RESEND_FROM_EMAIL;
    const result = await sendEmail({ to: 'a@b.test', subject: 'X', text: 'B' });
    expect(result).toEqual({ error: 'RESEND_FROM_EMAIL is not set.' });
  });
});
