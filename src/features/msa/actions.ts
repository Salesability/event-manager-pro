'use server';

import { revalidatePath } from 'next/cache';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { db } from '@/lib/db';
import { dealers, masterServiceAgreements, quotes } from '@/lib/db/schema';
import { capabilityClient, formDataSchema } from '@/lib/actions/action-client';
import { recordAudit } from '@/features/audit/actions';
import { field, parseId } from '@/features/schedule/validators';
import { renderMsaPdf, type MsaPdfData } from '@/lib/pdf/render-msa';
import { renderQuotePdf, type QuoteData, type QuoteLineItem } from '@/lib/pdf/render-quote';
import { putObject } from '@/lib/storage/gcs';
import { sendSignatureRequest } from '@/lib/dropbox-sign/client';
import { currentMsaTemplateVersion } from '@/lib/dropbox-sign/templates';
import { resolveQuoteRecipient } from '@/features/quotes/recipient';
import { MAX_ADDRESS_LINES } from '@/features/quotes/constants';
import type { ComputedLine } from '@/lib/quotes/pricing';

// 0041 Phase 3 — MSA send-side Server Actions. Companion to closed/0037
// Phase 2's `master_service_agreements` schema; this file is the first
// surface that writes rows. The actions:
//
//   1. `createMsaDraft(dealerId)` — capability-gated `msa:edit`. Stamps a
//      `pending` row with `templateVersion` from the env. Refuses if the
//      dealer already has a pending or active MSA (one MSA per dealer v1 per
//      plan body); expired/terminated rows allow a renewal-style fresh draft.
//   2. `sendMsaEnvelope(msaId, firstQuoteId)` — bundles the rendered MSA PDF
//      with the dealer's first draft Quote PDF, posts the envelope to
//      Dropbox Sign, persists the returned `dropboxSignDocumentId`, and
//      emits `msa.sent`.
//
// Atomic-transition shape mirrors `sendQuote`: pre-load the row, side-effect
// the API call, atomically guard the UPDATE on `dropboxSignDocumentId IS
// NULL` so a concurrent re-send raced past the read-then-write can't double-
// post. Idempotent on re-send when `dropboxSignDocumentId` is already set —
// returns `{ ok: true }` without re-calling the API.

type CreateMsaResult = { ok: true; msaId: number } | { error: string };
type SendMsaResult = { ok: true } | { error: string };

const MSA_DRAFT_GCS_KEY_PREFIX = 'msa';

function msaDraftPdfStorageKey(msaId: number): string {
  return `${MSA_DRAFT_GCS_KEY_PREFIX}/${msaId}/draft.pdf`;
}

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function isoDateOffset(base: Date, days: number): string {
  return new Date(base.getTime() + days * MS_PER_DAY).toISOString().slice(0, 10);
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

const CORRUPTED_LINES_ERROR = 'Quote line items are corrupted; cannot render.';

function isFiniteNonNegative(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n) && n >= 0;
}

type ValidatedLines = { ok: true; lines: QuoteLineItem[] } | { error: string };

function validatePersistedLines(raw: unknown): ValidatedLines {
  if (!Array.isArray(raw)) return { error: CORRUPTED_LINES_ERROR };
  const lines: QuoteLineItem[] = [];
  for (const item of raw) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      return { error: CORRUPTED_LINES_ERROR };
    }
    const l = item as Partial<ComputedLine>;
    if (
      typeof l.label !== 'string' ||
      l.label.trim().length === 0 ||
      !isFiniteNonNegative(l.qty) ||
      !isFiniteNonNegative(l.unitPrice) ||
      !isFiniteNonNegative(l.lineTotal)
    ) {
      return { error: CORRUPTED_LINES_ERROR };
    }
    lines.push({
      description: l.label,
      quantity: l.qty,
      unitPrice: l.unitPrice,
      total: l.lineTotal,
    });
  }
  return { ok: true, lines };
}

// V1: blocks new draft creation when a pending/active MSA already exists for
// this dealer. Expired/terminated rows allow renewal-style fresh drafts.
const BLOCKING_STATUSES = ['pending', 'active'] as const;

