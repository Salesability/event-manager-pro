'use server';

import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { dealers, masterServiceAgreements, quoteAttachments, quoteLineItems, quotes, serviceItems } from '@/lib/db/schema';
import { capabilityClient, formDataSchema } from '@/lib/actions/action-client';
import { dealerTaxRatePct } from '@/features/tax-rates/queries';
import { recordAudit } from '@/features/audit/actions';
import { field, parseId } from '@/features/schedule/validators';
import {
  computePickedTotals,
  DEFAULT_QUOTE_INPUTS,
  MAX_DOLLARS,
  QuoteInputsError,
  type PickedLine,
  type PickedQuoteComputation,
  type QuoteInputs,
} from '@/lib/quotes/pricing';
import { lineFingerprint, mapRenderLines, renderLinesColumn } from '@/lib/quotes/render-lines';
import type { ServiceItem } from '@/features/services/queries';
import { renderQuotePdf, type QuoteData } from '@/lib/pdf/render-quote';
import { deleteObject, getObject, putObject, signedUrl } from '@/lib/storage/gcs';
import {
  ATTACHMENT_TYPE_LABELS,
  attachmentStorageKey,
  cleanDisplayFilename,
  isAllowedAttachmentType,
  MAX_ATTACHMENT_BYTES,
  MAX_TOTAL_ATTACHMENT_BYTES,
  formatBytes,
  type QuoteAttachmentView,
} from './attachments';
import { sendEmail, type SendAttachment } from '@/lib/email/send';
import { quoteEmail } from '@/lib/email/templates/quote';
import { markQuoteAccepted, markQuoteDeclined } from './lifecycle';
import { MAX_ADDRESS_LINES } from './constants';
import { resolveQuoteRecipient } from './recipient';
import { quoteDownloadFilename } from './display-name';

// 0026 Phase 2 — `quotes` data model + bare-bones Server Actions.
//
// Scope: `createQuote` stands up a draft row with zeroed inputs/totals; the
// composer (0035 Phase 3) extends this file with `setQuoteInputs` +
// `setQuoteDealer` setters that recompute lines + totals and persist them
// (0080 retired `setQuoteTax` — tax is always the auto province rate).
// `sendQuote` is the lifecycle-transition action — Phase 3
// wires `renderQuotePdf` + GCS storage; Phase 4 wires the email send + the
// public accept/decline route handler. For now `sendQuote` is idempotent on
// the `draft → sent` transition and emits the `quote.sent` audit row; PDF +
// email land in subsequent phases (TODOs flagged inline).
//
// `declineQuote` is the staff-side decline; the client-side decline goes
// through the public /quote/[token] route handler in Phase 4, which calls
// `markQuoteDeclined` (in ./lifecycle.ts) after token validation. The
// internal helpers live in a separate non-`'use server'` module so the
// action-gate lint rule (0031) doesn't flag them as ungated Server Actions.
//
// **Concurrency:** lifecycle transitions use the same atomic guarded UPDATE
// pattern as `cancelCampaign` — `UPDATE … WHERE id = X AND status = from
// RETURNING id`. Returns-empty means the guard missed; re-select then
// classifies the miss as row-gone / idempotent / illegal-status.

type ActionResult =
  | { ok: true }
  | { error: string; fieldErrors?: Record<string, string[] | undefined> };
type CreateQuoteResult =
  | { ok: true; quoteId: number }
  | { error: string; fieldErrors?: Record<string, string[] | undefined> };

// 0035 P3: `DEFAULT_QUOTE_INPUTS` was inlined here in 0026 P2; moved to
// src/lib/quotes/pricing.ts so the composer + action layer share the same
// default shape.

function revalidateQuoteViews() {
  revalidatePath('/quotes');
  revalidatePath('/production');
}

async function loadActiveCatalog(): Promise<ServiceItem[]> {
  return db
    .select({
      id: serviceItems.id,
      code: serviceItems.code,
      label: serviceItems.label,
      unitPrice: serviceItems.unitPrice,
      description: serviceItems.description,
      sortOrder: serviceItems.sortOrder,
    })
    .from(serviceItems)
    .where(isNull(serviceItems.archivedAt));
}

function moneyString(n: number): string {
  return n.toFixed(2);
}

function roundCents(n: number): number {
  return Math.round(n * 100) / 100;
}

// Tax dollars = subtotal × the dealer's province rate. 0080 removed the manual
// per-quote override (QuickBooks owns the rate), so there is no override branch.
function resolveTaxAmount(subtotal: number, ratePct: number): number {
  return roundCents(subtotal * (ratePct / 100));
}

// 0065: snapshot string for `tax_pct` (numeric(6,3)).
function pctString(ratePct: number): string {
  return ratePct.toFixed(3);
}

// === 0062: SKU line-item picker write path ================================
// The composer (Phase 5) submits a `lines` JSON payload — picked SKUs with a
// per-line quantity and (effective) price — instead of the calculator's
// structured `inputs`. The server resolves each line against the live
// catalogue to snapshot code/label/description/unitPrice, derives the
// per-quote override from the typed price, recomputes totals, and
// delete-and-inserts the `quote_line_items` rows — the sole source of truth
// (the former `quotes.line_items` jsonb mirror was dropped in Phase 7; every
// render path now reads the table via the `renderLines` subquery). `quoteNotes`
// is the one input the composer still owns — merged onto the preserved
// `inputs` snapshot.

type PickedLineInput = { serviceItemId: number; qty: number; price: number };

const MAX_QTY = 1_000_000;

// Parse the `lines` payload. Empty/absent → [] (a picker quote may be empty at
// save time; the send path guards emptiness). Fails closed on malformed shape.
function parsePickedLineInputs(
  formData: FormData,
): { ok: true; data: PickedLineInput[] } | { ok: false; error: string } {
  const raw = field(formData, 'lines');
  if (!raw) return { ok: true, data: [] };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, error: 'Lines payload is not valid JSON.' };
  }
  if (!Array.isArray(parsed)) {
    return { ok: false, error: 'Lines must be an array.' };
  }
  const out: PickedLineInput[] = [];
  for (const item of parsed) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      return { ok: false, error: 'Each line must be an object.' };
    }
    const o = item as Record<string, unknown>;
    if (
      typeof o.serviceItemId !== 'number' ||
      !Number.isInteger(o.serviceItemId) ||
      o.serviceItemId <= 0
    ) {
      return { ok: false, error: 'Each line needs a valid serviceItemId.' };
    }
    if (
      typeof o.qty !== 'number' ||
      !Number.isInteger(o.qty) ||
      o.qty < 1 ||
      o.qty > MAX_QTY
    ) {
      return { ok: false, error: 'Each line needs an integer quantity between 1 and 1,000,000.' };
    }
    if (typeof o.price !== 'number' || !Number.isFinite(o.price) || o.price < 0 || o.price > MAX_DOLLARS) {
      return { ok: false, error: `Each line price must be between 0 and ${MAX_DOLLARS}.` };
    }
    out.push({ serviceItemId: o.serviceItemId, qty: o.qty, price: o.price });
  }
  return { ok: true, data: out };
}

