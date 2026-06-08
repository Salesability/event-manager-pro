import 'server-only';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

// Authenticated symmetric encryption for tokens stored at rest (chunk 0068 —
// the QuickBooks OAuth access/refresh tokens). AES-256-GCM: confidentiality +
// integrity, so a tampered ciphertext fails `decrypt()` rather than yielding
// garbage. The key comes from `QBO_TOKEN_ENC_KEY` (base64 of 32 random bytes,
// e.g. `openssl rand -base64 32`); it is read per-call (not module-cached) so a
// rotated secret takes effect on the next Cloud Run revision without a stale
// closure. Payload format is `v1.<base64(iv | tag | ciphertext)>` — the version
// prefix leaves room to change algorithm/KDF later without ambiguity.
// (Named "sealed-box", not "secret-box", to dodge the repo's `*secret*`
// .gitignore catch-all — this is crypto code, not a secret file.)

const VERSION = 'v1';
const IV_BYTES = 12; // 96-bit nonce — the GCM standard size.
const TAG_BYTES = 16; // 128-bit GCM auth tag.
const KEY_BYTES = 32; // AES-256.

function getKey(): Buffer {
  const raw = process.env.QBO_TOKEN_ENC_KEY?.trim();
  if (!raw) {
    throw new Error('QBO_TOKEN_ENC_KEY is not set.');
  }
  const key = Buffer.from(raw, 'base64');
  if (key.length !== KEY_BYTES) {
    throw new Error(
      `QBO_TOKEN_ENC_KEY must decode to ${KEY_BYTES} bytes (base64 of a 32-byte key, e.g. \`openssl rand -base64 32\`).`,
    );
  }
  return key;
}

export function encrypt(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${VERSION}.${Buffer.concat([iv, tag, ciphertext]).toString('base64')}`;
}

export function decrypt(payload: string): string {
  const key = getKey();
  const dot = payload.indexOf('.');
  const version = dot === -1 ? '' : payload.slice(0, dot);
  const b64 = dot === -1 ? '' : payload.slice(dot + 1);
  if (version !== VERSION || !b64) {
    throw new Error('Malformed ciphertext: expected "v1.<base64>".');
  }
  const buf = Buffer.from(b64, 'base64');
  if (buf.length < IV_BYTES + TAG_BYTES) {
    throw new Error('Malformed ciphertext: truncated IV/tag.');
  }
  const iv = buf.subarray(0, IV_BYTES);
  const tag = buf.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const ciphertext = buf.subarray(IV_BYTES + TAG_BYTES);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  // `final()` throws if the GCM tag doesn't verify — i.e. on any tampering or a
  // wrong key. Callers treat a throw as "unreadable token → force re-connect".
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}