// validation: skip — id-only action (dealerId + firstQuoteId); `parseId`
// covers both. Could be moved onto a schema if more fields surface.
export const createMsaDraft = capabilityClient('msa:edit')
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
export const sendMsaEnvelope = capabilityClient('msa:edit')
  .schema(formDataSchema)
  .action(async ({ parsedInput: formData, ctx }): Promise<SendMsaResult> => {
    const userId = ctx.user.id;

    const msaId = parseId(formData, 'msaId');
    if (msaId == null) return { error: 'Invalid MSA id.' };
    const firstQuoteId = parseId(formData, 'firstQuoteId');
    if (firstQuoteId == null) return { error: 'Invalid quote id.' };

    const bucket = process.env.GCS_BUCKET;
    if (!bucket) {
      return { error: 'GCS_BUCKET is not configured; cannot persist MSA PDF.' };
    }

    // Pre-load the MSA + the dealer + the first Quote. Early-fail on any
    // mismatch before calling the Dropbox Sign API or rendering anything.
    const [msa] = await db
      .select({
        id: masterServiceAgreements.id,
        dealerId: masterServiceAgreements.dealerId,
        status: masterServiceAgreements.status,
        templateVersion: masterServiceAgreements.templateVersion,
        dropboxSignDocumentId: masterServiceAgreements.dropboxSignDocumentId,
      })
      .from(masterServiceAgreements)
      .where(eq(masterServiceAgreements.id, msaId))
      .limit(1);
    if (!msa) return { error: 'MSA not found.' };

    // Idempotent re-send: if the envelope was already posted, the row carries
    // a `dropboxSignDocumentId`. Return ok without re-calling the API.
    if (msa.dropboxSignDocumentId) return { ok: true };

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

    const [quote] = await db
      .select({
        id: quotes.id,
        dealerId: quotes.dealerId,
        status: quotes.status,
        quoteValidDays: quotes.quoteValidDays,
        lineItems: quotes.lineItems,
        subtotal: quotes.subtotal,
        tax: quotes.tax,
        total: quotes.total,
      })
      .from(quotes)
      .where(eq(quotes.id, firstQuoteId))
      .limit(1);
    if (!quote) return { error: 'Quote not found.' };
    if (quote.dealerId !== msa.dealerId) {
      return { error: 'Quote does not belong to the MSA dealer.' };
    }
    if (quote.status !== 'draft') {
      return { error: `Quote must be in draft (got '${quote.status}').` };
    }

    const recipientResult = await resolveQuoteRecipient(msa.dealerId);
    if ('error' in recipientResult) return recipientResult;
    const recipient = recipientResult.recipient;

    // Render the MSA PDF.
    const issuedDate = todayIsoDate();
    const msaData: MsaPdfData = {
      msaNumber: String(msaId),
      issuedDate,
      clientName: dealer.name,
      clientAddress: splitClientAddress(dealer.address),
      signerName: recipient.firstName,
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

    // Render the Quote PDF from the persisted snapshot.
    const linesResult = validatePersistedLines(quote.lineItems);
    if ('error' in linesResult) return linesResult;
    // Quote is still a draft here (MSA bundles include the first draft quote
    // alongside the agreement). Anchor "Valid until" on today since the row
    // isn't sent yet — the date will continue to render this way when
    // sendQuote eventually flips the row.
    const quoteData: QuoteData = {
      quoteNumber: String(quote.id),
      issuedDate,
      validUntilDate: isoDateOffset(new Date(), quote.quoteValidDays),
      clientName: dealer.name,
      clientAddress: splitClientAddress(dealer.address),
      eventName: 'Sales Event',
      lineItems: linesResult.lines,
      subtotal: Number(quote.subtotal),
      tax: Number(quote.tax),
      total: Number(quote.total),
    };
    const quotePdf = await renderQuotePdf(quoteData);
    if ('error' in quotePdf) {
      return { error: `Quote PDF render failed: ${quotePdf.error}` };
    }

    // Persist the draft MSA PDF to GCS before the envelope post — the row's
    // `dropboxSignDocumentId` lookup at webhook time only needs the signed
    // bytes, but archiving the draft makes "what did the signer see?" easy
    // to answer if a dispute lands.
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

    // Post the envelope to Dropbox Sign.
    const customMessage = field(formData, 'message');
    const sendResult = await sendSignatureRequest({
      subject: `Master Service Agreement — ${dealer.name}`,
      message:
        customMessage ||
        `Please review and sign your Salesability Master Service Agreement (#${msaId}) and your first Quote (#${quote.id}).`,
      signer: { emailAddress: recipient.email, name: recipient.firstName },
      files: [
        { filename: `msa-${msaId}.pdf`, body: msaPdf.body },
        { filename: `quote-${quote.id}.pdf`, body: quotePdf.body },
      ],
      metadata: { msaId: String(msaId), quoteId: String(quote.id) },
    });
    if ('error' in sendResult) {
      return { error: `Dropbox Sign send failed: ${sendResult.error}` };
    }

    // Atomic guarded persist: only set the document id when it was still
    // unset; a concurrent re-send raced past the read-then-write window
    // becomes a no-op idempotent return.
    const updated = await db
      .update(masterServiceAgreements)
      .set({
        dropboxSignDocumentId: sendResult.signatureRequestId,
        updatedById: userId,
      })
      .where(
        and(
          eq(masterServiceAgreements.id, msaId),
          eq(masterServiceAgreements.status, 'pending'),
          isNull(masterServiceAgreements.dropboxSignDocumentId),
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
        quoteId: quote.id,
        signatureRequestId: sendResult.signatureRequestId,
        draftPdfStorageKey: draftKey,
      },
    });

    revalidateMsaViews();
    return { ok: true };
  });
