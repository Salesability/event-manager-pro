import 'server-only';
import { DocumentApi, DocumentSigner, SendForSign } from 'boldsign';

export type ClientResult =
  | { ok: true; documentApi: DocumentApi }
  | { error: string };

let cached: { documentApi: DocumentApi } | null = null;

// BoldSign hosts API endpoints per region: US = api.boldsign.com,
// EU = api-eu.boldsign.com, CA = api-ca.boldsign.com. The region is fixed
// by the BoldSign account, not by sandbox vs. production — sandbox keys
// hit the same regional host as production keys for that account, with
// sandbox-vs-prod signaled by the per-request `isSandbox` flag in
// `sendSignatureRequest`. Default to US; override via env for accounts in
// other regions (a CA-region key 401s against the US host with an empty
// response body, which is what the SDK surfaces as "Invalid authentication").
const DEFAULT_BASE_URL = 'https://api.boldsign.com';

export function client(): ClientResult {
  if (cached) return { ok: true, ...cached };

  const apiKey = process.env.BOLDSIGN_API_KEY;
  if (!apiKey) return { error: 'BOLDSIGN_API_KEY is not set.' };

  const baseUrl = process.env.BOLDSIGN_API_BASE_URL ?? DEFAULT_BASE_URL;
  const documentApi = new DocumentApi(baseUrl);
  documentApi.setApiKey(apiKey);

  cached = { documentApi };
  return { ok: true, documentApi };
}

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
  /** Optional BoldSign metadata pinned onto the document so the webhook
   *  can correlate back to the row without a separate lookup table. */
  metadata?: Record<string, string>;
};

export type SendSignatureRequestResult =
  | { ok: true; documentId: string }
  | { error: string };

// Mirrors the Resend redirect doctrine in `src/lib/email/send.ts:34-58`
// applied to BoldSign's vendor-sent signing-request email — and reuses the
// same `EMAIL_DEV_TO` env var rather than introducing a second one, so
// non-prod environments only ever need a single inbox configured for
// dev-mail-of-any-kind (transactional + signing). Real-send to the
// caller-provided signer address requires explicit `APP_ENV=production`;
// any other environment redirects the signer's emailAddress to
// `EMAIL_DEV_TO`, or refuses the send if that env is unset. BoldSign's
// `isSandbox: true` flag stamps the document as non-binding but does NOT
// stop BoldSign from emailing the recipient — that's why the redirect lives
// here and not in BoldSign's sandbox-mode behaviour. APP_ENV is normalised
// to lowercase so ` Production ` / `Production` don't fall through and
// silently redirect to a dev inbox in real prod (matches `send.ts:47-49`).
type SignerRedirectDecision =
  | { redirect: true; to: string }
  | { redirect: false; reason: 'production' | 'no-dev-target' };

function decideSignerRedirect(): SignerRedirectDecision {
  const appEnv = process.env.APP_ENV?.trim().toLowerCase();
  if (appEnv === 'production') {
    return { redirect: false, reason: 'production' };
  }
  const devTo = process.env.EMAIL_DEV_TO?.trim();
  if (!devTo) {
    return { redirect: false, reason: 'no-dev-target' };
  }
  return { redirect: true, to: devTo };
}

// Wrapper around `DocumentApi.sendDocument` (inline-upload flow per D #2
// 2026-05-15 — the MSA prose is rendered in-repo and uploaded with each
// envelope, no BoldSign-side template). The signer receives an email
// from BoldSign with a hosted-page sign link; this app does NOT use
// embedded signing in v1.
export async function sendSignatureRequest(
  input: SendSignatureRequestInput,
): Promise<SendSignatureRequestResult> {
  const c = client();
  if ('error' in c) return c;

  const redirect = decideSignerRedirect();
  if (!redirect.redirect && redirect.reason === 'no-dev-target') {
    return {
      error:
        'BoldSign send refused: APP_ENV is not "production" and EMAIL_DEV_TO is not set. Set EMAIL_DEV_TO to redirect, or APP_ENV=production to real-send.',
    };
  }

  const sendForSign = new SendForSign();
  sendForSign.title = input.subject;
  sendForSign.message = input.message;
  sendForSign.isSandbox = process.env.APP_ENV !== 'production';

  const signer = new DocumentSigner();
  // signer.name keeps the original Client name so the dev inbox can still see
  // who the envelope was meant for; only emailAddress is rewritten.
  signer.name = input.signer.name;
  signer.emailAddress = redirect.redirect ? redirect.to : input.signer.emailAddress;
  sendForSign.signers = [signer];

  sendForSign.files = input.files.map((f) => ({
    value: f.body,
    options: {
      filename: f.filename,
      contentType: 'application/pdf',
    },
  }));

  if (input.metadata) {
    sendForSign.metaData = input.metadata;
  }

  try {
    const response = await c.documentApi.sendDocument(sendForSign);
    const id = response?.documentId;
    if (!id) {
      return { error: 'BoldSign returned no documentId.' };
    }
    return { ok: true, documentId: id };
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : 'BoldSign send failed.',
    };
  }
}

export type SignedFileBytesResult =
  | { ok: true; body: Buffer }
  | { error: string };

// Wrapper around `DocumentApi.downloadDocument` — fetches the
// fully-signed PDF (all signers complete) so the webhook handler can
// persist it to GCS at `msa/<msaId>/signed.pdf`. Returns raw PDF bytes.
export async function getSignedFileBytes(
  documentId: string,
): Promise<SignedFileBytesResult> {
  const c = client();
  if ('error' in c) return c;

  try {
    const body = await c.documentApi.downloadDocument(documentId);
    if (!Buffer.isBuffer(body)) {
      return { error: 'BoldSign returned unexpected file payload shape.' };
    }
    return { ok: true, body };
  } catch (err) {
    return {
      error:
        err instanceof Error ? err.message : 'BoldSign file fetch failed.',
    };
  }
}
