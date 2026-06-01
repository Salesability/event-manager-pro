import { describe, expect, it } from 'vitest';
import {
  computePickedTotals,
  effectiveUnit,
  QuoteInputsError,
  validatePickedLines,
  type PickedLine,
} from './pricing';

describe('effectiveUnit — coach per-line override', () => {
  const baseLine: PickedLine = {
    code: 'base-event',
    label: 'Base Event',
    unitPrice: 6900,
    qty: 1,
    lineTotal: 6900,
  };

  it('returns the catalogue unitPrice when overrideUnitPrice is absent', () => {
    expect(effectiveUnit(baseLine)).toBe(6900);
  });

  it('returns the catalogue unitPrice when overrideUnitPrice is explicitly undefined', () => {
    expect(effectiveUnit({ ...baseLine, overrideUnitPrice: undefined })).toBe(6900);
  });

  it('returns the override when overrideUnitPrice is set', () => {
    expect(effectiveUnit({ ...baseLine, overrideUnitPrice: 5500 })).toBe(5500);
  });

  it('returns the override even when it is 0 (a coach courtesy zero-out)', () => {
    expect(effectiveUnit({ ...baseLine, overrideUnitPrice: 0 })).toBe(0);
  });
});

describe('computePickedTotals (0062 picker)', () => {
  const pick = (over: Partial<PickedLine> = {}): PickedLine => ({
    serviceItemId: 10,
    code: 'vip-event',
    label: 'VIP Event',
    description: 'Premium on-site activation',
    qty: 1,
    unitPrice: 2500,
    lineTotal: 0, // recomputed
    ...over,
  });

  it('totals a single line by catalogue price × qty', () => {
    const r = computePickedTotals([pick({ qty: 2 })]);
    expect(r.lines[0].lineTotal).toBe(5000);
    expect(r.subtotal).toBe(5000);
    expect(r.tax).toBe(0);
    expect(r.total).toBe(5000);
  });

  it('honors the per-quote override over the catalogue seed', () => {
    const r = computePickedTotals([pick({ qty: 3, unitPrice: 2500, overrideUnitPrice: 2000 })]);
    expect(r.lines[0].lineTotal).toBe(6000); // 2000 × 3, not 2500 × 3
    expect(r.subtotal).toBe(6000);
  });

  it('sums multiple lines and adds the typed tax', () => {
    const r = computePickedTotals(
      [pick({ code: 'a', qty: 1, unitPrice: 1000 }), pick({ code: 'b', qty: 2, unitPrice: 250 })],
      150,
    );
    expect(r.subtotal).toBe(1500);
    expect(r.tax).toBe(150);
    expect(r.total).toBe(1650);
  });

  it('returns zeros for an empty quote', () => {
    const r = computePickedTotals([]);
    expect(r.subtotal).toBe(0);
    expect(r.total).toBe(0);
  });

  it('rounds to cents', () => {
    const r = computePickedTotals([pick({ qty: 3, unitPrice: 10.335 })]);
    expect(r.lines[0].lineTotal).toBe(31.01); // 31.005 → 31.01
  });

  it('does not mutate the input lines', () => {
    const input = [pick({ qty: 2, unitPrice: 100 })];
    computePickedTotals(input);
    expect(input[0].lineTotal).toBe(0); // untouched
  });

  it('throws on a negative taxOverride', () => {
    expect(() => computePickedTotals([pick()], -1)).toThrow(QuoteInputsError);
  });
});

describe('validatePickedLines (0062 picker)', () => {
  const ok: PickedLine = {
    serviceItemId: 10,
    code: 'vip-event',
    label: 'VIP Event',
    qty: 1,
    unitPrice: 2500,
    lineTotal: 2500,
  };

  it('accepts a well-formed line', () => {
    expect(() => validatePickedLines([ok])).not.toThrow();
  });

  it('rejects qty < 1', () => {
    expect(() => validatePickedLines([{ ...ok, qty: 0 }])).toThrow(QuoteInputsError);
  });

  it('rejects a non-integer qty', () => {
    expect(() => validatePickedLines([{ ...ok, qty: 1.5 }])).toThrow(QuoteInputsError);
  });

  it('rejects a negative price', () => {
    expect(() => validatePickedLines([{ ...ok, unitPrice: -1 }])).toThrow(QuoteInputsError);
  });

  it('rejects a negative override', () => {
    expect(() => validatePickedLines([{ ...ok, overrideUnitPrice: -5 }])).toThrow(QuoteInputsError);
  });

  it('rejects an over-max price', () => {
    expect(() => validatePickedLines([{ ...ok, unitPrice: 10_000_000 }])).toThrow(QuoteInputsError);
  });

  it('rejects an empty code or label', () => {
    expect(() => validatePickedLines([{ ...ok, code: '' }])).toThrow(QuoteInputsError);
    expect(() => validatePickedLines([{ ...ok, label: '  ' }])).toThrow(QuoteInputsError);
  });
});
