// Pure pricing module — drives the quote composer (0035 Phase 3) and the PDF
// renderer (0026 Phase 3). Stateless: no Date, no randomness, no DB; the same
// inputs + catalog produce the same lines, subtotal, tax, total.
//
// **Shape principle:** the composer is a calculator, not a line-item picker.
// Coach edits a small set of structured inputs (audience, days, per-channel
// touches, retrieval bracket, travel); the line-item table is computed
// read-only output. The input snapshot is persisted alongside the computed
// lines on every save so the invoice (future Phase 7.3) can recompute against
// the same inputs and reconcile.
//
// Money discipline: amounts are stored as numeric(10,2) strings on the
// `service_items` and `quotes` tables. This module accepts either string or
// number unit prices (via `catalogUnitPriceNumber()`); computed line totals
// are returned as **numbers** for downstream stringification (the persistence
// layer formats them back to `numeric(10,2)` strings). The catalog is small
// (≤ 8 rows in v1), so the IEEE-754 rounding risk is negligible for the
// integer-multiplied lines; the round-to-cents helper guards anyway.

import { z } from 'zod';

import type { ServiceItem, ServiceItemUnit } from '@/features/services/queries';

export type QuoteInputs = {
  /** Audience size; drives `additional-contact` qty = max(0, size - 500). */
  audienceSize: number;
  /** Number of event days; drives `additional-day` qty = max(0, days - 1). */
  eventDays: number;
  /** Per-touch BDC call count. */
  bdcCallCount: number;
  /** Per-touch letter / postage count. */
  letterCount: number;
  /** Per-touch SMS / email count. */
  digitalCount: number;
  /** Record-retrieval bracket amount: typically 0 / 100 / 200 / 300 / 400.
   *  Catalog row's `unit_price_min` / `_max` define the accepted range. */
  recordRetrievalAmount: number;
  /** Travel dollar amount — coach types actual cost at quote time. */
  travelAmount: number;
  /** Freeform Hotel / Mileage / Air breakdown — rendered on PDF, not priced. */
  travelNotes: string;
  /** Additional notes rendered on the PDF. */
  quoteNotes: string;
};

export type ComputedLine = {
  code: string;
  label: string;
  unit: ServiceItemUnit;
  /** Dollar amount per unit. For range items this is the bracket amount the
   *  coach chose; for `travel` it's the typed dollar amount. */
  unitPrice: number;
  qty: number;
  lineTotal: number;
};

export type QuoteComputation = {
  lines: ComputedLine[];
  subtotal: number;
  tax: number;
  total: number;
};

/** Reasonable upper bounds — rejects adversarial / fat-finger inputs without
 *  the server having to wait for a numeric(10,2) overflow. */
const MAX_AUDIENCE = 1_000_000;
const MAX_DAYS = 365;
const MAX_TOUCHES = 1_000_000;
export const MAX_DOLLARS = 9_999_999;

const NOTES_MAX = 1_000;

/** Zod mirror of `validateQuoteInputs`. Client-side form resolver consumes
 *  this; server-side `parseQuoteInputs` still canonicalizes by hand because
 *  it must tolerate FormData (string-typed) input and discard unknown keys.
 *  Keep both in lockstep — bounds here must match the assertions below. */
export const quoteInputsSchema = z.object({
  audienceSize: z.number().int().min(0).max(MAX_AUDIENCE),
  eventDays: z.number().int().min(1).max(MAX_DAYS),
  bdcCallCount: z.number().int().min(0).max(MAX_TOUCHES),
  letterCount: z.number().int().min(0).max(MAX_TOUCHES),
  digitalCount: z.number().int().min(0).max(MAX_TOUCHES),
  recordRetrievalAmount: z.number().min(0).max(MAX_DOLLARS),
  travelAmount: z.number().min(0).max(MAX_DOLLARS),
  travelNotes: z.string().max(NOTES_MAX),
  quoteNotes: z.string().max(NOTES_MAX),
}) satisfies z.ZodType<QuoteInputs>;

export class QuoteInputsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'QuoteInputsError';
  }
}

/** Validate a candidate `QuoteInputs` snapshot. Throws `QuoteInputsError` on
 *  any field that fails the integer / non-negative / range checks. Composer
 *  Server Actions wrap the throw into a friendly `{ error }` ActionResult. */
export function validateQuoteInputs(input: QuoteInputs): void {
  assertNonNegInt(input.audienceSize, 'audienceSize', MAX_AUDIENCE);
  assertNonNegInt(input.eventDays, 'eventDays', MAX_DAYS);
  if (input.eventDays < 1) {
    throw new QuoteInputsError('eventDays must be at least 1.');
  }
  assertNonNegInt(input.bdcCallCount, 'bdcCallCount', MAX_TOUCHES);
  assertNonNegInt(input.letterCount, 'letterCount', MAX_TOUCHES);
  assertNonNegInt(input.digitalCount, 'digitalCount', MAX_TOUCHES);
  assertNonNegMoney(input.recordRetrievalAmount, 'recordRetrievalAmount');
  assertNonNegMoney(input.travelAmount, 'travelAmount');
  if (typeof input.travelNotes !== 'string' || input.travelNotes.length > NOTES_MAX) {
    throw new QuoteInputsError(`travelNotes must be a string up to ${NOTES_MAX} chars.`);
  }
  if (typeof input.quoteNotes !== 'string' || input.quoteNotes.length > NOTES_MAX) {
    throw new QuoteInputsError(`quoteNotes must be a string up to ${NOTES_MAX} chars.`);
  }
}

function assertNonNegInt(n: number, name: string, max: number): void {
  if (typeof n !== 'number' || !Number.isFinite(n) || !Number.isInteger(n) || n < 0 || n > max) {
    throw new QuoteInputsError(`${name} must be a non-negative integer ≤ ${max}.`);
  }
}

