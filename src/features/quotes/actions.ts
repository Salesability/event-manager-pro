'use server';

import { createHash } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { dealers, masterServiceAgreements, quotes, serviceItems } from '@/lib/db/schema';
import { capabilityClient, formDataSchema } from '@/lib/actions/action-client';
import { recordAudit } from '@/features/audit/actions';
import { field, parseId } from '@/features/schedule/validators';
import {
  computeQuote,
  DEFAULT_QUOTE_INPUTS,
  MAX_DOLLARS,
  QuoteInputsError,
  quoteInputsSchema,
  type QuoteInputs,
} from '@/lib/quotes/pricing';
import type { ServiceItem } from '@/features/services/queries';
import { renderQuotePdf, type QuoteData, type QuoteLineItem } from '@/lib/pdf/render-quote';
import { putObject, signedUrl } from '@/lib/storage/gcs';
import type { ComputedLine } from '@/lib/quotes/pricing';
import { sendEmail } from '@/lib/email/send';
import { quoteEmail } from '@/lib/email/templates/quote';
import { markQuoteAccepted, markQuoteDeclined } from './lifecycle';
import { MAX_ADDRESS_LINES } from './constants';
import { resolveQuoteRecipient } from './recipient';
import { quoteDownloadFilename } from './display-name';

// 0026 Phase 2 — `quotes` data model + bare-bones Server Actions.
//
// Scope: `createQuote` stands up a draft row with zeroed inputs/totals; the
// composer (0035 Phase 3) extends this file with `setQuoteInputs`,
// `setQuoteTax`, `setQuoteDealer` setters that recompute lines + totals and
// persist them. `sendQuote` is the lifecycle-transition action — Phase 3
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
      unit: serviceItems.unit,
      unitPrice: serviceItems.unitPrice,
      unitPriceMin: serviceItems.unitPriceMin,
      unitPriceMax: serviceItems.unitPriceMax,
      description: serviceItems.description,
      sortOrder: serviceItems.sortOrder,
    })
    .from(serviceItems)
    .where(isNull(serviceItems.archivedAt));
}

/** Parse a `QuoteInputs` payload from FormData. The composer submits it as a
 *  single `inputs` JSON string; the action JSON.parses it and `safeParse`s
 *  against the shared `quoteInputsSchema` (defined in `@/lib/quotes/pricing`
 *  and also consumed by the composer's `zodResolver`). Zod's default `.strip`
 *  mode discards unknown keys, so an attacker-supplied `__proto__` / `blob`
 *  field never reaches the `quotes.inputs` jsonb column. Per-field
 *  `.default(...)` calls in the schema fill in missing fields with the
 *  `DEFAULT_QUOTE_INPUTS` shape.
 */
function parseQuoteInputs(
  formData: FormData,
): { ok: true; data: QuoteInputs; fieldErrors?: undefined }
  | { ok: false; error: string; fieldErrors?: Record<string, string[] | undefined> } {
  const raw = field(formData, 'inputs');
  if (!raw) return { ok: false, error: 'Quote inputs are required.' };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, error: 'Quote inputs payload is not valid JSON.' };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ok: false, error: 'Quote inputs must be an object.' };
  }

  // Merge user-supplied keys over the canonical defaults before safeParse so
  // missing fields are filled in (legacy `pickNumber(p.x, DEFAULT_QUOTE_INPUTS.x)`
  // semantics). Zod's default `.strip` mode still drops unknown keys — an
  // attacker-supplied `__proto__` / `blob` field never reaches the
  // `quotes.inputs` jsonb column.
  const merged = { ...DEFAULT_QUOTE_INPUTS, ...(parsed as Record<string, unknown>) };
  const result = quoteInputsSchema.safeParse(merged);
  if (!result.success) {
    const issue = result.error.issues[0];
    const path = issue.path.join('.');
    const message = path ? `${path}: ${issue.message}` : issue.message;
    return {
      ok: false,
      error: message,
      fieldErrors: result.error.flatten().fieldErrors,
    };
  }
  return { ok: true, data: result.data };
}

// Reject more than 2 decimal places so the persisted tax value cannot diverge
// between paths (`setQuoteTax` writes `tax.toFixed(2)`, `computeQuote` rounds
// via `roundCents`; the two can drift on >2-decimal inputs like `2.675`).
// Canonicalizing here means every call site sees the same cents.
const TAX_RE = /^\d+(\.\d{1,2})?$/;