// Resolve picked-line inputs against the live catalogue → `PickedLine[]`. The
// catalogue row seeds `code`/`label`/`description`/`unitPrice` (snapshotted so
// the line survives a later catalogue edit); the coach's typed price becomes
// `overrideUnitPrice` only when it differs from the seed. `lineTotal` is zeroed
// here — `computePickedTotals` fills it.
function buildPickedLines(
  inputs: PickedLineInput[],
  catalog: ServiceItem[],
): { ok: true; lines: PickedLine[] } | { ok: false; error: string } {
  const byId = new Map(catalog.map((c) => [c.id, c]));
  const lines: PickedLine[] = [];
  for (const input of inputs) {
    const item = byId.get(input.serviceItemId);
    if (!item) {
      return {
        ok: false,
        error: `A picked item is no longer in the catalogue; refresh the page and re-pick.`,
      };
    }
    const seed = item.unitPrice != null ? Number(item.unitPrice) : 0;
    const override = input.price !== seed ? input.price : undefined;
    lines.push({
      serviceItemId: item.id,
      code: item.code,
      label: item.label,
      description: item.description ?? undefined,
      qty: input.qty,
      unitPrice: seed,
      overrideUnitPrice: override,
      lineTotal: 0,
    });
  }
  return { ok: true, lines };
}

// Map a computed `PickedLine` to a `quote_line_items` insert row (money → fixed
// strings; nullable fields normalized). `displayOrder` is the array index.
function pickedLineInsertValues(
  lines: PickedLine[],
  quoteId: number,
  userId: string,
) {
  return lines.map((l, i) => ({
    quoteId,
    serviceItemId: l.serviceItemId ?? null,
    code: l.code,
    label: l.label,
    description: l.description ?? null,
    qty: l.qty,
    unitPrice: moneyString(l.unitPrice),
    overrideUnitPrice: l.overrideUnitPrice != null ? moneyString(l.overrideUnitPrice) : null,
    lineTotal: moneyString(l.lineTotal),
    displayOrder: i,
    createdById: userId,
    updatedById: userId,
  }));
}

// `quoteNotes` is the one structured input the picker composer still owns (it
// renders on the PDF). Capped to the pricing module's NOTES_MAX (1000).
function parseQuoteNotes(formData: FormData): string {
  const raw = field(formData, 'quoteNotes');
  return raw ? raw.slice(0, 1000) : '';
}

export const createQuote = capabilityClient('quote:edit')
  .schema(formDataSchema)
  .action(async ({ parsedInput: formData, ctx }): Promise<CreateQuoteResult> => {
    const userId = ctx.user.id;

    const dealerId = parseId(formData, 'dealerId');
    if (dealerId == null) return { error: 'Dealer is required.' };

    // 0065: snapshot the dealer's province sales-tax rate; tax auto-derives from
    // it unless the coach typed an override.
    const ratePct = await dealerTaxRatePct(dealerId);

    // 0062 picker path: `lines` present → resolve picked SKUs against the
    // catalogue, compute totals, seed the row, and insert the quote_line_items
    // rows inside the tx below once we have the id. Absent → an empty draft.
    let inputsSnapshot: QuoteInputs = DEFAULT_QUOTE_INPUTS;
    let pickedComputed: PickedQuoteComputation | null = null;
    if (formData.has('lines')) {
      const linesResult = parsePickedLineInputs(formData);
      if (!linesResult.ok) return { error: linesResult.error };
      const catalog = await loadActiveCatalog();
      const built = buildPickedLines(linesResult.data, catalog);
      if (!built.ok) return { error: built.error };
      try {
        // 0080: tax is always the auto province-rate computation (no override).
        pickedComputed = computePickedTotals(built.lines, { ratePct });
      } catch (err) {
        if (err instanceof QuoteInputsError) return { error: err.message };
        throw err;
      }
      inputsSnapshot = { ...DEFAULT_QUOTE_INPUTS, quoteNotes: parseQuoteNotes(formData) };
    }

    const baseInsert = {
      dealerId,
      inputs: inputsSnapshot,
      taxPct: pctString(ratePct),
      createdById: userId,
      updatedById: userId,
    };
    const insertValues = pickedComputed
      ? {
          ...baseInsert,
          subtotal: moneyString(pickedComputed.subtotal),
          tax: moneyString(pickedComputed.tax),
          total: moneyString(pickedComputed.total),
        }
      : baseInsert;

    // Verify dealer is active **inside the transaction with a row lock** so a
    // concurrent `archiveDealer` between our SELECT and the INSERT cannot
    // attach the quote to a freshly-archived dealer. `FOR UPDATE` on the
    // dealer row blocks concurrent archive until our tx commits.
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

      const [inserted] = await tx
        .insert(quotes)
        .values(insertValues)
        .returning({ id: quotes.id });
      // 0062: persist the picked lines as relational rows now that we have the
      // quote id — the sole line-item store.
      if (pickedComputed && pickedComputed.lines.length > 0) {
        await tx
          .insert(quoteLineItems)
          .values(pickedLineInsertValues(pickedComputed.lines, inserted.id, userId));
      }
      return { ok: true as const, quoteId: inserted.id };
    });

    if (!result.ok) return { error: result.error };

    await recordAudit({
      action: 'quote.create',
      targetTable: 'quotes',
      targetId: result.quoteId,
      payload: { dealerId },
    });

    revalidateQuoteViews();
    return { ok: true, quoteId: result.quoteId };
  });

