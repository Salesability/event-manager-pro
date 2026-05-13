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

export type SignerInput = {
  emailAddress: string;
  name: string;
};

export type EnvelopeFile = {
  filename: string;
  body: Buffer;
};

export type SendSignatureRequestInput = {
  subject: string;
  message: string;
  signer: SignerInput;
  files: EnvelopeFile[];
  /** Optional Dropbox Sign metadata pinned onto the signature request so the
   *  webhook can correlate back to the row without a separate lookup table. */
  metadata?: Record<string, string>;
};

export type SendSignatureRequestResult =
  | { ok: true; signatureRequestId: string }
  | { error: string };

// Wrapper around `SignatureRequestApi.signatureRequestSend` (inline-upload
// flow per OQ #3 resolution 2026-05-12 — the MSA prose is rendered in-repo
// and uploaded with each envelope, no Dropbox-Sign-side template). The
// signer receives an email from Dropbox Sign with a hosted-page sign link;
// this app does NOT use embedded signing in v1, so `DROPBOX_SIGN_CLIENT_ID`
// is documented in `.env.example` for forward-compat but not read here.
export async function sendSignatureRequest(
  input: SendSignatureRequestInput,
): Promise<SendSignatureRequestResult> {
  const c = client();
  if ('error' in c) return c;

  try {
    const response = await c.signatureRequestApi.signatureRequestSend({
      subject: input.subject,
      message: input.message,
      signers: [
        {
          emailAddress: input.signer.emailAddress,
          name: input.signer.name,
        },
      ],
      files: input.files.map((f) => ({
        value: f.body,
        options: {
          filename: f.filename,
          contentType: 'application/pdf',
        },
      })),
      metadata: input.metadata,
      testMode: process.env.APP_ENV !== 'production',
    });
    const id = response?.body?.signatureRequest?.signatureRequestId;
    if (!id) {
      return { error: 'Dropbox Sign returned no signatureRequestId.' };
    }
    return { ok: true, signatureRequestId: id };
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : 'Dropbox Sign send failed.',
    };
  }
}

export type SignedFileBytesResult =
  | { ok: true; body: Buffer }
  | { error: string };

// Wrapper around `SignatureRequestApi.signatureRequestFiles` — fetches the
// fully-signed PDF (all signers complete) so the webhook handler (Phase 4)
// can persist it to GCS at `msa/<msaId>/signed.pdf`. Returns raw PDF bytes.
export async function getSignedFileBytes(
  signatureRequestId: string,
): Promise<SignedFileBytesResult> {
  const c = client();
  if ('error' in c) return c;

  try {
    const response = await c.signatureRequestApi.signatureRequestFiles(
      signatureRequestId,
      'pdf',
    );
    const body = response?.body as unknown;
    if (Buffer.isBuffer(body)) return { ok: true, body };
    if (body && typeof body === 'object' && 'arrayBuffer' in (body as object)) {
      const blob = body as Blob;
      const buf = Buffer.from(await blob.arrayBuffer());
      return { ok: true, body: buf };
    }
    return { error: 'Dropbox Sign returned unexpected file payload shape.' };
  } catch (err) {
    return {
      error:
        err instanceof Error ? err.message : 'Dropbox Sign file fetch failed.',
    };
  }
}
