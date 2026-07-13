import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { compareFingerprints, computeIdentityHmac } from './identity';

const ORIGINAL_ENV = { ...process.env };
// base64 of 32 bytes.
const KEY = Buffer.alloc(32, 7).toString('base64');

beforeEach(() => {
  process.env.SMS_IDENTITY_HMAC_KEY = KEY;
});

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL_ENV)) delete process.env[key];
  }
  Object.assign(process.env, ORIGINAL_ENV);
});

describe('computeIdentityHmac', () => {
  const base = { firstName: 'Pat', lastName: 'Chen', phone: '+19025551234' };

  it('is deterministic for the same identity, in <keyid>:<hmac> format', () => {
    const a = computeIdentityHmac(base);
    expect(a).toMatch(/^[0-9a-f]{8}:[0-9a-f]{64}$/);
    expect(computeIdentityHmac({ ...base })).toBe(a);
  });

  it('normalizes case and whitespace to the same fingerprint', () => {
    const a = computeIdentityHmac(base);
    expect(
      computeIdentityHmac({ firstName: ' pat ', lastName: 'CHEN', phone: '+19025551234' }),
    ).toBe(a);
    expect(
      computeIdentityHmac({ firstName: 'Pat', lastName: 'Chen  ', phone: '+19025551234' }),
    ).toBe(a);
  });

  it('a different name on the same phone diverges (recycled-number signal)', () => {
    expect(computeIdentityHmac({ ...base, firstName: 'Sam' })).not.toBe(
      computeIdentityHmac(base),
    );
  });

  it('the phone participates in the fingerprint', () => {
    expect(computeIdentityHmac({ ...base, phone: '+19025559999' })).not.toBe(
      computeIdentityHmac(base),
    );
  });

  it('keeps field boundaries distinct (ann|marie smith vs ann marie|smith)', () => {
    expect(
      computeIdentityHmac({ firstName: 'ann', lastName: 'marie smith', phone: '+19025551234' }),
    ).not.toBe(
      computeIdentityHmac({ firstName: 'ann marie', lastName: 'smith', phone: '+19025551234' }),
    );
  });

  it('returns null for a nameless row (adds nothing over the phone column)', () => {
    expect(
      computeIdentityHmac({ firstName: null, lastName: null, phone: '+19025551234' }),
    ).toBeNull();
    expect(
      computeIdentityHmac({ firstName: '  ', lastName: '', phone: '+19025551234' }),
    ).toBeNull();
  });

  it('a single present name field still fingerprints', () => {
    expect(
      computeIdentityHmac({ firstName: 'Pat', lastName: null, phone: '+19025551234' }),
    ).toMatch(/^[0-9a-f]{8}:[0-9a-f]{64}$/);
  });

  it('a pipe inside a name cannot forge the field boundary', () => {
    expect(
      computeIdentityHmac({ firstName: 'ann|marie', lastName: 'smith', phone: '+19025551234' }),
    ).toBe(
      computeIdentityHmac({ firstName: 'ann marie', lastName: 'smith', phone: '+19025551234' }),
    );
    expect(
      computeIdentityHmac({ firstName: 'ann|marie', lastName: 'smith', phone: '+19025551234' }),
    ).not.toBe(
      computeIdentityHmac({ firstName: 'ann', lastName: 'marie|smith', phone: '+19025551234' }),
    );
  });

  it('returns null when the key is unset or malformed (graceful degrade)', () => {
    delete process.env.SMS_IDENTITY_HMAC_KEY;
    expect(computeIdentityHmac(base)).toBeNull();
    process.env.SMS_IDENTITY_HMAC_KEY = 'too-short';
    expect(computeIdentityHmac(base)).toBeNull();
  });

  it('a different key yields a different fingerprint (rotation orphans, never lies)', () => {
    const a = computeIdentityHmac(base);
    process.env.SMS_IDENTITY_HMAC_KEY = Buffer.alloc(32, 9).toString('base64');
    expect(computeIdentityHmac(base)).not.toBe(a);
  });
});

describe('compareFingerprints', () => {
  const base = { firstName: 'Pat', lastName: 'Chen', phone: '+19025551234' };

  it('matches / differs under the same key', () => {
    const a = computeIdentityHmac(base);
    expect(compareFingerprints(a, computeIdentityHmac({ ...base }))).toBe('matches');
    expect(compareFingerprints(a, computeIdentityHmac({ ...base, firstName: 'Sam' }))).toBe(
      'differs',
    );
  });

  it('cross-key comparison reads unknown, never a false differs (rotation)', () => {
    const a = computeIdentityHmac(base);
    process.env.SMS_IDENTITY_HMAC_KEY = Buffer.alloc(32, 9).toString('base64');
    const b = computeIdentityHmac(base);
    expect(compareFingerprints(a, b)).toBe('unknown');
  });

  it('absent fingerprints read unknown', () => {
    const a = computeIdentityHmac(base);
    expect(compareFingerprints(a, null)).toBe('unknown');
    expect(compareFingerprints(null, null)).toBe('unknown');
  });

  it('unversioned values (no key-id prefix) compare directly', () => {
    expect(compareFingerprints('legacy-a', 'legacy-a')).toBe('matches');
    expect(compareFingerprints('legacy-a', 'legacy-b')).toBe('differs');
  });
});
