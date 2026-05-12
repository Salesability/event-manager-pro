import 'server-only';
import { SignatureRequestApi } from '@dropbox/sign';

export type ClientResult =
  | { ok: true; signatureRequestApi: SignatureRequestApi }
  | { error: string };

let cached: { signatureRequestApi: SignatureRequestApi } | null = null;

export function client(): ClientResult {
  if (cached) return { ok: true, ...cached };

  const apiKey = process.env.DROPBOX_SIGN_API_KEY;
  if (!apiKey) return { error: 'DROPBOX_SIGN_API_KEY is not set.' };

  const signatureRequestApi = new SignatureRequestApi();
  signatureRequestApi.username = apiKey;

  cached = { signatureRequestApi };
  return { ok: true, signatureRequestApi };
}

// Test-only — drops the module-level cache so unit tests can re-init with a
// different env. Production callers should never invoke this.
export function __resetForTests() {
  cached = null;
}