function parseTax(formData: FormData): number | { error: string } {
  const raw = field(formData, 'tax');
  if (!raw) return 0;
  if (!TAX_RE.test(raw)) {
    return { error: 'Tax must be a non-negative number with at most 2 decimal places.' };
  }
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) {
    return { error: 'Tax must be a non-negative number.' };
  }
  // Match `computeQuote`'s tax cap so the `setQuoteTax` standalone path can't
  // bypass the same guard that `setQuoteInputs` / `createQuote` enforce
  // through the pricing module.
  if (n > MAX_DOLLARS) {
    return { error: `Tax must be ≤ ${MAX_DOLLARS}.` };
  }
  return n;
}

function moneyString(n: number): string {
  return n.toFixed(2);
}

// Short stable digest used by the `quote.edited` audit payload to mark which
// line-items snapshot a save came from without bloating the row with the full
// array. 16 hex chars of SHA-256 — collision-resistant enough for forensic
// "this edit changed lines vs. this one didn't" reads.
function hashLineItems(lineItems: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(lineItems ?? null))
    .digest('hex')
    .slice(0, 16);
}

/** Apply a freshly-computed `QuoteComputation` + `inputs` snapshot to a row.
 *  Used by the create path (in-flight insert) and the setter actions. */
function persistComputationPatch(
  inputs: QuoteInputs,
  out: ReturnType<typeof computeQuote>,
): {
  inputs: QuoteInputs;
  lineItems: ReturnType<typeof computeQuote>['lines'];
  subtotal: string;
  tax: string;
  total: string;
} {
  return {
    inputs,
    lineItems: out.lines,
    subtotal: moneyString(out.subtotal),
    tax: moneyString(out.tax),
    total: moneyString(out.total),
  };
}

