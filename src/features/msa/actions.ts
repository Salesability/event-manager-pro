'use server';

import { revalidatePath } from 'next/cache';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { db } from '@/lib/db';
import { dealers, masterServiceAgreements } from '@/lib/db/schema';
import { capabilityClient, formDataSchema } from '@/lib/actions/action-client';
import { recordAudit } from '@/features/audit/actions';
import { field, parseId } from '@/features/schedule/validators';
import { renderMsaPdf, type MsaPdfData } from '@/lib/pdf/render-msa';
import { putObject } from '@/lib/storage/gcs';
import { sendSignatureRequest } from '@/lib/boldsign/client';
import { currentMsaTemplateVersion } from './template-version';
import { resolveQuoteRecipient } from '@/features/quotes/recipient';
import { MAX_ADDRESS_LINES } from '@/features/quotes/constants';
import { testMsaFormSchema } from './test-msa-schema';

// 0041 Phase 3 — MSA send-side Server Actions. Companion to closed/0037
// Phase 2's `master_service_agreements` schema; this file is the first
// surface that writes rows. The actions:
//
//   1. `createMsaDraft(dealerId)` — capability-gated `admin:access` (0082: the
//      send action lives only on the admin-only dealer page, so the Server
//      Action matches — MSA = the once-per-Client master contract). Stamps a
//      `pending` row with `templateVersion` from the env. Refuses if the
//      dealer already has a pending or active MSA (one MSA per dealer v1 per
//      plan body); expired/terminated rows allow a renewal-style fresh draft.
//   2. `sendMsaEnvelope(msaId)` — `admin:access` too. Renders the MSA PDF on
//      its own (0082: the quote is no longer bundled in), posts a single-file
//      MSA-only envelope to BoldSign, persists the returned `providerDocumentId`,
//      and emits `msa.sent`. The quote follows its own send→accept lifecycle;
//      signing the MSA flips only the MSA.
//
// Atomic-transition shape mirrors `sendQuote`: pre-load the row, side-effect
// the API call, atomically guard the UPDATE on `providerDocumentId IS
// NULL` so a concurrent re-send raced past the read-then-write can't double-
// post. Idempotent on re-send when `providerDocumentId` is already set —
// returns `{ ok: true }` without re-calling the API.

type CreateMsaResult = { ok: true; msaId: number } | { error: string };
type SendMsaResult = { ok: true } | { error: string };
// Test tool surfaces the BoldSign documentId (proof of send) — distinct from
// SendMsaResult, whose callers don't display the id (0067).
type SendTestMsaResult = { ok: true; documentId: string } | { error: string };

const MSA_DRAFT_GCS_KEY_PREFIX = 'msa';

function msaDraftPdfStorageKey(msaId: number): string {
  return `${MSA_DRAFT_GCS_KEY_PREFIX}/${msaId}/draft.pdf`;
}

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function plus12Months(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCFullYear(d.getUTCFullYear() + 1);
  return d.toISOString().slice(0, 10);
}

function revalidateMsaViews() {
  revalidatePath('/dealerships');
}

function splitClientAddress(address: string | null): string[] | undefined {
  if (!address) return undefined;
  const lines = address
    .split(/\r?\n/)
    .map((s) => s.trim().slice(0, 120))
    .filter(Boolean)
    .slice(0, MAX_ADDRESS_LINES);
  return lines.length ? lines : undefined;
}

// V1: blocks new draft creation when a pending/active MSA already exists for
// this dealer. Expired/terminated rows allow renewal-style fresh drafts.
const BLOCKING_STATUSES = ['pending', 'active'] as const;

// validation: skip — id-only action (dealerId); `parseId` covers it. Could be
// moved onto a schema if more fields surface.
export const createMsaDraft = capabilityClient('admin:access')
  .schema(formDataSchema)
  .action(async ({ parsedInput: formData, ctx }): Promise<CreateMsaResult> => {
    const userId = ctx.user.id;

    const dealerId = parseId(formData, 'dealerId');
    if (dealerId == null) return { error: 'Dealer is required.' };

    const version = currentMsaTemplateVersion();
    if (typeof version === 'object') return version;

    // FOR UPDATE on the dealer row prevents a concurrent archive racing past
    // the active-dealer check; the existing-MSA check inside the same tx
    // closes the create-then-create double-MSA race for the same dealer.
    const result = await db.transaction(async (tx) => {
      const [dealer] = await tx
        .select({ id: dealers.id })
        .from(dealers)
        .where(and(eq(dealers.id, dealerId), isNull(dealers.archivedAt)))
        .for('update')
        .limit(1);
      if (!dealer) {
        return { ok: false as const, error: 'Dealer not found or archived.' };
      }

      const existing = await tx
        .select({ id: masterServiceAgreements.id })
        .from(masterServiceAgreements)
        .where(
          and(
            eq(masterServiceAgreements.dealerId, dealerId),
            inArray(masterServiceAgreements.status, [...BLOCKING_STATUSES]),
          ),
        )
        .limit(1);
      if (existing.length) {
        return {
          ok: false as const,
          error: 'Dealer already has a pending or active MSA.',
        };
      }

      const [inserted] = await tx
        .insert(masterServiceAgreements)
        .values({
          dealerId,
          templateVersion: version,
          createdById: userId,
          updatedById: userId,
        })
        .returning({ id: masterServiceAgreements.id });
      return { ok: true as const, msaId: inserted.id };
    });

    if (!result.ok) return { error: result.error };

    await recordAudit({
      action: 'msa.created',
      targetTable: 'master_service_agreements',
      targetId: result.msaId,
      payload: { dealerId, templateVersion: version },
    });

    revalidateMsaViews();
    return { ok: true, msaId: result.msaId };
  });

