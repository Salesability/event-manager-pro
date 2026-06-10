import { describe, expect, it, vi } from 'vitest';
import {
  type QuotePushDealer,
  type QuotePushLine,
  type QuotePushQuote,
  checkQuotePushReadiness,
  mapQuoteToEstimate,
  quoteTaxMatchesRate,
} from './quote-push';

// `quote-push` imports `@/lib/db` + `./client` (which pulls in `server-only`).
// Stub both so the module loads; the functions tested here are pure.
vi.mock('server-only', () => ({}));
vi.mock('@/lib/db', () => ({ db: {} }));

const dealer = (over: Partial<QuotePushDealer> = {}): QuotePushDealer => ({
  id: 1,
  name: 'Acme Motors',
  quickbooksId: '42',
  ...over,
});
const line = (over: Partial<QuotePushLine> = {}): QuotePushLine => ({
  code: 'base-event',
  label: 'Base Event',
  qty: 1,
  unitPrice: '6900.00',
  overrideUnitPrice: null,
  lineTotal: '6900.00',
  itemQuickbooksId: '5',
  ...over,
});
const quote = (over: Partial<QuotePushQuote> = {}): QuotePushQuote => ({
  id: 10,
  quickbooksEstimateId: null,
  subtotal: '0',
  tax: '0',
  taxCodeId: null,
  provinceRatePct: null,
  taxOverride: null,
  ...over,
});

describe('checkQuotePushReadiness', () => {
  it('ok when dealer + lines are linked (untaxed quote)', () => {
    expect(checkQuotePushReadiness(quote(), dealer(), [line()])).toEqual({ ok: true });
  });

  it('ok when a taxed quote has a mapped tax code whose rate matches', () => {
    expect(
      checkQuotePushReadiness(
        quote({ subtotal: '400.00', tax: '52.00', taxCodeId: '5', provinceRatePct: '13.000' }),
        dealer(),
        [line()],
      ),
    ).toEqual({ ok: true });
  });

  it('fails when the dealer is not linked', () => {
    const r = checkQuotePushReadiness(quote(), dealer({ quickbooksId: null }), [line()]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/Sync dealers/i);
  });

  it('fails when a line SKU is unlinked, naming the codes', () => {
    const r = checkQuotePushReadiness(quote(), dealer(), [
      line(),
      line({ code: 'travel', itemQuickbooksId: null }),
    ]);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toMatch(/Pull items/i);
      expect(r.reason).toContain('travel');
    }
  });

  it('fails on a quote with no lines', () => {
    expect(checkQuotePushReadiness(quote(), dealer(), []).ok).toBe(false);
  });

  it('fails a taxed quote whose province has no mapped tax code', () => {
    const r = checkQuotePushReadiness(quote({ tax: '52.00', taxCodeId: null }), dealer(), [line()]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/Pull tax codes/i);
  });

  it('fails a quote with a manual tax override', () => {
    const r = checkQuotePushReadiness(
      quote({ tax: '60.00', taxCodeId: '5', taxOverride: '60.00' }),
      dealer(),
      [line()],
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/override/i);
  });

  it('fails when the quote tax no longer matches the current province rate (drift)', () => {
    // subtotal 400 × 15% = $60, but the quote's snapshot tax is $52 (was 13%).
    const r = checkQuotePushReadiness(
      quote({ subtotal: '400.00', tax: '52.00', taxCodeId: '5', provinceRatePct: '15.000' }),
      dealer(),
      [line()],
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/rate changed|no longer matches/i);
  });
});

describe('quoteTaxMatchesRate', () => {
  it('true when tax == round(subtotal × rate)', () => {
    expect(quoteTaxMatchesRate(400, 52, 13)).toBe(true);
    expect(quoteTaxMatchesRate(6900, 897, 13)).toBe(true);
    expect(quoteTaxMatchesRate(100, 14.975, 14.975)).toBe(true);
  });
  it('false on a rate mismatch beyond a cent', () => {
    expect(quoteTaxMatchesRate(400, 52, 15)).toBe(false);
    expect(quoteTaxMatchesRate(400, 60, 13)).toBe(false);
  });
});

describe('mapQuoteToEstimate', () => {
  it('maps CustomerRef, line ItemRef/qty/unit/amount, and the tax code', () => {
    const est = mapQuoteToEstimate(
      quote({ tax: '897.00', taxCodeId: '5' }),
      [
        line({
          qty: 2,
          unitPrice: '100.00',
          overrideUnitPrice: '90.00',
          lineTotal: '180.00',
          itemQuickbooksId: '7',
        }),
      ],
      dealer({ quickbooksId: '42' }),
    );
    expect(est.CustomerRef.value).toBe('42');
    // tax via a PER-LINE TaxCodeRef (QBO Canada requires it; QBO computes), not
    // a txn-level code or a TotalTax override
    expect(est.TxnTaxDetail).toBeUndefined();
    expect(est.Line).toHaveLength(1);
    const l = est.Line[0];
    expect(l.DetailType).toBe('SalesItemLineDetail');
    expect(l.Amount).toBe(180);
    // override (90) wins over unitPrice (100) per effectiveUnit; line carries the code
    expect(l.SalesItemLineDetail).toEqual({
      ItemRef: { value: '7' },
      Qty: 2,
      UnitPrice: 90,
      TaxCodeRef: { value: '5' },
    });
  });

  it('omits the line TaxCodeRef + TxnTaxDetail when the quote tax is zero', () => {
    const est = mapQuoteToEstimate(quote({ tax: '0' }), [line()], dealer());
    expect(est.TxnTaxDetail).toBeUndefined();
    expect(est.Line[0].SalesItemLineDetail?.TaxCodeRef).toBeUndefined();
  });
});
