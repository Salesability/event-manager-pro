import { describe, expect, it, vi } from 'vitest';
import {
  type QuotePushDealer,
  type QuotePushLine,
  type QuotePushQuote,
  checkQuotePushReadiness,
  mapQuoteToEstimate,
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
  tax: '0',
  taxCodeId: null,
  taxOverride: null,
  ...over,
});

describe('checkQuotePushReadiness', () => {
  it('ok when dealer + lines are linked (untaxed quote)', () => {
    expect(checkQuotePushReadiness(quote(), dealer(), [line()])).toEqual({ ok: true });
  });

  it('ok when a taxed quote has a mapped tax code', () => {
    expect(
      checkQuotePushReadiness(quote({ tax: '52.00', taxCodeId: '5' }), dealer(), [line()]),
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
    // tax via the QBO tax code (QBO computes), not a TotalTax override
    expect(est.TxnTaxDetail).toEqual({ TxnTaxCodeRef: { value: '5' } });
    expect(est.GlobalTaxCalculation).toBeUndefined();
    expect(est.Line).toHaveLength(1);
    const l = est.Line[0];
    expect(l.DetailType).toBe('SalesItemLineDetail');
    expect(l.Amount).toBe(180);
    // override (90) wins over unitPrice (100) per effectiveUnit
    expect(l.SalesItemLineDetail).toEqual({ ItemRef: { value: '7' }, Qty: 2, UnitPrice: 90 });
  });

  it('omits TxnTaxDetail when the quote tax is zero', () => {
    expect(mapQuoteToEstimate(quote({ tax: '0' }), [line()], dealer()).TxnTaxDetail).toBeUndefined();
  });
});