export const createQuote = capabilityClient('quote:edit')
  .schema(formDataSchema)
  .action(async ({ parsedInput: formData, ctx }): Promise<CreateQuoteResult> => {
    const userId = ctx.user.id;

    const dealerId = parseId(formData, 'dealerId');
    if (dealerId == null) return { error: 'Dealer is required.' };

    // Composer Save-Draft path: callers can pass `inputs` (JSON-serialized
    // QuoteInputs) and `tax` to seed the row with a real snapshot. Absent
    // → fall back to the default empty inputs + zeroed lines/total
    // (existing 0026 P2 behavior).
    let inputsSnapshot: QuoteInputs = DEFAULT_QUOTE_INPUTS;
    let computed: ReturnType<typeof computeQuote> | null = null;
    if (formData.has('inputs')) {
      const inputResult = parseQuoteInputs(formData);
      if (!inputResult.ok) {
        return { error: inputResult.error, ...(inputResult.fieldErrors ? { fieldErrors: inputResult.fieldErrors } : {}) };
      }
      const taxResult = parseTax(formData);
      if (typeof taxResult === 'object') return taxResult;

      const catalog = await loadActiveCatalog();
      try {
        computed = computeQuote(inputResult.data, catalog, taxResult);
      } catch (err) {
        if (err instanceof QuoteInputsError) return { error: err.message };
        throw err;
      }
      inputsSnapshot = inputResult.data;
    }

    const baseInsert = {
      dealerId,
      inputs: inputsSnapshot,
      createdById: userId,
      updatedById: userId,
    };
    const insertValues = computed
      ? {
          ...baseInsert,
          ...(() => {
            const patch = persistComputationPatch(inputsSnapshot, computed);
            return {
              lineItems: patch.lineItems,
              subtotal: patch.subtotal,
              tax: patch.tax,
              total: patch.total,
            };
          })(),
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

/** Composer-side setter: replace the input snapshot, recompute lines + totals
 *  against the live catalog, persist atomically. 0046 flipped the lifecycle
 *  doctrine — `sent` (and derived `expired`) rows stay editable so coaches
 *  can fix pricing typos and Re-send. Only the terminal contract artifacts
 *  (`accepted` / `declined`) are immutable.
 *
 *  Optimistic-locking via `WHERE date_trunc('ms', updatedAt) = preloaded` —
 *  same shape as `sendQuote`. A concurrent send / accept that bumped
 *  updatedAt under us misses the UPDATE, and the re-select classifies the
 *  miss (terminal status → friendly error; otherwise "edited concurrently;
 *  please retry"). Emits `quote.edited` only when the priced output
 *  (subtotal / tax / total / lineItems) actually changed — typo-style saves
 *  on unchanged inputs are no-ops in the audit log. */
export const setQuoteInputs = capabilityClient('quote:edit')
  .schema(formDataSchema)
  .action(async ({ parsedInput: formData, ctx }): Promise<ActionResult> => {
    const userId = ctx.user.id;

    const quoteId = parseId(formData, 'quoteId');
    if (quoteId == null) return { error: 'Invalid quote id.' };

    const inputResult = parseQuoteInputs(formData);
    if (!inputResult.ok) {
      return { error: inputResult.error, ...(inputResult.fieldErrors ? { fieldErrors: inputResult.fieldErrors } : {}) };
    }
    const parsed = inputResult.data;

    // `tax` is optional — if absent, preserve whatever's on the row.
    const taxRequested = formData.has('tax') ? parseTax(formData) : null;
    if (taxRequested && typeof taxRequested === 'object') return taxRequested;

    type EditResult =
      | { ok: true; auditPayload: Record<string, unknown> | null }
      | { error: string; fieldErrors?: Record<string, string[] | undefined> };

    // Load current tax + priced-output snapshot + updatedAt (when not being
    // changed) — we still need them to recompute total, drive the
    // optimistic-lock predicate, and decide whether to emit `quote.edited`.
    // Doing this read + the guarded update inside a transaction keeps the
    // snapshot consistent with the row state.
    const txResult: EditResult = await db.transaction(async (tx): Promise<EditResult> => {
      const [row] = await tx
        .select({
          status: quotes.status,
          tax: quotes.tax,
          subtotal: quotes.subtotal,
          total: quotes.total,
          lineItems: quotes.lineItems,
          updatedAt: quotes.updatedAt,
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

      const taxNumber = taxRequested != null ? (taxRequested as number) : Number(row.tax) || 0;
      const catalog = await loadActiveCatalog();
      let computed: ReturnType<typeof computeQuote>;
      try {
        computed = computeQuote(parsed, catalog, taxNumber);
      } catch (err) {
        if (err instanceof QuoteInputsError) return { error: err.message };
        throw err;
      }

      const patch = persistComputationPatch(parsed, computed);
      const updated = await tx
        .update(quotes)
        .set({
          inputs: patch.inputs,
          lineItems: patch.lineItems,
          subtotal: patch.subtotal,
          tax: patch.tax,
          total: patch.total,
          updatedById: userId,
        })
        .where(
          and(
            eq(quotes.id, quoteId),
            sql`${quotes.status} NOT IN ('accepted', 'declined')`,
            // Same `date_trunc('milliseconds', …)` shape as `sendQuote` —
            // postgres-js decodes timestamptz at ms precision, so the
            // truncation keeps both sides comparable. ISO + ::timestamptz
            // cast forces the bound parameter to a string Postgres parses
            // back to a timestamp (raw Date binding throws).
            sql`date_trunc('milliseconds', ${quotes.updatedAt}) = ${row.updatedAt.toISOString()}::timestamptz`,
          ),
        )
        .returning({ id: quotes.id });
      if (!updated.length) {
        // Optimistic-lock miss. Re-classify against the latest row state:
        // a concurrent accept/decline gets the friendly terminal-status
        // copy; otherwise the row was edited or sent under us and the UI
        // should retry with a fresh snapshot.
        const [latest] = await tx
          .select({ status: quotes.status })
          .from(quotes)
          .where(eq(quotes.id, quoteId))
          .limit(1);
        if (!latest) return { error: 'Quote not found.' };
        if (latest.status === 'accepted' || latest.status === 'declined') {
          return {
            error: `This quote has been ${latest.status} — make a new quote to revise it.`,
          };
        }
        return { error: 'Quote was edited concurrently; please retry.' };
      }

      // Decide whether this save changed the priced output. We compare on
      // string-form money values (already canonicalized via moneyString) +
      // a short SHA-256 digest over lineItems. A no-op save (e.g. the
      // user toggled a UI field that doesn't affect pricing) skips the
      // audit emit so the Send-history reads stay clean.
      const beforePriced = {
        subtotal: row.subtotal,
        tax: row.tax,
        total: row.total,
      };
      const afterPriced = {
        subtotal: patch.subtotal,
        tax: patch.tax,
        total: patch.total,
      };
      const beforeLinesHash = hashLineItems(row.lineItems);
      const afterLinesHash = hashLineItems(patch.lineItems);
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
  });

/** Composer-side setter: override just the tax amount on a draft quote.
 *  Recomputes total = subtotal + tax (lines untouched). */
// validation: skip — single-value action (quoteId + tax); `parseTax` and
// `parseId` cover both inputs.
export const setQuoteTax = capabilityClient('quote:edit')
  .schema(formDataSchema)
  .action(async ({ parsedInput: formData, ctx }): Promise<ActionResult> => {
    const userId = ctx.user.id;

    const quoteId = parseId(formData, 'quoteId');
    if (quoteId == null) return { error: 'Invalid quote id.' };

    const tax = parseTax(formData);
    if (typeof tax === 'object') return tax;

    return db.transaction(async (tx) => {
      const [row] = await tx
        .select({ status: quotes.status, subtotal: quotes.subtotal })
        .from(quotes)
        .where(eq(quotes.id, quoteId))
        .limit(1);
      if (!row) return { error: 'Quote not found.' };
      if (row.status !== 'draft') {
        return { error: `Quote cannot be edited in status '${row.status}'.` };
      }

      const subtotal = Number(row.subtotal) || 0;
      const total = subtotal + tax;

      const updated = await tx
        .update(quotes)
        .set({
          tax: moneyString(tax),
          total: moneyString(total),
          updatedById: userId,
        })
        .where(and(eq(quotes.id, quoteId), eq(quotes.status, 'draft')))
        .returning({ id: quotes.id });
      if (!updated.length) {
        // Concurrent send/decline raced past the read-then-write window;
        // re-classify against the latest row state.
        const [latest] = await tx
          .select({ status: quotes.status })
          .from(quotes)
          .where(eq(quotes.id, quoteId))
          .limit(1);
        if (!latest) return { error: 'Quote not found.' };
        return { error: `Quote cannot be edited in status '${latest.status}'.` };
      }

      revalidateQuoteViews();
      return { ok: true };
    });
  });

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

      const result = await tx
        .update(quotes)
        .set({ dealerId, updatedById: userId })
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

type ValidatedLines = { ok: true; lines: QuoteLineItem[] } | { error: string };

const CORRUPTED_LINES_ERROR = 'Quote line items are corrupted; cannot render.';
// MAX_ADDRESS_LINES lives in ./constants because `'use server'` files may
// only export async functions (Next 16 RSC constraint).

function isFiniteNonNegative(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n) && n >= 0;
}

/** Validate a persisted `ComputedLine` snapshot before mapping into the
 *  renderer's shape. Corrupt jsonb must fail closed rather than rendering
 *  blanks/zeroes into a client-visible PDF. */
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
        lineItems: quotes.lineItems,
        subtotal: quotes.subtotal,
        tax: quotes.tax,
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

    const lineResult = validatePersistedLines(quote.lineItems);
    if ('error' in lineResult) return lineResult;

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
      lineItems: lineResult.lines,
      subtotal: Number(quote.subtotal),
      tax: Number(quote.tax),
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
        lineItems: quotes.lineItems,
        subtotal: quotes.subtotal,
        tax: quotes.tax,
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
    // sitting in Dropbox Sign awaiting signature* would confuse the signer:
    // they'd see two different Quote PDFs. Block re-send until the envelope
    // resolves (signed → MSA goes `active`; declined → manual cleanup).
    if (draft.sentAt != null) {
      const [pendingMsa] = await db
        .select({
          status: masterServiceAgreements.status,
          dropboxSignDocumentId: masterServiceAgreements.dropboxSignDocumentId,
        })
        .from(masterServiceAgreements)
        .where(
          and(
            eq(masterServiceAgreements.dealerId, draft.dealerId),
            eq(masterServiceAgreements.status, 'pending'),
          ),
        )
        .limit(1);
      if (pendingMsa && pendingMsa.dropboxSignDocumentId != null) {
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

    const lineResult = validatePersistedLines(draft.lineItems);
    if ('error' in lineResult) return lineResult;

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
      lineItems: lineResult.lines,
      subtotal: Number(draft.subtotal),
      tax: Number(draft.tax),
      total: Number(draft.total),
    };

    const rendered = await renderQuotePdf(quoteData);
    if ('error' in rendered) {
      return { error: `Quote PDF render failed: ${rendered.error}` };
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
      attachments: [
        {
          filename: quoteDownloadFilename(draft.createdAt),
          content: rendered.body,
          contentType: 'application/pdf',
        },
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
      payload: {
        pdfStorageKey: storageKey,
        emailId: emailResult.id,
        sentToEmail: recipient.email,
        sentToFirstName: recipient.firstName,
      },
    });

    revalidateQuoteViews();
    return { ok: true };
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
