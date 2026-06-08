'use server';

import { revalidatePath } from 'next/cache';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { db } from '@/lib/db';
import { dealers, masterServiceAgreements, quotes } from '@/lib/db/schema';
import { capabilityClient, formDataSchema } from '@/lib/actions/action-client';
import { recordAudit } from '@/features/audit/actions';
import { field, parseId } from '@/features/schedule/validators';
import { renderMsaPdf, type MsaPdfData } from '@/lib/pdf/render-msa';
import { renderQuotePdf, type QuoteData } from '@/lib/pdf/render-quote';
import { combineQuoteAndMsa } from '@/lib/pdf/merge';
import { quoteDisplayName } from '@/features/quotes/display-name';
import { putObject } from '@/lib/storage/gcs';
import { sendSignatureRequest } from '@/lib/boldsign/client';
import { currentMsaTemplateVersion } from './template-version';
import { resolveQuoteRecipient } from '@/features/quotes/recipient';
import { MAX_ADDRESS_LINES } from '@/features/quotes/constants';
import { mapRenderLines, renderLinesColumn } from '@/lib/quotes/render-lines';
import { testMsaFormSchema } from './test-msa-schema';

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
//      BoldSign, persists the returned `providerDocumentId`, and
//      emits `msa.sent`.
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
    // mismatch before calling the BoldSign API or rendering anything.
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

    const [quote] = await db
      .select({
        id: quotes.id,
        dealerId: quotes.dealerId,
        status: quotes.status,
        createdAt: quotes.createdAt,
        quoteValidDays: quotes.quoteValidDays,
        renderLines: renderLinesColumn,
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
    if (quote.status !== 'draft' && quote.status !== 'sent') {
      return { error: `Quote must be in draft or sent (got '${quote.status}').` };
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

    // Render the Quote PDF from the persisted line rows (0062 — read inline
    // from quote_line_items via the renderLines subquery on the quote select).
    const renderLines = mapRenderLines(quote.renderLines);
    // The bundled quote may be draft OR sent (0061 — the coach can email it
    // for review first, then send the same quote for signature). Anchor
    // "Valid until" on today; a quote that was already sent may render a
    // slightly different deadline in this envelope PDF than in its review
    // email (parked 0044 follow-up (a) — out of scope here).
    const quoteData: QuoteData = {
      createdAt: quote.createdAt,
      issuedDate,
      validUntilDate: isoDateOffset(new Date(), quote.quoteValidDays),
      clientName: dealer.name,
      clientAddress: splitClientAddress(dealer.address),
      eventName: 'Sales Event',
      lineItems: renderLines,
      subtotal: Number(quote.subtotal),
      tax: Number(quote.tax),
      total: Number(quote.total),
    };
    const quotePdf = await renderQuotePdf(quoteData, { withInitials: true });
    if ('error' in quotePdf) {
      return { error: `Quote PDF render failed: ${quotePdf.error}` };
    }

    // Combine into ONE signable document (chunk 0055): Quote first (the Client
    // initials it), Agreement last (signed at the very bottom — "one and
    // done"). The signature anchor shifts past the Quote pages; the Quote's
    // initials anchor carries over unchanged.
    const combined = await combineQuoteAndMsa(
      { body: quotePdf.body, initialsAnchor: quotePdf.initialsAnchor },
      { body: msaPdf.body, signatureAnchor: msaPdf.signatureAnchor },
    );
    if ('error' in combined) {
      return { error: `Combine failed: ${combined.error}` };
    }

    // Persist the combined draft to GCS before the envelope post — archiving
    // the exact document the signer received makes "what did they sign?" easy
    // to answer if a dispute lands. Single artifact now (no separate MSA file).
    const draftKey = msaDraftPdfStorageKey(msaId);
    const draftUpload = await putObject({
      bucket,
      key: draftKey,
      body: combined.body,
      contentType: 'application/pdf',
    });
    if ('error' in draftUpload) {
      return { error: `MSA draft upload failed: ${draftUpload.error}` };
    }

    // Post a single-file envelope to BoldSign: the combined document carries
    // the Client's Initial field(s) on the Quote section and the Signature at
    // the end. Anchors come from the merge step (already in merged-doc coords).
    const customMessage = field(formData, 'message');
    const sendResult = await sendSignatureRequest({
      subject: `Master Service Agreement — ${dealer.name}`,
      message:
        customMessage ||
        `Please review and sign your Salesability Master Service Agreement (#${msaId}), which includes your Quote (${quoteDisplayName(quote.createdAt)}). Initial the Quote and sign at the end.`,
      signer: { emailAddress: recipient.email, name: recipient.firstName },
      files: [{ filename: `agreement-${msaId}.pdf`, body: combined.body }],
      signatureAnchor: combined.signatureAnchor,
      initialsAnchors: combined.initialsAnchors,
      metadata: { msaId: String(msaId), quoteId: String(quote.id) },
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

    // Link the bundled Quote to this MSA so the signed-webhook can auto-accept
    // it (chunk 0055). Guarded on draft|sent + unset link (0061), so a quote
    // that has since reached a terminal status, or is already linked, is a
    // no-op.
    await db
      .update(quotes)
      .set({ msaId, updatedById: userId })
      .where(
        and(
          eq(quotes.id, quote.id),
          inArray(quotes.status, ['draft', 'sent']),
          isNull(quotes.msaId),
        ),
      );

    await recordAudit({
      action: 'msa.sent',
      targetTable: 'master_service_agreements',
      targetId: msaId,
      payload: {
        dealerId: msa.dealerId,
        quoteId: quote.id,
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
      metadata: { test: 'true' },
    });
    if ('error' in sendResult) {
      return { error: `BoldSign send failed: ${sendResult.error}` };
    }
    return { ok: true, documentId: sendResult.documentId };
  });