// 0062 picker save: resolve the submitted `lines` against the catalogue,
// recompute totals, delete-and-insert the `quote_line_items` rows, write the
// totals + merged `quoteNotes`. Optimistic-lock + audit-diff discipline matches
// the other composer setters. Module-private (not a Server Action) so the
// action-gate lint doesn't flag it.
async function applyPickerSave(
  formData: FormData,
  quoteId: number,
  userId: string,
): Promise<ActionResult> {
  const linesResult = parsePickedLineInputs(formData);
  if (!linesResult.ok) return { error: linesResult.error };

  const quoteNotes = parseQuoteNotes(formData);

  type EditResult =
    | { ok: true; auditPayload: Record<string, unknown> | null }
    | { error: string };

  const txResult: EditResult = await db.transaction(async (tx): Promise<EditResult> => {
    const [row] = await tx
      .select({
        status: quotes.status,
        tax: quotes.tax,
        subtotal: quotes.subtotal,
        total: quotes.total,
        dealerId: quotes.dealerId,
        renderLines: renderLinesColumn,
        inputs: quotes.inputs,
        updatedAt: quotes.updatedAt,
      })
      .from(quotes)
      .where(eq(quotes.id, quoteId))
      .limit(1);
    if (!row) return { error: 'Quote not found.' };
    if (row.status === 'accepted' || row.status === 'declined') {
      return { error: `This quote has been ${row.status} — make a new quote to revise it.` };
    }

    // 0080: tax is always the auto province-rate computation; the rate is
    // snapshotted onto the quote for display.
    const ratePct = await dealerTaxRatePct(row.dealerId);
    const catalog = await loadActiveCatalog();
    const built = buildPickedLines(linesResult.data, catalog);
    if (!built.ok) return { error: built.error };
    let computed: PickedQuoteComputation;
    try {
      computed = computePickedTotals(built.lines, { ratePct });
    } catch (err) {
      if (err instanceof QuoteInputsError) return { error: err.message };
      throw err;
    }

    const mergedInputs: QuoteInputs = { ...(row.inputs as QuoteInputs), quoteNotes };

    // Replace the relational rows (delete-and-insert), then the guarded UPDATE.
    await tx.delete(quoteLineItems).where(eq(quoteLineItems.quoteId, quoteId));
    if (computed.lines.length > 0) {
      await tx
        .insert(quoteLineItems)
        .values(pickedLineInsertValues(computed.lines, quoteId, userId));
    }

    const updated = await tx
      .update(quotes)
      .set({
        inputs: mergedInputs,
        subtotal: moneyString(computed.subtotal),
        tax: moneyString(computed.tax),
        taxPct: pctString(ratePct),
        // 0080: clear any pre-0080 historical override on re-save so the
        // recomputed auto tax is the truth (and the quote becomes QB-pushable
        // again). Also drains the retained column toward all-null over time.
        taxOverride: null,
        total: moneyString(computed.total),
        updatedById: userId,
      })
      .where(
        and(
          eq(quotes.id, quoteId),
          sql`${quotes.status} NOT IN ('accepted', 'declined')`,
          sql`date_trunc('milliseconds', ${quotes.updatedAt}) = ${row.updatedAt.toISOString()}::timestamptz`,
        ),
      )
      .returning({ id: quotes.id });
    if (!updated.length) {
      const [latest] = await tx
        .select({ status: quotes.status })
        .from(quotes)
        .where(eq(quotes.id, quoteId))
        .limit(1);
      if (!latest) return { error: 'Quote not found.' };
      if (latest.status === 'accepted' || latest.status === 'declined') {
        return { error: `This quote has been ${latest.status} — make a new quote to revise it.` };
      }
      return { error: 'Quote was edited concurrently; please retry.' };
    }

    const beforePriced = { subtotal: row.subtotal, tax: row.tax, total: row.total };
    const afterPriced = {
      subtotal: moneyString(computed.subtotal),
      tax: moneyString(computed.tax),
      total: moneyString(computed.total),
    };
    const beforeLinesHash = lineFingerprint(row.renderLines);
    const afterLinesHash = lineFingerprint(computed.lines);
    const dirtyFields: string[] = [];
    if (beforePriced.subtotal !== afterPriced.subtotal) dirtyFields.push('subtotal');
    if (beforePriced.tax !== afterPriced.tax) dirtyFields.push('tax');
    if (beforePriced.total !== afterPriced.total) dirtyFields.push('total');
    if (beforeLinesHash !== afterLinesHash) dirtyFields.push('lineItems');
    const auditPayload = dirtyFields.length
      ? {
          before: { ...beforePriced, lineItemsHash: beforeLinesHash },
          after: { ...afterPriced, lineItemsHash: afterLinesHash },
          dirtyFields,
        }
      : null;

    return { ok: true, auditPayload };
  });

  if ('error' in txResult) return txResult;

  if (txResult.auditPayload) {
    await recordAudit({
      action: 'quote.edited',
      targetTable: 'quotes',
      targetId: quoteId,
      payload: txResult.auditPayload,
    });
  }

  revalidateQuoteViews();
  return { ok: true };
}

/** Composer-side setter: persist the picked line items + tax + quote notes,
 *  delegating to `applyPickerSave`. 0046 lifecycle doctrine — `sent` (and
 *  derived `expired`) rows stay editable so coaches can fix pricing typos and
 *  Re-send; only the terminal contract artifacts (`accepted`/`declined`) are
 *  immutable. (Name kept for call-site stability; the composer no longer sends
 *  the old structured `inputs`.) */
export const setQuoteInputs = capabilityClient('quote:edit')
  .schema(formDataSchema)
  .action(async ({ parsedInput: formData, ctx }): Promise<ActionResult> => {
    const userId = ctx.user.id;

    const quoteId = parseId(formData, 'quoteId');
    if (quoteId == null) return { error: 'Invalid quote id.' };

    // 0062: the composer submits a picker `lines` payload (absent → empty
    // quote). All saves route through `applyPickerSave`.
    return applyPickerSave(formData, quoteId, userId);
  });

// 0080 removed `setQuoteTax` (the manual tax-override setter). QuickBooks owns
// the tax rate; tax is always the auto province-rate computation, derived inside
// `createQuote` / `setQuoteInputs` / `setQuoteDealer`.

/** Composer-side setter: swap the dealer on a draft quote (e.g. coach picks a
 *  different dealer from the picker). Verifies the new dealer is active. */
