import { describe, expect, it } from 'vitest';
import type { ServiceItem } from '@/features/services/queries';
import {
  computeQuote,
  DEFAULT_QUOTE_INPUTS,
  QuoteInputsError,
  validateQuoteInputs,
  type QuoteInputs,
} from './pricing';

// Mirrors the v1 seed in drizzle/0013_seed_service_items.sql. Numeric prices
// are kept as strings here because that's what Drizzle returns for
// `numeric(10,2)` columns — the pure function normalizes them internally.
const CATALOG: ServiceItem[] = [
  {
    id: 1,
    code: 'base-event',
    label: 'Base Event (includes 500 records)',
    unit: 'flat',
    unitPrice: '6900.00',
    unitPriceMin: null,
    unitPriceMax: null,
    description: null,
    sortOrder: 0,
  },
  {
    id: 2,
    code: 'additional-contact',
    label: 'Additional Contact',
    unit: 'per-record',
    unitPrice: '3.00',
    unitPriceMin: null,
    unitPriceMax: null,
    description: null,
    sortOrder: 1,
  },
  {
    id: 3,
    code: 'bdc-call',
    label: 'BDC Call',
    unit: 'per-touch',
    unitPrice: '2.25',
    unitPriceMin: null,
    unitPriceMax: null,
    description: null,
    sortOrder: 2,
  },
  {
    id: 4,
    code: 'letter-postage',
    label: 'Letter / Postage',
    unit: 'per-touch',
    unitPrice: '2.50',
    unitPriceMin: null,
    unitPriceMax: null,
    description: null,
    sortOrder: 3,
  },
  {
    id: 5,
    code: 'digital-record',
    label: 'Digital (SMS / Email)',
    unit: 'per-touch',
    unitPrice: '0.59',
    unitPriceMin: null,
    unitPriceMax: null,
    description: null,
    sortOrder: 4,
  },
  {
    id: 6,
    code: 'additional-day',
    label: 'Additional Day with Trainer',
    unit: 'per-day',
    unitPrice: '995.00',
    unitPriceMin: null,
    unitPriceMax: null,
    description: null,
    sortOrder: 5,
  },
  {
    id: 7,
    code: 'record-retrieval',
    label: 'Record Retrieval and Preparation',
    unit: 'range',
    unitPrice: null,
    unitPriceMin: '100.00',
    unitPriceMax: '400.00',
    description: null,
    sortOrder: 6,
  },
  {
    id: 8,
    code: 'travel',
    label: 'Travel (Hotel / Mileage / Air)',
    unit: 'flat',
    unitPrice: null,
    unitPriceMin: null,
    unitPriceMax: null,
    description: null,
    sortOrder: 7,
  },
];

function inputs(overrides: Partial<QuoteInputs> = {}): QuoteInputs {
  return { ...DEFAULT_QUOTE_INPUTS, ...overrides };
}

function findLine(out: ReturnType<typeof computeQuote>, code: string) {
  return out.lines.find((l) => l.code === code);
}

describe('computeQuote — happy paths', () => {
  it('base-only quote (audience=500, days=1, no touches) has the base-event line only', () => {
    const out = computeQuote(inputs(), CATALOG);
    expect(out.lines).toHaveLength(1);
    expect(out.lines[0]).toMatchObject({
      code: 'base-event',
      qty: 1,
      unitPrice: 6900,
      lineTotal: 6900,
    });
    expect(out.subtotal).toBe(6900);
    expect(out.tax).toBe(0);
    expect(out.total).toBe(6900);
  });

  it('audience over 500 emits additional-contact at qty=overage × $3', () => {
    const out = computeQuote(inputs({ audienceSize: 700 }), CATALOG);
    const line = findLine(out, 'additional-contact');
    expect(line).toMatchObject({ qty: 200, unitPrice: 3, lineTotal: 600 });
    expect(out.subtotal).toBe(7500);
    expect(out.total).toBe(7500);
  });

  it('multi-channel mix emits one line per non-zero count', () => {
    const out = computeQuote(
      inputs({ bdcCallCount: 100, letterCount: 50, digitalCount: 200 }),
      CATALOG,
    );
    expect(findLine(out, 'bdc-call')).toMatchObject({ qty: 100, lineTotal: 225 });
    expect(findLine(out, 'letter-postage')).toMatchObject({ qty: 50, lineTotal: 125 });
    expect(findLine(out, 'digital-record')).toMatchObject({ qty: 200, lineTotal: 118 });
    // Base $6900 + BDC 225 + Letters 125 + Digital 118 = 7368
    expect(out.subtotal).toBe(7368);
  });

  it('multi-day event emits additional-day at qty = days - 1', () => {
    const out = computeQuote(inputs({ eventDays: 3 }), CATALOG);
    expect(findLine(out, 'additional-day')).toMatchObject({ qty: 2, lineTotal: 1990 });
    expect(out.subtotal).toBe(6900 + 1990);
  });

  it('record-retrieval present iff amount > 0', () => {
    const out = computeQuote(inputs({ recordRetrievalAmount: 200 }), CATALOG);
    const line = findLine(out, 'record-retrieval');
    expect(line).toMatchObject({ qty: 1, unitPrice: 200, lineTotal: 200 });
    expect(out.subtotal).toBe(7100);
  });

  it('record-retrieval absent when amount = 0', () => {
    const out = computeQuote(inputs({ recordRetrievalAmount: 0 }), CATALOG);
    expect(findLine(out, 'record-retrieval')).toBeUndefined();
  });

  it('travel present iff amount > 0', () => {
    const out = computeQuote(inputs({ travelAmount: 487.5 }), CATALOG);
    const line = findLine(out, 'travel');
    expect(line).toMatchObject({ qty: 1, unitPrice: 487.5, lineTotal: 487.5 });
    expect(out.subtotal).toBe(7387.5);
  });

  it('travel absent when amount = 0', () => {
    const out = computeQuote(inputs({ travelAmount: 0 }), CATALOG);
    expect(findLine(out, 'travel')).toBeUndefined();
  });

  it('tax override is applied to total and reported separately', () => {
    const out = computeQuote(inputs(), CATALOG, 1035);
    expect(out.subtotal).toBe(6900);
    expect(out.tax).toBe(1035);
    expect(out.total).toBe(7935);
  });

  it('omits a line whose catalog row is missing (archived between snapshot + recompute)', () => {
    const sparse = CATALOG.filter((c) => c.code !== 'bdc-call');
    const out = computeQuote(inputs({ bdcCallCount: 100 }), sparse);
    expect(findLine(out, 'bdc-call')).toBeUndefined();
    expect(out.subtotal).toBe(6900);
  });

  it('preserves order: base, additional-contact, additional-day, bdc, letter, digital, retrieval, travel', () => {
    const out = computeQuote(
      inputs({
        audienceSize: 600,
        eventDays: 2,
        bdcCallCount: 10,
        letterCount: 5,
        digitalCount: 20,
        recordRetrievalAmount: 100,
        travelAmount: 250,
      }),
      CATALOG,
    );
    expect(out.lines.map((l) => l.code)).toEqual([
      'base-event',
      'additional-contact',
      'additional-day',
      'bdc-call',
      'letter-postage',
      'digital-record',
      'record-retrieval',
      'travel',
    ]);
  });
});

