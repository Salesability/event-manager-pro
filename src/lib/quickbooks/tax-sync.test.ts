import { describe, expect, it, vi } from 'vitest';
import type { QboTaxCode } from '@/lib/quickbooks/client';
import {
  decodeTaxSyncSummary,
  matchProvinceTaxCode,
  resolveCodeRatePct,
  resolveProvinceLinks,
} from './tax-sync';

// `tax-sync` imports `@/lib/db` + `./client` (server-only). Stub so the module
// loads; the functions tested here are pure.
vi.mock('server-only', () => ({}));
vi.mock('@/lib/db', () => ({ db: {} }));

// TaxRate.Id → RateValue (percent). HST ON = 13; GST = 5; BC PST = 7; Exempt = 0.
const rateById = new Map<string, number>([
  ['12', 13],
  ['1', 0],
  ['20', 5],
  ['21', 7],
]);

const code = (Id: string, rateRefs: string[], over: Partial<QboTaxCode> = {}): QboTaxCode => ({
  Id,
  Active: true,
  SalesTaxRateList: { TaxRateDetail: rateRefs.map((value) => ({ TaxRateRef: { value } })) },
  ...over,
});

const hstOn = code('5', ['12'], { Name: 'HST ON' }); // 13
const exempt = code('2', ['1'], { Name: 'Exempt' }); // 0
const gstPstBc = code('9', ['20', '21'], { Name: 'GST+PST BC' }); // 5 + 7 = 12

describe('resolveCodeRatePct', () => {
  it('sums the referenced rates (single + group)', () => {
    expect(resolveCodeRatePct(hstOn, rateById)).toBe(13);
    expect(resolveCodeRatePct(gstPstBc, rateById)).toBe(12);
  });

  it('null when no details or an unresolvable rate ref', () => {
    expect(resolveCodeRatePct(code('4', []), rateById)).toBeNull();
    expect(resolveCodeRatePct(code('4', ['999']), rateById)).toBeNull();
  });
});

describe('matchProvinceTaxCode', () => {
  const codes = [hstOn, exempt, gstPstBc];

  it('matches a province rate to the unambiguous code', () => {
    expect(matchProvinceTaxCode(13, codes, rateById)).toEqual({ taxCodeId: '5', ambiguous: false });
    expect(matchProvinceTaxCode(12, codes, rateById)).toEqual({ taxCodeId: '9', ambiguous: false });
  });

  it('no match → null, not ambiguous', () => {
    expect(matchProvinceTaxCode(14.975, codes, rateById)).toEqual({ taxCodeId: null, ambiguous: false });
  });

  it('ambiguous when >1 active code shares the rate', () => {
    const dup = code('99', ['12'], { Name: 'HST dup' }); // also 13
    expect(matchProvinceTaxCode(13, [hstOn, dup], rateById)).toEqual({
      taxCodeId: null,
      ambiguous: true,
    });
  });

  it('ignores inactive codes', () => {
    expect(matchProvinceTaxCode(13, [code('5', ['12'], { Active: false })], rateById)).toEqual({
      taxCodeId: null,
      ambiguous: false,
    });
  });
});

describe('resolveProvinceLinks', () => {
  it('links a 1:1 province↔code rate match', () => {
    const links = resolveProvinceLinks([{ province: 'ON', rate: '13.000' }], [hstOn], rateById);
    expect(links).toEqual([{ province: 'ON', taxCodeId: '5', status: 'linked' }]);
  });

  it('marks BOTH provinces ambiguous when they share a rate but only one code exists', () => {
    // BC + MB both 12%, only the GST+PST (12%) code exists → neither auto-links
    // (rate alone can't say which province owns the code).
    const links = resolveProvinceLinks(
      [
        { province: 'BC', rate: '12.000' },
        { province: 'MB', rate: '12.000' },
        { province: 'ON', rate: '13.000' },
      ],
      [hstOn, gstPstBc],
      rateById,
    );
    const byProv = Object.fromEntries(links.map((l) => [l.province, l]));
    expect(byProv.BC.status).toBe('ambiguous');
    expect(byProv.BC.taxCodeId).toBeNull();
    expect(byProv.MB.status).toBe('ambiguous');
    expect(byProv.ON).toEqual({ province: 'ON', taxCodeId: '5', status: 'linked' });
  });

  it('marks a province unmatched when no code matches its rate', () => {
    const links = resolveProvinceLinks([{ province: 'QC', rate: '14.975' }], [hstOn], rateById);
    expect(links[0]).toEqual({ province: 'QC', taxCodeId: null, status: 'unmatched' });
  });
});

describe('decodeTaxSyncSummary', () => {
  it('round-trips and rejects garbage', () => {
    expect(decodeTaxSyncSummary('3.2.1')).toEqual({ linked: 3, unmatched: 2, ambiguous: 1 });
    expect(decodeTaxSyncSummary('bad')).toBeNull();
    expect(decodeTaxSyncSummary(null)).toBeNull();
  });
});
