import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { currentMsaTemplateVersion } from './template-version';

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  delete process.env.MSA_TEMPLATE_VERSION;
});

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL_ENV)) delete process.env[key];
  }
  Object.assign(process.env, ORIGINAL_ENV);
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