describe('computeQuote — totals + rounding', () => {
  it('rounds line totals to 2 decimal places', () => {
    // 100 digital touches × $0.59 = $59.00 exactly; verify the rounding helper
    // doesn't drift on a sum of many small multiplications.
    const out = computeQuote(inputs({ digitalCount: 100 }), CATALOG);
    expect(findLine(out, 'digital-record')!.lineTotal).toBe(59);
  });

  it('rounds the subtotal — IEEE-754 drift across many lines does not accumulate', () => {
    // 3 BDC × 2.25 + 5 letters × 2.50 + 7 digital × 0.59 = 6.75 + 12.50 + 4.13 = 23.38
    const out = computeQuote(
      inputs({ bdcCallCount: 3, letterCount: 5, digitalCount: 7 }),
      CATALOG,
    );
    expect(out.subtotal).toBe(6900 + 23.38);
  });
});

describe('validateQuoteInputs — input guards', () => {
  it('rejects NaN audience size', () => {
    expect(() => validateQuoteInputs(inputs({ audienceSize: Number.NaN }))).toThrow(
      QuoteInputsError,
    );
  });

  it('rejects Infinity audience size', () => {
    expect(() => validateQuoteInputs(inputs({ audienceSize: Number.POSITIVE_INFINITY }))).toThrow(
      QuoteInputsError,
    );
  });

  it('rejects negative inputs', () => {
    expect(() => validateQuoteInputs(inputs({ bdcCallCount: -1 }))).toThrow(QuoteInputsError);
    expect(() => validateQuoteInputs(inputs({ travelAmount: -0.01 }))).toThrow(QuoteInputsError);
  });

  it('rejects non-integer count fields', () => {
    expect(() => validateQuoteInputs(inputs({ letterCount: 1.5 }))).toThrow(QuoteInputsError);
  });

  it('rejects eventDays < 1', () => {
    expect(() => validateQuoteInputs(inputs({ eventDays: 0 }))).toThrow(QuoteInputsError);
  });

  it('rejects audience above the sanity cap', () => {
    expect(() => validateQuoteInputs(inputs({ audienceSize: 10_000_000 }))).toThrow(
      QuoteInputsError,
    );
  });

  it('rejects oversized notes', () => {
    expect(() => validateQuoteInputs(inputs({ quoteNotes: 'x'.repeat(1_001) }))).toThrow(
      QuoteInputsError,
    );
  });

  it('rejects negative tax override in computeQuote', () => {
    expect(() => computeQuote(inputs(), CATALOG, -1)).toThrow(QuoteInputsError);
  });
});

describe('computeQuote — range-bound enforcement on record-retrieval', () => {
  it('accepts record-retrieval inside catalog [min, max]', () => {
    const out = computeQuote(inputs({ recordRetrievalAmount: 250 }), CATALOG);
    expect(findLine(out, 'record-retrieval')).toMatchObject({ unitPrice: 250 });
  });

  it('rejects record-retrieval below catalog min', () => {
    expect(() =>
      computeQuote(inputs({ recordRetrievalAmount: 50 }), CATALOG),
    ).toThrow(QuoteInputsError);
  });

  it('rejects record-retrieval above catalog max', () => {
    expect(() =>
      computeQuote(inputs({ recordRetrievalAmount: 9_999_999 }), CATALOG),
    ).toThrow(QuoteInputsError);
  });

  it('accepts travel amounts above the record-retrieval range (no catalog bound on travel)', () => {
    const out = computeQuote(inputs({ travelAmount: 1_000_000 }), CATALOG);
    expect(findLine(out, 'travel')).toMatchObject({ unitPrice: 1_000_000 });
  });
});