// validation: skip — id-only action (msaId + free-text message); `parseId`
// covers msaId.
export const sendMsaEnvelope = capabilityClient('admin:access')
  .schema(formDataSchema)
  .action(async ({ parsedInput: formData, ctx }): Promise<SendMsaResult> => {
    const userId = ctx.user.id;

    const msaId = parseId(formData, 'msaId');
    if (msaId == null) return { error: 'Invalid MSA id.' };

    const bucket = process.env.GCS_BUCKET;
    if (!bucket) {
      return { error: 'GCS_BUCKET is not configured; cannot persist MSA PDF.' };
    }

    // Pre-load the MSA + the dealer. Early-fail on any mismatch before calling
    // the BoldSign API or rendering anything.
    const [msa] = await db
      .select({
        id: masterServiceAgreements.id,
        dealerId: masterServiceAgreements.dealerId,
        status: masterServiceAgreements.status,
        templateVersion: masterServiceAgreements.templateVersion,
        providerDocumentId: masterServiceAgreements.providerDocumentId,
      })
      .from(masterServiceAgreements)
      .where(eq(masterServiceAgreements.id, msaId))
      .limit(1);
    if (!msa) return { error: 'MSA not found.' };

    // Idempotent re-send: if the envelope was already posted, the row carries
    // a `providerDocumentId`. Return ok without re-calling the API.
    if (msa.providerDocumentId) return { ok: true };

    if (msa.status !== 'pending') {
      return { error: `MSA cannot be sent from status '${msa.status}'.` };
    }

    const [dealer] = await db
      .select({
        id: dealers.id,
        name: dealers.name,
        address: dealers.address,
      })
      .from(dealers)
      .where(and(eq(dealers.id, msa.dealerId), isNull(dealers.archivedAt)))
      .limit(1);
    if (!dealer) return { error: 'Dealer not found or archived.' };

    const recipientResult = await resolveQuoteRecipient(msa.dealerId);
    if ('error' in recipientResult) return recipientResult;
    const recipient = recipientResult.recipient;

    // Full legal name (first + last) — a first name alone is not legally
    // binding (0099, legal review). Feeds both the printed signature block and
    // the BoldSign `signer.name`, so BoldSign's adopted-signature default is the
    // full name. Falls back to the first name if the last name is blank.
    const signerFullName =
      [recipient.firstName, recipient.lastName]
        .map((s) => s?.trim())
        .filter(Boolean)
        .join(' ') || recipient.firstName;

    // Render the MSA PDF.
    const issuedDate = todayIsoDate();
    const msaData: MsaPdfData = {
      msaNumber: String(msaId),
      issuedDate,
      clientName: dealer.name,
      clientAddress: splitClientAddress(dealer.address),
      signerName: signerFullName,
      signerEmail: recipient.email,
      termStart: issuedDate,
      termEnd: plus12Months(issuedDate),
      terminationNoticeDays: 30,
      governingLaw: 'Nova Scotia, Canada',
      templateVersion: msa.templateVersion,
    };
    const msaPdf = await renderMsaPdf(msaData);
    if ('error' in msaPdf) {
      return { error: `MSA PDF render failed: ${msaPdf.error}` };
    }

    // Persist the MSA draft to GCS before the envelope post — archiving the
    // exact document the signer received makes "what did they sign?" easy to
    // answer if a dispute lands. 0082: MSA-only artifact (the quote is no
    // longer bundled in; it has its own send→accept lifecycle).
    const draftKey = msaDraftPdfStorageKey(msaId);
    const draftUpload = await putObject({
      bucket,
      key: draftKey,
      body: msaPdf.body,
      contentType: 'application/pdf',
    });
    if ('error' in draftUpload) {
      return { error: `MSA draft upload failed: ${draftUpload.error}` };
    }

    // Post a single-file MSA-only envelope to BoldSign: the document carries
    // the Client's Signature at the end. The anchor comes from the MSA render.
    const customMessage = field(formData, 'message');
    const sendResult = await sendSignatureRequest({
      subject: `Master Service Agreement — ${dealer.name}`,
      message:
        customMessage ||
        `Please review and sign your Salesability Master Service Agreement (#${msaId}). Sign at the end.`,
      signer: { emailAddress: recipient.email, name: signerFullName },
      files: [{ filename: `agreement-${msaId}.pdf`, body: msaPdf.body }],
      signatureAnchor: msaPdf.signatureAnchor,
      printedNameAnchor: msaPdf.printedNameAnchor,
      titleAnchor: msaPdf.titleAnchor,
      metadata: { msaId: String(msaId) },
    });
    if ('error' in sendResult) {
      return { error: `BoldSign send failed: ${sendResult.error}` };
    }

    // Atomic guarded persist: only set the document id when it was still
    // unset; a concurrent re-send raced past the read-then-write window
    // becomes a no-op idempotent return.
    const updated = await db
      .update(masterServiceAgreements)
      .set({
        providerDocumentId: sendResult.documentId,
        updatedById: userId,
      })
      .where(
        and(
          eq(masterServiceAgreements.id, msaId),
          eq(masterServiceAgreements.status, 'pending'),
          isNull(masterServiceAgreements.providerDocumentId),
        ),
      )
      .returning({ id: masterServiceAgreements.id });
    if (!updated.length) {
      // Another concurrent caller already won the race. Treat as idempotent
      // success — both callers see the same envelope sent.
      revalidateMsaViews();
      return { ok: true };
    }

    await recordAudit({
      action: 'msa.sent',
      targetTable: 'master_service_agreements',
      targetId: msaId,
      payload: {
        dealerId: msa.dealerId,
        providerDocumentId: sendResult.documentId,
        draftPdfStorageKey: draftKey,
      },
    });

    revalidateMsaViews();
    return { ok: true };
  });

