import { NextResponse, type NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { masterServiceAgreements } from '@/lib/db/schema';
import { putObject } from '@/lib/storage/gcs';
import { getSignedFileBytes } from '@/lib/boldsign/client';
import { verifyWebhookSignature } from '@/lib/boldsign/webhook-verify';
import { markMsaDeclined, markMsaSigned } from '@/features/msa/lifecycle';

// authz: public — BoldSign webhook caller has no auth.users session.
// Gate is HMAC-SHA256 signature verification against
// BOLDSIGN_WEBHOOK_SECRET, performed BEFORE any read or mutation per
// D #4 in `docs/chunks/0051-dropbox-sign-to-boldsign/intent.md` (and
// CLAUDE.md → "Mutations go through Server Actions" — this is the rare
// external-caller exception that warrants a route handler).
//
// BoldSign POSTs `application/json` directly with this shape:
//   {
//     event: { id, eventType: 'Signed' | 'Declined' | ..., created, environment },
//     data:  { documentId, documentDescription, documentStatus, ... }
//   }
//
// The signed payload is `<t-from-header> + "." + <raw-body>` (Stripe-style).
// The header `X-BoldSign-Signature` carries `t=<epoch>, s0=<hex>[, s1=<hex>]`.
// We must read the raw bytes (request.text()) and verify BEFORE JSON.parse —
// parse-then-reserialize would break the HMAC.
//
// BoldSign expects a 2xx response on receipt; it retries on non-2xx.

type BoldSignEvent = {
  id?: string;
  eventType: string;
  created?: number;
  environment?: string;
};

type BoldSignData = {
  documentId?: string;
};

type BoldSignPayload = {
  event: BoldSignEvent;
  data?: BoldSignData;
};

function parsePayload(rawBody: string): BoldSignPayload | { error: string } {
  try {
    const parsed = JSON.parse(rawBody);
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      typeof parsed.event !== 'object' ||
      parsed.event === null ||
      typeof parsed.event.eventType !== 'string'
    ) {
      return { error: 'Webhook payload is missing event.eventType.' };
    }
    return parsed as BoldSignPayload;
  } catch {
    return { error: 'Webhook payload is not valid JSON.' };
  }
}

function signedPdfStorageKey(msaId: number): string {
  return `msa/${msaId}/signed.pdf`;
}

async function handleSigned(
  documentId: string,
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
    .where(eq(masterServiceAgreements.dropboxSignDocumentId, documentId))
    .limit(1);
  if (!msa) {
    return new NextResponse('MSA not found for the supplied document id.', {
      status: 404,
    });
  }
  if (msa.status === 'active') {
    return new NextResponse('OK', { status: 200 });
  }
  if (msa.status !== 'pending') {
    return new NextResponse(
      `MSA cannot be signed from status '${msa.status}'.`,
      { status: 409 },
    );
  }

  const signedFile = await getSignedFileBytes(documentId);
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

  const flip = await markMsaSigned(documentId, key);
  if ('error' in flip) {
    console.error('markMsaSigned failed', flip.error);
    return new NextResponse(flip.error, { status: 409 });
  }

  return new NextResponse('OK', { status: 200 });
}

async function handleDeclined(documentId: string): Promise<NextResponse> {
  const result = await markMsaDeclined(documentId);
  if ('error' in result) {
    if (result.error.includes('not found')) {
      return new NextResponse(result.error, { status: 404 });
    }
    console.error('markMsaDeclined failed', result.error);
    return new NextResponse('OK', { status: 200 });
  }
  return new NextResponse('OK', { status: 200 });
}

// authz: public — BoldSign webhook caller has no auth.users session;
// the gate is HMAC-SHA256 signature verification on the raw body,
// performed before any DB read or mutation.
export async function POST(request: NextRequest): Promise<NextResponse> {
  const secret = process.env.BOLDSIGN_WEBHOOK_SECRET;
  if (!secret) {
    return new NextResponse('Server misconfigured.', { status: 500 });
  }

  let rawBody: string;
  try {
    rawBody = await request.text();
  } catch (err) {
    return new NextResponse(
      err instanceof Error ? err.message : 'Failed to read body.',
      { status: 400 },
    );
  }

  const signatureHeader = request.headers.get('x-boldsign-signature');
  const verifyResult = verifyWebhookSignature(rawBody, signatureHeader, secret);
  if ('error' in verifyResult) {
    return new NextResponse(verifyResult.error, { status: 401 });
  }

  const parsed = parsePayload(rawBody);
  if ('error' in parsed) {
    return new NextResponse(parsed.error, { status: 400 });
  }

  const eventType = parsed.event.eventType;
  const documentId = parsed.data?.documentId;

  // Non-MSA-lifecycle events (`SenderIdentityUpdated`, etc.): ack 200.
  if (eventType !== 'Signed' && eventType !== 'Declined') {
    return new NextResponse('OK', { status: 200 });
  }

  if (!documentId) {
    return new NextResponse('Missing data.documentId.', { status: 400 });
  }

  if (eventType === 'Declined') {
    return handleDeclined(documentId);
  }

  const bucket = process.env.GCS_BUCKET;
  if (!bucket) {
    return new NextResponse('GCS_BUCKET is not configured.', { status: 500 });
  }
  return handleSigned(documentId, bucket);
}
