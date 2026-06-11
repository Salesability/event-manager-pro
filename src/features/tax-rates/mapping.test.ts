import { describe, expect, it, vi } from 'vitest';
import type { QboTaxCode, QboTaxRate } from '@/lib/quickbooks/client';
import { buildProvinceMappingRows, buildTaxCodeOptions } from './mapping';

// `mapping` imports `@/lib/quickbooks/tax-sync` → `@/lib/db` (server-only). Stub so
// the module loads; the functions tested here are pure.
vi.mock('server-only', () => ({}));
vi.mock('@/lib/db', () => ({ db: {} }));

const rates: QboTaxRate[] = [
  { Id: '12', RateValue: 13 }, // HST ON
  { Id: '20', RateValue: 5 }, // GST
  { Id: '21', RateValue: 7 }, // BC PST
];

const code = (Id: string, rateRefs: string[], over: Partial<QboTaxCode> = {}): QboTaxCode => ({
  Id,
  Active: true,
  SalesTaxRateList: { TaxRateDetail: rateRefs.map((value) => ({ TaxRateRef: { value } })) },
  ...over,
});

const hstOn = code('5', ['12'], { Name: 'HST ON' }); // 13
const gstPstBc = code('9', ['20', '21'], { Name: 'GST+PST BC' }); // 5 + 7 = 12 (group)
const noRate = code('8', [], { Name: 'GST 5%' }); // no resolvable sales rate
const inactive = code('99', ['12'], { Name: 'Old', Active: false });

describe('buildTaxCodeOptions', () => {
  it('lists active codes with summed (group-aware) rates; unresolvable → n/a; inactive dropped', () => {
    const opts = buildTaxCodeOptions([gstPstBc, hstOn, noRate, inactive], rates);
    expect(opts).toHaveLength(3); // inactive dropped
    expect(opts.map((o) => o.id).sort()).toEqual(['5', '8', '9']);
    expect(opts.find((o) => o.id === '5')).toMatchObject({ ratePct: 13, label: 'HST ON — 13%' });
    expect(opts.find((o) => o.id === '9')).toMatchObject({ ratePct: 12, label: 'GST+PST BC — 12%' }); // group sums
    expect(opts.find((o) => o.id === '8')).toMatchObject({ ratePct: null, label: 'GST 5% — rate n/a' });
  });
});

describe('buildProvinceMappingRows', () => {
  const codes = [hstOn, gstPstBc];

  it('marks a mapped province managed; no drift when the code rate matches the app rate', () => {
    const rows = buildProvinceMappingRows(
      [{ province: 'ON', label: 'Ontario', rate: '13.000', quickbooksTaxCodeId: '5' }],
      codes,
      rates,
    );
    expect(rows[0]).toMatchObject({
      province: 'ON',
      managed: true,
      currentCodeName: 'HST ON',
      currentCodeRatePct: 13,
      drift: false,
      brokenLink: false,
    });
  });

  it('flags drift when the linked code rate differs from the app rate', () => {
    const rows = buildProvinceMappingRows(
      [{ province: 'ON', label: 'Ontario', rate: '11.000', quickbooksTaxCodeId: '5' }],
      codes,
      rates,
    );
    expect(rows[0]).toMatchObject({ managed: true, drift: true, currentCodeRatePct: 13 });
  });

  it('marks an unmapped province unmanaged + offers a name-match suggestion', () => {
    const rows = buildProvinceMappingRows(
      [{ province: 'ON', label: 'Ontario', rate: '13.000', quickbooksTaxCodeId: null }],
      codes,
      rates,
    );
    expect(rows[0]).toMatchObject({ managed: false, currentCodeId: null, suggestionCodeId: '5' });
  });

  it('flags a broken link when the mapped code is absent from the live active set', () => {
    const rows = buildProvinceMappingRows(
      [{ province: 'ON', label: 'Ontario', rate: '13.000', quickbooksTaxCodeId: '404' }],
      codes,
      rates,
    );
    expect(rows[0]).toMatchObject({
      managed: true,
      brokenLink: true,
      currentCodeName: null,
      currentCodeRatePct: null,
    });
  });

  it('group code: BC maps to the summed 12% with no drift', () => {
    const rows = buildProvinceMappingRows(
      [{ province: 'BC', label: 'British Columbia', rate: '12.000', quickbooksTaxCodeId: '9' }],
      codes,
      rates,
    );
    expect(rows[0]).toMatchObject({ managed: true, currentCodeRatePct: 12, drift: false });
  });
});