// validation: skip — id-only action (quoteId + dealerId); `parseId` covers both.
export const setQuoteDealer = capabilityClient('quote:edit')
  .schema(formDataSchema)
  .action(async ({ parsedInput: formData, ctx }): Promise<ActionResult> => {
    const userId = ctx.user.id;

    const quoteId = parseId(formData, 'quoteId');
    if (quoteId == null) return { error: 'Invalid quote id.' };

    const dealerId = parseId(formData, 'dealerId');
    if (dealerId == null) return { error: 'Dealer is required.' };

    // Dealer-active check + quote update inside the same transaction with
    // `FOR UPDATE` on the dealer row — concurrent archive can't race past
    // the active-dealer guard.
    return db.transaction(async (tx) => {
      const [dealer] = await tx
        .select({ id: dealers.id })
        .from(dealers)
        .where(and(eq(dealers.id, dealerId), isNull(dealers.archivedAt)))
        .for('update')
        .limit(1);
      if (!dealer) return { error: 'Dealer not found or archived.' };

      // 0080: swapping the dealer can change the province → re-derive the tax
      // from the new dealer's province rate (auto; no manual override).
      const [q] = await tx
        .select({
          status: quotes.status,
          subtotal: quotes.subtotal,
        })
        .from(quotes)
        .where(eq(quotes.id, quoteId))
        .limit(1);
      if (!q) return { error: 'Quote not found.' };
      if (q.status !== 'draft') {
        return { error: `Quote cannot be edited in status '${q.status}'.` };
      }

      const ratePct = await dealerTaxRatePct(dealerId);
      const subtotal = Number(q.subtotal) || 0;
      const tax = resolveTaxAmount(subtotal, ratePct);
      const total = subtotal + tax;

      const result = await tx
        .update(quotes)
        .set({
          dealerId,
          taxPct: pctString(ratePct),
          tax: moneyString(tax),
          // 0080: clear any pre-0080 historical override on dealer-swap re-save.
          taxOverride: null,
          total: moneyString(total),
          updatedById: userId,
        })
        .where(and(eq(quotes.id, quoteId), eq(quotes.status, 'draft')))
        .returning({ id: quotes.id });
      if (!result.length) {
        const [row] = await tx
          .select({ status: quotes.status })
          .from(quotes)
          .where(eq(quotes.id, quoteId))
          .limit(1);
        if (!row) return { error: 'Quote not found.' };
        return { error: `Quote cannot be edited in status '${row.status}'.` };
      }

      revalidateQuoteViews();
      return { ok: true };
    });
  });

// Stored revision number on the GCS key. Quote revisions in v1 are tracked
// across rows via `previousQuoteId` (each revision is a new row), so within a
// single row the renderer always writes revision 1. The path shape
// `quotes/{quoteId}/{revision}.pdf` is forward-compatible with a future
// in-row revision counter (e.g. a "Resend" action that bumps the revision
// and re-renders) without needing a key-shape migration.
const QUOTE_PDF_REVISION = 1;

function pdfStorageKey(quoteId: number): string {
  return `quotes/${quoteId}/${QUOTE_PDF_REVISION}.pdf`;
}

// MAX_ADDRESS_LINES lives in ./constants because `'use server'` files may
// only export async functions (Next 16 RSC constraint). Line items for the
// renderer come from `quote_line_items` via `mapRenderLines(renderLinesColumn)`
// (`@/lib/quotes/render-lines`).

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function isoDateOffset(base: Date, days: number): string {
  return new Date(base.getTime() + days * MS_PER_DAY).toISOString().slice(0, 10);
}

/** Split a free-form multi-line address into the renderer's array shape.
 *  Empty / null input yields `undefined` (renderer skips the block). */
function splitClientAddress(address: string | null): string[] | undefined {
  if (!address) return undefined;
  const lines = address
    .split(/\r?\n/)
    .map((s) => s.trim().slice(0, 120))
    .filter(Boolean)
    .slice(0, MAX_ADDRESS_LINES);
  return lines.length ? lines : undefined;
}

function sameTimestamp(a: unknown, b: unknown): boolean {
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  return String(a) === String(b);
}

type PreviewResult =
  | { ok: true; dataUrl: string }
  | { error: string };

type SignedQuotePdfUrlResult =
  | { ok: true; url: string }
  | { error: string };

const QUOTE_PDF_SIGNED_URL_TTL_SECONDS = 5 * 60;

// Returns a short-lived V4 signed read URL for the persisted quote PDF — the
// "Download sent PDF" link on the send-receipt panel. Only valid for rows that
// reached `sent` (a draft has no `pdfStorageKey`); draft requests reject with
// `error`. TTL is 5 minutes — much tighter than the 7-day cap; the panel
// re-resolves on each render.
// validation: skip — id-only action; `parseId` covers the lone input.
export const signedQuotePdfUrl = capabilityClient('quote:edit')
  .schema(formDataSchema)
  .action(async ({ parsedInput: formData }): Promise<SignedQuotePdfUrlResult> => {
    const quoteId = parseId(formData, 'quoteId');
    if (quoteId == null) return { error: 'Invalid quote id.' };

    const bucket = process.env.GCS_BUCKET;
    if (!bucket) {
      return { error: 'GCS_BUCKET is not configured; cannot sign quote PDF URL.' };
    }

    const [quote] = await db
      .select({ status: quotes.status, pdfStorageKey: quotes.pdfStorageKey })
      .from(quotes)
      .where(eq(quotes.id, quoteId))
      .limit(1);
    if (!quote) return { error: 'Quote not found.' };
    if (quote.status === 'draft' || !quote.pdfStorageKey) {
      return { error: 'Quote PDF is not available until the quote is sent.' };
    }

    const signed = await signedUrl(
      bucket,
      quote.pdfStorageKey,
      QUOTE_PDF_SIGNED_URL_TTL_SECONDS,
    );
    if ('error' in signed) return { error: signed.error };
    return { ok: true, url: signed.url };
  });

