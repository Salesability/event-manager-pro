import 'server-only';
import { DocumentApi, DocumentSigner, SendForSign } from 'boldsign';

export type ClientResult =
  | { ok: true; documentApi: DocumentApi }
  | { error: string };

let cached: { documentApi: DocumentApi } | null = null;

const PRODUCTION_BASE_URL = 'https://api.boldsign.com';
const SANDBOX_BASE_URL = 'https://api-sandbox.boldsign.com';

function baseUrlForEnv(): string {
  return process.env.APP_ENV === 'production'
    ? PRODUCTION_BASE_URL
    : SANDBOX_BASE_URL;
}

export function client(): ClientResult {
  if (cached) return { ok: true, ...cached };

  const apiKey = process.env.BOLDSIGN_API_KEY;
  if (!apiKey) return { error: 'BOLDSIGN_API_KEY is not set.' };

  const documentApi = new DocumentApi(baseUrlForEnv());
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

  const sendForSign = new SendForSign();
  sendForSign.title = input.subject;
  sendForSign.message = input.message;
  sendForSign.isSandbox = process.env.APP_ENV !== 'production';

  const signer = new DocumentSigner();
  signer.name = input.signer.name;
  signer.emailAddress = input.signer.emailAddress;
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
