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
  ...over,
});

describe('checkQuotePushReadiness', () => {
  it('ok when the dealer and every line are linked', () => {
    expect(checkQuotePushReadiness(dealer(), [line()])).toEqual({ ok: true });
  });

  it('fails when the dealer is not linked', () => {
    const r = checkQuotePushReadiness(dealer({ quickbooksId: null }), [line()]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/Sync dealers/i);
  });

  it('fails when a line SKU is unlinked, naming the codes', () => {
    const r = checkQuotePushReadiness(dealer(), [
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
    expect(checkQuotePushReadiness(dealer(), []).ok).toBe(false);
  });
});

describe('mapQuoteToEstimate', () => {
  it('maps CustomerRef, line ItemRef/qty/unit/amount, and a tax override', () => {
    const est = mapQuoteToEstimate(
      quote({ tax: '897.00' }),
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
    expect(est.GlobalTaxCalculation).toBe('TaxExcluded');
    expect(est.TxnTaxDetail).toEqual({ TotalTax: 897 });
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