// Preview action — renders the PDF from the persisted snapshot (no GCS, no
// email, no lifecycle change) and returns it as a base64 data URL the
// composer can drop into an `<iframe src=…>`. Works for both `draft` and
// `sent`: the render input is the same `lineItems`/`subtotal`/`tax`/`total`
// snapshot that `sendQuote` uses, so a draft preview matches exactly what
// will be emailed on Send (modulo `issuedDate`, which is today for drafts
// and the `sentAt` date for sent rows).
// validation: skip — id-only action; `parseId` covers the lone input.
export const previewQuotePdf = capabilityClient('quote:edit')
  .schema(formDataSchema)
  .action(async ({ parsedInput: formData }): Promise<PreviewResult> => {
    const quoteId = parseId(formData, 'quoteId');
    if (quoteId == null) return { error: 'Invalid quote id.' };

    const [quote] = await db
      .select({
        id: quotes.id,
        status: quotes.status,
        dealerId: quotes.dealerId,
        sentAt: quotes.sentAt,
        createdAt: quotes.createdAt,
        quoteValidDays: quotes.quoteValidDays,
        renderLines: renderLinesColumn,
        subtotal: quotes.subtotal,
        tax: quotes.tax,
        taxPct: quotes.taxPct,
        total: quotes.total,
      })
      .from(quotes)
      .where(eq(quotes.id, quoteId))
      .limit(1);
    if (!quote) return { error: 'Quote not found.' };

    const [dealer] = await db
      .select({
        id: dealers.id,
        name: dealers.name,
        address: dealers.address,
      })
      .from(dealers)
      .where(and(eq(dealers.id, quote.dealerId), isNull(dealers.archivedAt)))
      .limit(1);
    if (!dealer) return { error: 'Dealer not found or archived.' };

    const lines = mapRenderLines(quote.renderLines);

    // For sent quotes the issued/validity dates anchor on `sentAt`. For
    // drafts (preview-only) we fall back to today so the preview shows what
    // the rendered PDF will look like once sent.
    const anchorDate = quote.sentAt ?? new Date();
    const issuedDate = anchorDate.toISOString().slice(0, 10);
    const validUntilDate = isoDateOffset(anchorDate, quote.quoteValidDays);

    const rendered = await renderQuotePdf({
      createdAt: quote.createdAt,
      issuedDate,
      validUntilDate,
      clientName: dealer.name,
      clientAddress: splitClientAddress(dealer.address),
      eventName: 'Sales Event',
      lineItems: lines,
      subtotal: Number(quote.subtotal),
      tax: Number(quote.tax),
      taxPct: Number(quote.taxPct) || 0,
      total: Number(quote.total),
    });
    if ('error' in rendered) {
      return { error: `Quote PDF render failed: ${rendered.error}` };
    }

    return {
      ok: true,
      dataUrl: `data:application/pdf;base64,${rendered.body.toString('base64')}`,
    };
  });

