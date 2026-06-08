import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { decrypt, encrypt } from './sealed-box';

vi.mock('server-only', () => ({}));

// A deterministic 32-byte key (base64) for the round-trip tests.
const KEY = Buffer.alloc(32, 7).toString('base64');

describe('sealed-box', () => {
  beforeEach(() => {
    process.env.QBO_TOKEN_ENC_KEY = KEY;
  });
  afterEach(() => {
    delete process.env.QBO_TOKEN_ENC_KEY;
  });

  it('round-trips plaintext through encrypt → decrypt', () => {
    const plaintext = 'qbo-refresh-token-xyz.123';
    const sealed = encrypt(plaintext);
    expect(sealed).not.toContain(plaintext); // ciphertext, not the raw value
    expect(sealed.startsWith('v1.')).toBe(true);
    expect(decrypt(sealed)).toBe(plaintext);
  });

  it('produces a fresh IV each call (same input → different ciphertext)', () => {
    const a = encrypt('same');
    const b = encrypt('same');
    expect(a).not.toBe(b);
    expect(decrypt(a)).toBe('same');
    expect(decrypt(b)).toBe('same');
  });

  it('round-trips empty + multibyte UTF-8 strings', () => {
    for (const s of ['', 'café ☕ — 你好']) {
      expect(decrypt(encrypt(s))).toBe(s);
    }
  });

  it('throws when the GCM tag fails to verify (tampered ciphertext)', () => {
    const sealed = encrypt('tamper-me');
    // Decode the v1 payload, flip a real ciphertext byte, re-encode. (Flipping
    // the last base64 char is a no-op when the payload ends in `=` padding.)
    const buf = Buffer.from(sealed.slice('v1.'.length), 'base64');
    buf[buf.length - 1] ^= 0xff;
    const tampered = `v1.${buf.toString('base64')}`;
    expect(() => decrypt(tampered)).toThrow();
  });

  it('rejects a malformed payload (no version prefix)', () => {
    expect(() => decrypt('not-a-valid-payload')).toThrow(/Malformed ciphertext/);
  });

  it('throws a clear error when the key is missing', () => {
    delete process.env.QBO_TOKEN_ENC_KEY;
    expect(() => encrypt('x')).toThrow(/QBO_TOKEN_ENC_KEY is not set/);
  });

  it('throws when the key is the wrong length', () => {
    process.env.QBO_TOKEN_ENC_KEY = Buffer.alloc(16, 1).toString('base64'); // 128-bit, too short
    expect(() => encrypt('x')).toThrow(/must decode to 32 bytes/);
  });
});
