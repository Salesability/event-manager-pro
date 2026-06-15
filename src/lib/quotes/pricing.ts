// Pure pricing module for the SKU line-item picker (0062). Stateless: no Date,
// no randomness, no DB — the same picked lines + tax produce the same totals.
//
// Money discipline: amounts are stored as numeric(10,2) strings on the
// `service_items` / `quote_line_items` / `quotes` tables. This module works in
// numbers; computed line totals are returned as **numbers** for downstream
// stringification (the persistence layer formats them back to `numeric` strings
// via `moneyString`). The round-to-cents helper guards IEEE-754 drift.
//
// History: this module used to drive a parametric *calculator* (structured
// inputs auto-derived into 8 hardcoded catalogue codes). 0062 reversed that to
// a picker; the calculator (`computeQuote` et al.) was deleted in Phase 7.

export type QuoteInputs = {
  /** Audience size. Retained on the `quotes.inputs` jsonb for the
   *  production/reports/calendar readers; no longer composer-driven (0062). */
  audienceSize: number;
  eventDays: number;
  bdcCallCount: number;
  letterCount: number;
  digitalCount: number;
  recordRetrievalAmount: number;
  travelAmount: number;
  travelNotes: string;
  /** Free-text notes rendered on the PDF — the one input the picker composer
   *  still writes. */
  quoteNotes: string;
};

/** A line on the SKU picker. Superset of the persisted fields the
 *  `quote_line_items` table carries. The coach picks a catalogue SKU (which
 *  seeds `serviceItemId`/`code`/`label`/`description`/`unitPrice`), sets `qty`,
 *  and may tune the price per quote via `overrideUnitPrice`. */
export type PickedLine = {
  /** Catalogue row the coach picked. Optional only for legacy rows backfilled
   *  from the pre-0062 jsonb snapshot (those carried no service-item id). */
  serviceItemId?: number;
  code: string;
  label: string;
  description?: string;
  qty: number;
  /** Catalogue seed price, snapshotted at pick time. */
  unitPrice: number;
  /** Coach's per-quote price when changed off the catalogue seed (0062
   *  "seed-then-editable"). Absent on lines the coach hasn't tuned. */
  overrideUnitPrice?: number;
  lineTotal: number;
};

export type PickedQuoteComputation = {
  lines: PickedLine[];
  subtotal: number;
  tax: number;
  total: number;
};

/** Upper bound on a single line's quantity — rejects fat-finger / adversarial
 *  inputs before the numeric(12,2) line total can overflow. */
const MAX_QTY = 1_000_000;

/** Rejects adversarial / fat-finger dollar inputs before a numeric(10,2)
 *  overflow. */
export const MAX_DOLLARS = 9_999_999;

export class QuoteInputsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'QuoteInputsError';
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

/** Returns the per-unit dollar amount that drives line totals, PDF rendering,
 *  and `subtotal`/`total`. Prefers the coach's per-line override and falls back
 *  to the catalogue-derived `unitPrice` snapshot. Structural param so it serves
 *  any priced line shape. */
export function effectiveUnit(line: { unitPrice: number; overrideUnitPrice?: number }): number {
  return line.overrideUnitPrice ?? line.unitPrice;
}

/** Validate a candidate set of picked lines. Throws `QuoteInputsError` on the
 *  first line that fails: non-empty `code`/`label`, integer qty in
 *  `[1, MAX_QTY]`, finite non-negative `unitPrice`/`overrideUnitPrice` ≤
 *  MAX_DOLLARS. The composer enforces these client-side; this lives here so a
 *  direct Server Action call can't bypass. */
export function validatePickedLines(lines: PickedLine[]): void {
  for (const line of lines) {
    if (typeof line.code !== 'string' || line.code.trim() === '') {
      throw new QuoteInputsError('Each line needs a catalogue code.');
    }
    if (typeof line.label !== 'string' || line.label.trim() === '') {
      throw new QuoteInputsError(`Line ${line.code} needs a label.`);
    }
    assertNonNegInt(line.qty, `qty for ${line.code}`, MAX_QTY);
    if (line.qty < 1) {
      throw new QuoteInputsError(`qty for ${line.code} must be at least 1.`);
    }
    assertNonNegMoney(line.unitPrice, `unitPrice for ${line.code}`);
    if (line.overrideUnitPrice != null) {
      assertNonNegMoney(line.overrideUnitPrice, `overrideUnitPrice for ${line.code}`);
    }
  }
}

/** How a quote's tax is determined. `ratePct` is the dealer's province
 *  sales-tax percent (0 when the dealer has no province / no rate). Tax is
 *  always `subtotal × ratePct/100` — 0080 removed the manual per-quote override
 *  (QuickBooks owns the rate; an overridden quote couldn't be pushed to QB). */
export type QuoteTaxBasis = {
  ratePct?: number;
};

/** Recompute line totals + roll-ups for a set of picked lines (0062). Totals are
 *  `effectiveUnit(line) × qty` summed; tax is `subtotal × ratePct/100` from the
 *  dealer's province. Returns NEW `PickedLine` objects (immutable) so the caller
 *  can hand the result straight to the persist path. */
export function computePickedTotals(
  lines: PickedLine[],
  tax: QuoteTaxBasis = {},
): PickedQuoteComputation {
  validatePickedLines(lines);
  const ratePct = tax.ratePct ?? 0;
  if (!Number.isFinite(ratePct) || ratePct < 0 || ratePct > 100) {
    throw new QuoteInputsError('Tax rate must be between 0 and 100%.');
  }
  const recomputed: PickedLine[] = lines.map((line) => ({
    ...line,
    lineTotal: roundCents(effectiveUnit(line) * line.qty),
  }));
  const subtotal = roundCents(recomputed.reduce((acc, l) => acc + l.lineTotal, 0));
  const tax_ = roundCents(subtotal * (ratePct / 100));
  const total = roundCents(subtotal + tax_);
  return { lines: recomputed, subtotal, tax: tax_, total };
}

/** Default `quotes.inputs` bag for a fresh draft. The picker only writes
 *  `quoteNotes`; the other fields persist as zeros for the non-composer readers
 *  that still consume the column. */
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