function assertNonNegMoney(n: number, name: string): void {
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 0 || n > MAX_DOLLARS) {
    throw new QuoteInputsError(`${name} must be a non-negative number ≤ ${MAX_DOLLARS}.`);
  }
}

function roundCents(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Parse a catalog row's `unitPrice` — stored as a `numeric(10,2)` string by
 *  Drizzle. Returns 0 for null (variable-priced rows like `travel`). */
function catalogUnitPriceNumber(item: Pick<ServiceItem, 'unitPrice'>): number {
  if (item.unitPrice == null) return 0;
  const n = Number(item.unitPrice);
  return Number.isFinite(n) ? n : 0;
}

/** Look up a catalog row by code. Returns undefined when the catalog doesn't
 *  carry the row (e.g. it was archived between snapshot and recompute). The
 *  caller decides whether a missing row is fatal — `computeQuote` simply
 *  omits the line, which keeps the composer renderable even when a coach
 *  archives an in-use catalog row mid-edit. */
function findCode(catalog: ServiceItem[], code: string): ServiceItem | undefined {
  return catalog.find((c) => c.code === code);
}

/** Compute the line items + totals for a draft quote.
 *
 *  Rules (locked 2026-05-08 in 0035 plan Phase 3):
 *  - `base-event` always present, qty 1.
 *  - `additional-contact` qty = max(0, audienceSize - 500); line omitted if 0.
 *  - `additional-day` qty = max(0, eventDays - 1); line omitted if 0.
 *  - `bdc-call` / `letter-postage` / `digital-record` qty from corresponding
 *    count input; line omitted if 0.
 *  - `record-retrieval` emitted iff `recordRetrievalAmount > 0`; unit price =
 *    the chosen bracket amount (range-priced).
 *  - `travel` emitted iff `travelAmount > 0`; unit price = `travelAmount`
 *    (variable; catalog row carries no unit price).
 *
 *  `tax` defaults to 0; callers pass a non-zero `taxOverride` to inject a
 *  final-tax decision (0026 Phase 3 will decide NS HST vs buyer-province).
 */
export function computeQuote(
  inputs: QuoteInputs,
  catalog: ServiceItem[],
  taxOverride = 0,
): QuoteComputation {
  validateQuoteInputs(inputs);
  if (!Number.isFinite(taxOverride) || taxOverride < 0 || taxOverride > MAX_DOLLARS) {
    throw new QuoteInputsError(`tax must be a non-negative number ≤ ${MAX_DOLLARS}.`);
  }

  const lines: ComputedLine[] = [];

  function emitFixed(code: string, qty: number): void {
    if (qty <= 0) return;
    const item = findCode(catalog, code);
    if (!item) return;
    const unitPrice = catalogUnitPriceNumber(item);
    lines.push({
      code: item.code,
      label: item.label,
      unit: item.unit,
      unitPrice,
      qty,
      lineTotal: roundCents(unitPrice * qty),
    });
  }

  function emitVariable(code: string, unitPrice: number): void {
    if (unitPrice <= 0) return;
    const item = findCode(catalog, code);
    if (!item) return;
    // Range-bound check (per plan Phase 3 OQ resolution: "coach-typed within
    // range"). UI bracket pills enforce this client-side; the pricing rule
    // lives here so direct Server Action calls can't bypass. **Fail closed**
    // when a `range`-typed catalog row is malformed (missing/non-finite
    // bounds): the only safe answer is to reject, not to skip the check.
    if (item.unit === 'range') {
      const min = item.unitPriceMin == null ? Number.NaN : Number(item.unitPriceMin);
      const max = item.unitPriceMax == null ? Number.NaN : Number(item.unitPriceMax);
      if (!Number.isFinite(min) || !Number.isFinite(max)) {
        throw new QuoteInputsError(
          `${code} catalog row is missing min/max bounds; cannot price a range item.`,
        );
      }
      if (unitPrice < min || unitPrice > max) {
        throw new QuoteInputsError(
          `${code} amount must be between ${min.toFixed(2)} and ${max.toFixed(2)} (got ${unitPrice}).`,
        );
      }
    }
    lines.push({
      code: item.code,
      label: item.label,
      unit: item.unit,
      unitPrice,
      qty: 1,
      lineTotal: roundCents(unitPrice),
    });
  }

  // Fixed-unit lines (qty derived from inputs).
  emitFixed('base-event', 1);
  emitFixed('additional-contact', Math.max(0, inputs.audienceSize - 500));
  emitFixed('additional-day', Math.max(0, inputs.eventDays - 1));
  emitFixed('bdc-call', inputs.bdcCallCount);
  emitFixed('letter-postage', inputs.letterCount);
  emitFixed('digital-record', inputs.digitalCount);

  // Variable-unit lines (unit price typed by the coach).
  emitVariable('record-retrieval', inputs.recordRetrievalAmount);
  emitVariable('travel', inputs.travelAmount);

  const subtotal = roundCents(lines.reduce((acc, l) => acc + l.lineTotal, 0));
  const tax = roundCents(taxOverride);
  const total = roundCents(subtotal + tax);

  return { lines, subtotal, tax, total };
}

/** Default inputs for a fresh draft quote. Matches the `DEFAULT_QUOTE_INPUTS`
 *  shape that `createQuote` writes for a brand-new row — extracted here so
 *  the composer can share the same default with the action layer. */
export const DEFAULT_QUOTE_INPUTS: QuoteInputs = {
  audienceSize: 500,
  eventDays: 1,
  bdcCallCount: 0,
  letterCount: 0,
  digitalCount: 0,
  recordRetrievalAmount: 0,
  travelAmount: 0,
  travelNotes: '',
  quoteNotes: '',
};
