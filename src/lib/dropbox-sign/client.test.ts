import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  ctorCalls: 0,
}));

vi.mock('server-only', () => ({}));
vi.mock('@dropbox/sign', () => ({
  SignatureRequestApi: class MockSignatureRequestApi {
    username = '';
    constructor() {
      mocks.ctorCalls += 1;
    }
  },
}));

import { __resetForTests, client } from './client';
import { currentMsaTemplateVersion } from './templates';

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  mocks.ctorCalls = 0;
  __resetForTests();
  delete process.env.DROPBOX_SIGN_API_KEY;
  delete process.env.MSA_TEMPLATE_VERSION;
});

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL_ENV)) delete process.env[key];
  }
  Object.assign(process.env, ORIGINAL_ENV);
});

describe('dropbox-sign client', () => {
  it('returns {error} when DROPBOX_SIGN_API_KEY is unset', () => {
    const result = client();
    expect(result).toEqual({ error: 'DROPBOX_SIGN_API_KEY is not set.' });
    expect(mocks.ctorCalls).toBe(0);
  });

  it('configures the SignatureRequestApi with the env API key', () => {
    process.env.DROPBOX_SIGN_API_KEY = 'sk_test_abc';
    const result = client();
    expect('ok' in result && result.ok).toBe(true);
    if ('ok' in result) {
      expect(result.signatureRequestApi.username).toBe('sk_test_abc');
    }
    expect(mocks.ctorCalls).toBe(1);
  });

  it('caches the configured client across calls (singleton)', () => {
    process.env.DROPBOX_SIGN_API_KEY = 'sk_test_abc';
    const first = client();
    const second = client();
    expect(mocks.ctorCalls).toBe(1);
    if ('ok' in first && 'ok' in second) {
      expect(first.signatureRequestApi).toBe(second.signatureRequestApi);
    }
  });
});

describe('currentMsaTemplateVersion', () => {
  it('returns {error} when MSA_TEMPLATE_VERSION is unset', () => {
    expect(currentMsaTemplateVersion()).toEqual({
      error: 'MSA_TEMPLATE_VERSION is not set.',
    });
  });

  it('returns the trimmed env value when set', () => {
    process.env.MSA_TEMPLATE_VERSION = '  2026-05-12  ';
    expect(currentMsaTemplateVersion()).toBe('2026-05-12');
  });

  it('treats whitespace-only as unset', () => {
    process.env.MSA_TEMPLATE_VERSION = '   ';
    expect(currentMsaTemplateVersion()).toEqual({
      error: 'MSA_TEMPLATE_VERSION is not set.',
    });
  });
});