// 0067: admin BoldSign-verification tool. Renders the MSA prose with
// placeholder data (NO `master_service_agreements` row, no quote bundle) and
// posts a real envelope via `sendSignatureRequest`, surfacing the BoldSign
// `documentId`. In prod (`APP_ENV=production`) this is a real, non-sandbox send
// to the typed recipient — that's the point: verify production BoldSign
// end-to-end. Reuses the same `isSandbox`/dev-redirect gate
// `sendSignatureRequest` owns (non-prod → sandbox + `EMAIL_DEV_TO` redirect,
// refused if unset). Gated `admin:access` (admin-only), NOT `msa:edit` —
// `msa:edit` also admits coaches, and this sends real prod envelopes, so it's
// an admin-only diagnostic. The `test: 'true'` metadata lets the webhook ack a
// signed test envelope instead of 404ing on the missing MSA row.
export const sendTestMsa = capabilityClient('admin:access')
  .schema(formDataSchema)
  .action(async ({ parsedInput: formData }): Promise<SendTestMsaResult> => {
    const parsed = testMsaFormSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) {
      const fieldErrors = parsed.error.flatten().fieldErrors;
      const firstErr = Object.values(fieldErrors).flat().find(Boolean);
      return { error: firstErr ?? 'Invalid test-MSA input.' };
    }
    const { to, signerName, message } = parsed.data;

    const templateVersion = currentMsaTemplateVersion();
    if (typeof templateVersion !== 'string') return templateVersion;

    const issuedDate = todayIsoDate();
    const msaData: MsaPdfData = {
      msaNumber: 'TEST',
      issuedDate,
      clientName: 'TEST — BoldSign smoke (not a real agreement)',
      signerName,
      signerEmail: to,
      termStart: issuedDate,
      termEnd: plus12Months(issuedDate),
      terminationNoticeDays: 30,
      governingLaw: 'Nova Scotia, Canada',
      templateVersion,
    };
    const msaPdf = await renderMsaPdf(msaData);
    if ('error' in msaPdf) {
      return { error: `MSA PDF render failed: ${msaPdf.error}` };
    }

    const sendResult = await sendSignatureRequest({
      subject: 'TEST — Salesability Master Service Agreement (BoldSign smoke)',
      message:
        message ||
        'This is a TEST envelope to verify BoldSign e-signature. Not a real agreement — no obligation.',
      signer: { emailAddress: to, name: signerName },
      files: [{ filename: 'test-msa.pdf', body: msaPdf.body }],
      signatureAnchor: msaPdf.signatureAnchor,
      printedNameAnchor: msaPdf.printedNameAnchor,
      titleAnchor: msaPdf.titleAnchor,
      metadata: { test: 'true' },
    });
    if ('error' in sendResult) {
      return { error: `BoldSign send failed: ${sendResult.error}` };
    }
    return { ok: true, documentId: sendResult.documentId };
  });