// validation: skip — id-only action; `parseId` covers the lone input. Lifecycle
// guards run inside the transaction against the row's current status.
//
// 0046: `sendQuote` is now both the first-send action AND the re-send action.
// `sentAt == null` → first send (draft → sent); `sentAt != null` → re-send
// (sent → sent, sent_at reset, new PDF overwrite, new email, new audit row).
// Only `accepted` / `declined` reject — those are the contract artifacts.
export const sendQuote = capabilityClient('quote:edit')
  .schema(formDataSchema)
  .action(async ({ parsedInput: formData, ctx }): Promise<ActionResult> => {
    const userId = ctx.user.id;

    const quoteId = parseId(formData, 'quoteId');
    if (quoteId == null) return { error: 'Invalid quote id.' };

    const bucket = process.env.GCS_BUCKET;
    if (!bucket) {
      return { error: 'GCS_BUCKET is not configured; cannot persist quote PDF.' };
    }

    // Send/re-send flow (0046 unified):
    //   1. Pre-load row + dealer; reject terminal statuses (accepted/declined).
    //   2. Resolve the customer recipient (primary email of the dealer's
    //      first 'customer' contact); fail closed before any side-effects.
    //   3. Render the PDF from the persisted snapshot (overwrite on re-send).
    //   4. Atomic guarded UPDATE — sets status='sent' + sentAt=now +
    //      pdfStorageKey + recipient denorm, WHERE status NOT IN
    //      ('accepted','declined') AND date_trunc('ms', updatedAt)=preloaded.
    //      The optimistic-lock predicate replaces the old `status='draft'`
    //      guard: it covers both first-send and re-send while still
    //      rejecting a row that got edited or accepted under us.
    //   5. On miss, re-select to classify (gone / terminal /
    //      concurrent-send-won / concurrent-edit).
    //   6. Upload PDF to GCS — overwrites the existing object on re-send;
    //      the storage key is the staff-portal's current-truth pointer
    //      (recipients keep their own copies in their inbox).
    //   7. Render + send the email (HTML body + plain-text fallback + PDF
    //      attachment) via the existing Resend wiring.
    //   8. Audit-emit `quote.sent` (one row per send; multi-row accumulation
    //      drives the Send-history Section's chronology) + revalidate.

    const [draft] = await db
      .select({
        id: quotes.id,
        status: quotes.status,
        dealerId: quotes.dealerId,
        sentAt: quotes.sentAt,
        updatedAt: quotes.updatedAt,
        createdAt: quotes.createdAt,
        quoteValidDays: quotes.quoteValidDays,
        renderLines: renderLinesColumn,
        subtotal: quotes.subtotal,
        tax: quotes.tax,
        taxPct: quotes.taxPct,
        total: quotes.total,
      })
      .from(quotes)
      .where(eq(quotes.id, quoteId))
      .limit(1);
    if (!draft) return { error: 'Quote not found.' };
    if (draft.status === 'accepted' || draft.status === 'declined') {
      return {
        error: `This quote has been ${draft.status} — make a new quote to revise it.`,
      };
    }

    // Archive-aware dealer lookup. createQuote / setQuoteDealer already
    // reject archived dealers, but we re-check here so a dealer archived
    // between draft-save and send doesn't leak a quote out the door.
    const [dealer] = await db
      .select({
        id: dealers.id,
        name: dealers.name,
        address: dealers.address,
      })
      .from(dealers)
      .where(and(eq(dealers.id, draft.dealerId), isNull(dealers.archivedAt)))
      .limit(1);
    if (!dealer) return { error: 'Dealer not found or archived.' };

    // MSA-pending in-flight gate (0046 Phase 5). On re-send only — first-send
    // pre-dates the MSA bundle by definition, and the MSA-bundle envelope
    // path lives in `sendMsaEnvelope` (it bundles the draft Quote alongside
    // the MSA PDF). Re-sending a Quote *while the dealer's MSA envelope is
    // sitting in BoldSign awaiting signature* would confuse the signer:
    // they'd see two different Quote PDFs. Block re-send until the envelope
    // resolves (signed → MSA goes `active`; declined → manual cleanup).
    if (draft.sentAt != null) {
      const [pendingMsa] = await db
        .select({
          status: masterServiceAgreements.status,
          providerDocumentId: masterServiceAgreements.providerDocumentId,
        })
        .from(masterServiceAgreements)
        .where(
          and(
            eq(masterServiceAgreements.dealerId, draft.dealerId),
            eq(masterServiceAgreements.status, 'pending'),
          ),
        )
        .limit(1);
      if (pendingMsa && pendingMsa.providerDocumentId != null) {
        return {
          error:
            'MSA envelope is in flight — finish signing or terminate before re-sending this quote.',
        };
      }
    }

    // Resolve recipient before any side effects. If the dealer doesn't have a
    // customer contact with a primary email, we fail closed — the row stays
    // unchanged, the coach sees a clear error, and no PDF gets uploaded.
    const recipientResult = await resolveQuoteRecipient(draft.dealerId);
    if ('error' in recipientResult) return recipientResult;
    const recipient = recipientResult.recipient;

    const lines = mapRenderLines(draft.renderLines);
    // 0062: refuse to send an empty quote — fail closed before any side
    // effects (render / GCS / email / status flip).
    if (lines.length === 0) {
      return { error: 'Add at least one line item before sending this quote.' };
    }

    // Anchor both timestamps to the same `now` so the row's `sentAt` and the
    // rendered "Issued"/"Valid until" strings line up to the millisecond.
    // On re-send, `sentAt` advances to now and the validity window resets —
    // matching the "Re-send replaces the recipient's copy" doctrine in the
    // composer banner copy.
    const sentAt = new Date();
    const issuedDate = sentAt.toISOString().slice(0, 10);
    const validUntilDate = isoDateOffset(sentAt, draft.quoteValidDays);
    const quoteData: QuoteData = {
      createdAt: draft.createdAt,
      issuedDate,
      validUntilDate,
      clientName: dealer.name,
      clientAddress: splitClientAddress(dealer.address),
      // v1 placeholder: quotes don't yet carry an event-name column. The
      // composer's `quoteNotes` is freeform and not appropriate as a title.
      // TODO(post-0026): add `eventName` to QuoteInputs (or link quote ↔
      // campaign by then) and source from there.
      eventName: 'Sales Event',
      lineItems: lines,
      subtotal: Number(draft.subtotal),
      tax: Number(draft.tax),
      taxPct: Number(draft.taxPct) || 0,
      total: Number(draft.total),
    };

    const rendered = await renderQuotePdf(quoteData);
    if ('error' in rendered) {
      return { error: `Quote PDF render failed: ${rendered.error}` };
    }

    // 0078: load + fetch the quote's attachments BEFORE the status transition so
    // an over-size payload or an unreadable object fails closed without a
    // half-send (the row would otherwise flip to `sent` with no email out the
    // door). Bytes ride alongside the quote PDF in the outgoing email.
    const attachmentRows = await db
      .select({
        filename: quoteAttachments.filename,
        storageKey: quoteAttachments.storageKey,
        contentType: quoteAttachments.contentType,
        byteSize: quoteAttachments.byteSize,
      })
      .from(quoteAttachments)
      .where(eq(quoteAttachments.quoteId, quoteId))
      .orderBy(asc(quoteAttachments.displayOrder), asc(quoteAttachments.id));

    // Total-size guard: quote PDF + every attachment must fit under the cap.
    // Checked from the row sizes (cheap) before any byte fetch or the transition.
    const totalBytes =
      rendered.body.byteLength +
      attachmentRows.reduce((sum, a) => sum + a.byteSize, 0);
    if (totalBytes > MAX_TOTAL_ATTACHMENT_BYTES) {
      return {
        error: `Total email size (${formatBytes(totalBytes)}) exceeds the ${formatBytes(MAX_TOTAL_ATTACHMENT_BYTES)} limit. Remove an attachment and resend.`,
      };
    }

    // Fetch each attachment's bytes. A missing/unreadable object fails the send
    // with a repairable message (remove + re-upload) rather than silently
    // dropping the document — and, being pre-transition, the row stays sendable.
    const attachmentSends: SendAttachment[] = [];
    for (const att of attachmentRows) {
      const obj = await getObject(bucket, att.storageKey);
      if ('error' in obj) {
        return {
          error: `Attachment "${att.filename}" could not be loaded — remove and re-upload it, then resend.`,
        };
      }
      attachmentSends.push({
        filename: att.filename,
        content: obj.body,
        contentType: att.contentType,
      });
    }

    const storageKey = pdfStorageKey(quoteId);

    // Atomic guarded UPDATE. The status predicate keeps terminal rows safe
    // (accepted/declined refuse silently → re-select classifies); the
    // `updatedAt` equality preserves the optimistic-lock invariant on the
    // first-send + re-send paths alike. `date_trunc('ms', …)` matches
    // postgres-js's ms-resolution decode for timestamptz; the
    // `::timestamptz` cast forces the bound parameter to a string that
    // Postgres parses back to a timestamp (raw Date binding throws).
    const updated = await db
      .update(quotes)
      .set({
        status: 'sent',
        sentAt,
        pdfStorageKey: storageKey,
        sentToEmail: recipient.email,
        sentToFirstName: recipient.firstName,
        updatedById: userId,
      })
      .where(
        and(
          eq(quotes.id, quoteId),
          sql`${quotes.status} NOT IN ('accepted', 'declined')`,
          sql`date_trunc('milliseconds', ${quotes.updatedAt}) = ${draft.updatedAt.toISOString()}::timestamptz`,
        ),
      )
      .returning({ id: quotes.id });

    if (!updated.length) {
      const [row] = await db
        .select({
          id: quotes.id,
          status: quotes.status,
          updatedAt: quotes.updatedAt,
          sentAt: quotes.sentAt,
        })
        .from(quotes)
        .where(eq(quotes.id, quoteId))
        .limit(1);
      if (!row) return { error: 'Quote not found.' };
      if (row.status === 'accepted' || row.status === 'declined') {
        return {
          error: `This quote has been ${row.status} — make a new quote to revise it.`,
        };
      }
      // Distinguish "concurrent SEND won" from "concurrent EDIT bumped
      // updatedAt." Both leave `status='sent'` with a different `updatedAt`,
      // but a real concurrent send also *advances* `sentAt`. If sentAt
      // moved past our preload, treat as race-won-by-other and return ok
      // (per OQ #6 — the row is now freshly sent, our snapshot just wasn't
      // the one used). If sentAt is unchanged, it was a concurrent edit
      // (or the second send hasn't actually happened) — force the coach
      // to re-pre-load before claiming success on an undelivered send.
      const preloadedSentAtMs = draft.sentAt?.getTime() ?? 0;
      const rowSentAtMs = row.sentAt?.getTime() ?? 0;
      if (
        row.status === 'sent' &&
        rowSentAtMs > preloadedSentAtMs &&
        !sameTimestamp(row.updatedAt, draft.updatedAt)
      ) {
        revalidateQuoteViews();
        return { ok: true };
      }
      // Status `draft`/`sent` with different `updatedAt` and unchanged
      // `sentAt`: a concurrent edit mutated the snapshot under us. The
      // delivery path has NOT advanced — force the coach to re-pre-load
      // rather than claim a phantom success.
      return { error: 'Quote was edited concurrently; please retry.' };
    }

    const uploaded = await putObject({
      bucket,
      key: storageKey,
      body: rendered.body,
      contentType: 'application/pdf',
    });
    if ('error' in uploaded) {
      return { error: 'Quote sent but PDF upload failed; admin repair required.' };
    }

    // Render the email body + send. After-transition degraded-state failure
    // surfaces a clear error message; Phase 5 follow-up will add retry
    // detection + remediation. The row is already `sent`, so the coach will
    // see the next send attempt early-fail on the idempotent path until then.
    const email = await quoteEmail({
      firstName: recipient.firstName,
      createdAt: draft.createdAt,
      clientName: dealer.name,
      issuedDate,
      validUntilDate,
      total: Number(draft.total),
    });
    const emailResult = await sendEmail({
      to: recipient.email,
      subject: email.subject,
      text: email.text,
      html: email.html,
      // Quote PDF first, then every uploaded attachment (0078) in displayOrder.
      attachments: [
        {
          filename: quoteDownloadFilename(draft.createdAt),
          content: rendered.body,
          contentType: 'application/pdf',
        },
        ...attachmentSends,
      ],
    });
    if ('error' in emailResult) {
      return { error: 'Quote sent but email delivery failed; admin repair required.' };
    }

    await recordAudit({
      action: 'quote.sent',
      targetTable: 'quotes',
      targetId: quoteId,
      // Recipient is included so multi-row Send history can show the
      // person each send actually went to, even after the row-level
      // denorm (`sentToEmail`/`sentToFirstName`) rotates to a different
      // contact between sends. Older rows that pre-date this addition
      // fall back to the row-level denorm at render time.
      // 0078: denorm the attachment set that actually went out (filenames +
      // count) so the Send history records the supporting paperwork per send.
      payload: {
        pdfStorageKey: storageKey,
        emailId: emailResult.id,
        sentToEmail: recipient.email,
        sentToFirstName: recipient.firstName,
        attachmentCount: attachmentRows.length,
        attachments: attachmentRows.map((a) => ({
          filename: a.filename,
          byteSize: a.byteSize,
        })),
      },
    });

    revalidateQuoteViews();
    return { ok: true };
  });

