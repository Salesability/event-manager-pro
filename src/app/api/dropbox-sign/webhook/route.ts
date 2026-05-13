import { NextResponse, type NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { masterServiceAgreements } from '@/lib/db/schema';
import { putObject } from '@/lib/storage/gcs';
import { getSignedFileBytes } from '@/lib/dropbox-sign/client';
import { verifyWebhookSignature } from '@/lib/dropbox-sign/webhook-verify';
import { markMsaDeclined, markMsaSigned } from '@/features/msa/lifecycle';

// authz: public — Dropbox Sign webhook caller has no auth.users session.
// Gate is HMAC signature verification against DROPBOX_SIGN_WEBHOOK_SECRET,
// performed BEFORE any read or mutation per the plan body's
// Open Question #8 (and CLAUDE.md → "Mutations go through Server Actions" —
// this is the rare external-caller exception that warrants a route handler).
//
// Dropbox Sign POSTs `application/x-www-form-urlencoded` (or multipart) with
// a single `json` field carrying the event payload. The payload shape:
//   {
//     event: {
//       event_time: '1779724800',
//       event_type: 'signature_request_all_signed' | 'signature_request_declined' | ...,
//       event_hash: '<hex hmac>',
//       event_metadata: { ... }
//     },
//     signature_request: { signature_request_id: 'sig-req-abc', ... }
//   }
//
// Dropbox Sign expects an HTTP-200 body containing the literal string
// `Hello API Event Received`; they retry on any other response.

const ACK_BODY = 'Hello API Event Received';

type DropboxSignEvent = {
  event_time: string;
  event_type: string;
  event_hash: string;
};

type DropboxSignSignatureRequest = {
  signature_request_id: string;
};

type DropboxSignPayload = {
  event: DropboxSignEvent;
  signature_request?: DropboxSignSignatureRequest;
};

function parseJsonField(payload: string): DropboxSignPayload | { error: string } {
  try {
    const parsed = JSON.parse(payload);
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      typeof parsed.event !== 'object' ||
      parsed.event === null
    ) {
      return { error: 'Webhook payload is missing event.' };
    }
    return parsed as DropboxSignPayload;
  } catch {
    return { error: 'Webhook payload is not valid JSON.' };
  }
}

async function readJsonField(request: NextRequest): Promise<string | { error: string }> {
  const contentType = request.headers.get('content-type') ?? '';
  try {
    if (contentType.includes('multipart/form-data')) {
      const form = await request.formData();
      const raw = form.get('json');
      if (typeof raw !== 'string') return { error: 'Missing `json` form field.' };
      return raw;
    }
    if (contentType.includes('application/x-www-form-urlencoded')) {
      const text = await request.text();
      const params = new URLSearchParams(text);
      const raw = params.get('json');
      if (!raw) return { error: 'Missing `json` form field.' };
      return raw;
    }
    // Fall through to raw JSON body — useful for tests and for direct
    // event-object POSTs.
    return await request.text();
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : 'Failed to read request body.',
    };
  }
}

function signedPdfStorageKey(msaId: number): string {
  return `msa/${msaId}/signed.pdf`;
}

async function handleSigned(
  signatureRequestId: string,
  bucket: string,
): Promise<NextResponse> {
  // Look up the MSA so we know the id (for the GCS key) and can short-
  // circuit on replay (already-active rows skip the re-download + re-upload).
  const [msa] = await db
    .select({
      id: masterServiceAgreements.id,
      status: masterServiceAgreements.status,
    })
    .from(masterServiceAgreements)
    .where(
      eq(masterServiceAgreements.dropboxSignDocumentId, signatureRequestId),
    )
    .limit(1);
  if (!msa) {
    return new NextResponse('MSA not found for the supplied document id.', {
      status: 404,
    });
  }
  if (msa.status === 'active') {
    // Replay path: a duplicate `signature_request_all_signed` for an already-
    // active MSA. Idempotent 200 without re-downloading.
    return new NextResponse(ACK_BODY, { status: 200 });
  }
  if (msa.status !== 'pending') {
    // Row is in `expired` or `terminated` — refuse rather than overwrite a
    // terminal state.
    return new NextResponse(
      `MSA cannot be signed from status '${msa.status}'.`,
      { status: 409 },
    );
  }

  const signedFile = await getSignedFileBytes(signatureRequestId);
  if ('error' in signedFile) {
    console.error('getSignedFileBytes failed', signedFile.error);
    return new NextResponse(signedFile.error, { status: 502 });
  }

  const key = signedPdfStorageKey(msa.id);
  const uploaded = await putObject({
    bucket,
    key,
    body: signedFile.body,
    contentType: 'application/pdf',
  });
  if ('error' in uploaded) {
    console.error('signed-MSA upload failed', uploaded.error);
    return new NextResponse(uploaded.error, { status: 502 });
  }

  const flip = await markMsaSigned(signatureRequestId, key);
  if ('error' in flip) {
    // Race: the row was flipped to a non-pending status between our lookup
    // and the guarded UPDATE. Treat as a server-side error so Dropbox Sign
    // can retry (or not — the audit chain will reflect whatever happened).
    console.error('markMsaSigned failed', flip.error);
    return new NextResponse(flip.error, { status: 409 });
  }

  return new NextResponse(ACK_BODY, { status: 200 });
}

async function handleDeclined(signatureRequestId: string): Promise<NextResponse> {
  const result = await markMsaDeclined(signatureRequestId);
  if ('error' in result) {
    if (result.error.includes('not found')) {
      return new NextResponse(result.error, { status: 404 });
    }
    console.error('markMsaDeclined failed', result.error);
    return new NextResponse(ACK_BODY, { status: 200 });
  }
  return new NextResponse(ACK_BODY, { status: 200 });
}

// authz: public — Dropbox Sign webhook caller has no auth.users session;
// the gate is HMAC signature verification, performed below before any DB
// read or mutation. See the top-of-file comment for the full rationale.
export async function POST(request: NextRequest): Promise<NextResponse> {
  const secret = process.env.DROPBOX_SIGN_WEBHOOK_SECRET;
  if (!secret) {
    return new NextResponse('Server misconfigured.', { status: 500 });
  }

  const rawJson = await readJsonField(request);
  if (typeof rawJson === 'object') {
    return new NextResponse(rawJson.error, { status: 400 });
  }

  const parsed = parseJsonField(rawJson);
  if ('error' in parsed) {
    return new NextResponse(parsed.error, { status: 400 });
  }

  const verifyResult = verifyWebhookSignature(
    parsed.event.event_time,
    parsed.event.event_type,
    parsed.event.event_hash,
    secret,
  );
  if ('error' in verifyResult) {
    return new NextResponse(verifyResult.error, { status: 401 });
  }

  const eventType = parsed.event.event_type;
  const signatureRequestId = parsed.signature_request?.signature_request_id;

  // Non-MSA-lifecycle events (`callback_test`, `signature_request_sent`,
  // ...): ack and return. Only two event types flip MSA rows.
  if (
    eventType !== 'signature_request_all_signed' &&
    eventType !== 'signature_request_declined'
  ) {
    return new NextResponse(ACK_BODY, { status: 200 });
  }

  if (!signatureRequestId) {
    return new NextResponse('Missing signature_request.signature_request_id.', {
      status: 400,
    });
  }

  if (eventType === 'signature_request_declined') {
    return handleDeclined(signatureRequestId);
  }

  const bucket = process.env.GCS_BUCKET;
  if (!bucket) {
    return new NextResponse('GCS_BUCKET is not configured.', { status: 500 });
  }
  return handleSigned(signatureRequestId, bucket);
}