// 0078 — local-upload attachment spine. A coach uploads supporting paperwork
// (forms, banking info, waivers) from the send dialog; `sendQuote` (Phase 3)
// fetches each row's bytes and appends them to the outgoing email alongside the
// quote PDF. Gated by `quote:edit` — the same capability that owns send, so no
// new gate-matrix row. Type allowlist + per-file/total caps mirror the client
// pre-check via the shared `./attachments` module so the two can't drift.

type UploadAttachmentResult =
  | { ok: true; attachment: QuoteAttachmentView }
  | { error: string };

// validation: skip — FormData carries `quoteId` (parseId) + a `file` Blob; the
// body validates type/size/quote-status before any side effect.
export const uploadQuoteAttachment = capabilityClient('quote:edit')
  .schema(formDataSchema)
  .action(async ({ parsedInput: formData, ctx }): Promise<UploadAttachmentResult> => {
    const userId = ctx.user.id;

    const quoteId = parseId(formData, 'quoteId');
    if (quoteId == null) return { error: 'Invalid quote id.' };

    const bucket = process.env.GCS_BUCKET;
    if (!bucket) {
      return { error: 'GCS_BUCKET is not configured; cannot store attachments.' };
    }

    const file = formData.get('file');
    if (!(file instanceof File) || file.size === 0) {
      return { error: 'No file provided.' };
    }
    if (!isAllowedAttachmentType(file.type)) {
      return { error: `Unsupported file type. Allowed: ${ATTACHMENT_TYPE_LABELS}.` };
    }
    if (file.size > MAX_ATTACHMENT_BYTES) {
      return {
        error: `File is too large (max ${formatBytes(MAX_ATTACHMENT_BYTES)} per file).`,
      };
    }

    // Never attach to a terminal contract — mirror `sendQuote`'s status guard so
    // a quote accepted/declined between dialog-open and upload fails closed.
    const [quote] = await db
      .select({ status: quotes.status })
      .from(quotes)
      .where(eq(quotes.id, quoteId))
      .limit(1);
    if (!quote) return { error: 'Quote not found.' };
    if (quote.status === 'accepted' || quote.status === 'declined') {
      return { error: `This quote has been ${quote.status} — attachments are locked.` };
    }

    // Early total-payload guard: existing attachment bytes + this file. The send
    // action re-checks against the rendered PDF too (the authoritative ceiling);
    // this just stops the coach piling on files that can never go out.
    const existing = await db
      .select({
        byteSize: quoteAttachments.byteSize,
        displayOrder: quoteAttachments.displayOrder,
      })
      .from(quoteAttachments)
      .where(eq(quoteAttachments.quoteId, quoteId));
    const existingTotal = existing.reduce((sum, r) => sum + r.byteSize, 0);
    if (existingTotal + file.size > MAX_TOTAL_ATTACHMENT_BYTES) {
      return {
        error: `Total attachments would exceed ${formatBytes(MAX_TOTAL_ATTACHMENT_BYTES)}. Remove a file first.`,
      };
    }
    const nextOrder =
      existing.reduce((max, r) => Math.max(max, r.displayOrder), 0) + 1;

    const displayName = cleanDisplayFilename(file.name);
    const storageKey = attachmentStorageKey(quoteId, randomUUID(), file.name);
    const body = Buffer.from(await file.arrayBuffer());
    const uploaded = await putObject({
      bucket,
      key: storageKey,
      body,
      contentType: file.type,
    });
    if ('error' in uploaded) {
      return { error: 'Attachment upload failed; please retry.' };
    }

    const [row] = await db
      .insert(quoteAttachments)
      .values({
        quoteId,
        filename: displayName,
        storageKey,
        contentType: file.type,
        byteSize: file.size,
        displayOrder: nextOrder,
        createdById: userId,
        updatedById: userId,
      })
      .returning({
        id: quoteAttachments.id,
        filename: quoteAttachments.filename,
        contentType: quoteAttachments.contentType,
        byteSize: quoteAttachments.byteSize,
      });

    await recordAudit({
      action: 'quote.attachment_added',
      targetTable: 'quotes',
      targetId: quoteId,
      payload: {
        attachmentId: row.id,
        filename: row.filename,
        byteSize: row.byteSize,
        contentType: row.contentType,
      },
    });

    revalidateQuoteViews();
    return { ok: true, attachment: row };
  });

type RemoveAttachmentResult =
  | { ok: true; attachmentId: number }
  | { error: string };

// Detach an upload before send. Deletes the row (guarded by `quoteId` so an id
// from a different quote can't be removed) and best-effort deletes the GCS
// object. A failed object delete doesn't fail the action — the row is already
// gone and an orphaned object is harmless (retention is keep-forever anyway).
// validation: skip — id-only (`quoteId` + `attachmentId` via parseId).
export const removeQuoteAttachment = capabilityClient('quote:edit')
  .schema(formDataSchema)
  .action(async ({ parsedInput: formData }): Promise<RemoveAttachmentResult> => {
    const quoteId = parseId(formData, 'quoteId');
    const attachmentId = parseId(formData, 'attachmentId');
    if (quoteId == null || attachmentId == null) {
      return { error: 'Invalid id.' };
    }

    // Symmetry with uploadQuoteAttachment: a terminal contract's attachment set
    // is locked — refuse removal on accepted/declined (Codex 0078 review).
    const [quote] = await db
      .select({ status: quotes.status })
      .from(quotes)
      .where(eq(quotes.id, quoteId))
      .limit(1);
    if (!quote) return { error: 'Quote not found.' };
    if (quote.status === 'accepted' || quote.status === 'declined') {
      return { error: `This quote has been ${quote.status} — attachments are locked.` };
    }

    const [removed] = await db
      .delete(quoteAttachments)
      .where(
        and(
          eq(quoteAttachments.id, attachmentId),
          eq(quoteAttachments.quoteId, quoteId),
        ),
      )
      .returning({
        id: quoteAttachments.id,
        storageKey: quoteAttachments.storageKey,
        filename: quoteAttachments.filename,
      });
    if (!removed) return { error: 'Attachment not found.' };

    const bucket = process.env.GCS_BUCKET;
    if (bucket) {
      const del = await deleteObject(bucket, removed.storageKey);
      if ('error' in del) {
        console.error('attachment object delete failed', {
          storageKey: removed.storageKey,
          error: del.error,
        });
      }
    }

    await recordAudit({
      action: 'quote.attachment_removed',
      targetTable: 'quotes',
      targetId: quoteId,
      payload: { attachmentId: removed.id, filename: removed.filename },
    });

    revalidateQuoteViews();
    return { ok: true, attachmentId };
  });

// Staff-side decline. The client-side decline path goes through the public
// Staff-side accept / decline. v1 design: the customer phones or replies to
// the quote email, and the coach flips the quote status through these
// actions. No public token-validated route — `acceptToken` exists on the
// schema for forward compatibility, but no public surface uses it today.
//
// `acceptQuote` also flips a prospect-status dealer to active on a
// successful sent→accepted transition. Mirrors the atomic guarded UPDATE
// shape of `convertProspectToActive` in src/features/schedule/actions.ts so
// a concurrent archive/already-active race is a no-op rather than an error.
// validation: skip — id-only action (quoteId + optional reason string);
// `parseId` covers the id. Lifecycle guards run against the row's status.
export const acceptQuote = capabilityClient('quote:edit')
  .schema(formDataSchema)
  .action(async ({ parsedInput: formData, ctx }): Promise<ActionResult> => {
    const userId = ctx.user.id;

    const quoteId = parseId(formData, 'quoteId');
    if (quoteId == null) return { error: 'Invalid quote id.' };

    const result = await markQuoteAccepted(quoteId, userId);
    if ('error' in result) return result;

    // Only emit on the actual sent → accepted transition. Idempotent re-
    // accept of an already-accepted row is a no-op (no audit row, no
    // dealer-status side effect).
    if (result.transitioned) {
      await recordAudit({
        action: 'quote.accepted',
        targetTable: 'quotes',
        targetId: quoteId,
        payload: { source: 'staff' },
      });

      // Promote a prospect dealer to active. Same atomic-transition shape as
      // `convertProspectToActive`: only flip rows currently `prospect` AND
      // not archived. Archived or already-active rows fall through silently.
      const [row] = await db
        .select({ dealerId: quotes.dealerId })
        .from(quotes)
        .where(eq(quotes.id, quoteId))
        .limit(1);
      if (row) {
        const promoted = await db
          .update(dealers)
          .set({ status: 'active', updatedById: userId })
          .where(
            and(
              eq(dealers.id, row.dealerId),
              eq(dealers.status, 'prospect'),
              isNull(dealers.archivedAt),
            ),
          )
          .returning({ id: dealers.id });
        if (promoted.length) {
          await recordAudit({
            action: 'dealer.activated',
            targetTable: 'dealers',
            targetId: row.dealerId,
            payload: { from: 'prospect', via: 'quote.accepted' },
          });
        }
      }
    }

    revalidateQuoteViews();
    return { ok: true };
  });

// Staff-side decline. v1 has no client-self-serve decline either — the
// customer phones or emails the coach, and the coach flips the row here.
// validation: skip — id-only action (quoteId + optional reason string);
// `parseId` covers the id. Lifecycle guards run against the row's status.
export const declineQuote = capabilityClient('quote:edit')
  .schema(formDataSchema)
  .action(async ({ parsedInput: formData, ctx }): Promise<ActionResult> => {
    const userId = ctx.user.id;

    const quoteId = parseId(formData, 'quoteId');
    if (quoteId == null) return { error: 'Invalid quote id.' };

    const result = await markQuoteDeclined(quoteId, userId);
    if ('error' in result) return result;

    // Skip audit emit on the idempotent already-declined path — only the
    // actual sent → declined transition is a state-change worth a forensic
    // row. (Draft quotes cannot be declined; `markQuoteDeclined` rejects
    // that.)
    if (result.transitioned) {
      await recordAudit({
        action: 'quote.declined',
        targetTable: 'quotes',
        targetId: quoteId,
        payload: { source: 'staff' },
      });
    }

    revalidateQuoteViews();
    return { ok: true };
  });
