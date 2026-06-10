import { describe, expect, it, vi } from 'vitest';
import type { QboTaxCode } from '@/lib/quickbooks/client';
import {
  applyTaxCodeSync,
  codeNamesProvince,
  decodeTaxSyncSummary,
  planTaxRateWrites,
  resolveCodeRatePct,
  resolveProvinceLinksByName,
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

describe('planTaxRateWrites', () => {
  const linked = (province: string, taxCodeId: string, ratePct: number) =>
    ({ province, taxCodeId, ratePct, status: 'linked' as const });

  it('adopts QB rate + sets the code id on a linked province', () => {
    const rows = [{ id: 1, province: 'ON', rate: '12.000', current: null }];
    expect(planTaxRateWrites(rows, [linked('ON', '5', 13)])).toEqual([
      { id: 1, quickbooksTaxCodeId: '5', rate: '13.000' },
    ]);
  });

  it('sets only the code id when the rate is already aligned', () => {
    const rows = [{ id: 1, province: 'ON', rate: '13.000', current: null }];
    expect(planTaxRateWrites(rows, [linked('ON', '5', 13)])).toEqual([
      { id: 1, quickbooksTaxCodeId: '5', rate: null }, // rate unchanged → not written
    ]);
  });

  it('omits a no-op (rate + code already in the desired state)', () => {
    const rows = [{ id: 1, province: 'ON', rate: '13.000', current: '5' }];
    expect(planTaxRateWrites(rows, [linked('ON', '5', 13)])).toEqual([]);
  });

  it('clears a stale code link on an unmanaged province but keeps its app rate', () => {
    const rows = [{ id: 2, province: 'BC', rate: '12.000', current: '99' }];
    const links = [{ province: 'BC', taxCodeId: null, ratePct: null, status: 'unmatched' as const }];
    expect(planTaxRateWrites(rows, links)).toEqual([
      { id: 2, quickbooksTaxCodeId: null, rate: null }, // no rate write → app rate kept
    ]);
  });

  it('leaves an already-unmanaged province untouched (no write)', () => {
    const rows = [{ id: 3, province: 'QC', rate: '14.975', current: null }];
    const links = [{ province: 'QC', taxCodeId: null, ratePct: null, status: 'ambiguous' as const }];
    expect(planTaxRateWrites(rows, links)).toEqual([]);
  });
});

// --- 0075: name-heuristic matching --------------------------------------------

describe('codeNamesProvince', () => {
  it('matches the 2-letter code as a word token', () => {
    expect(codeNamesProvince('HST ON', 'ON')).toBe(true);
    expect(codeNamesProvince('GST/PST BC', 'BC')).toBe(true);
    expect(codeNamesProvince('HST ON', 'BC')).toBe(false);
  });

  it('matches the full province name (case-insensitive)', () => {
    expect(codeNamesProvince('Ontario Sales Tax', 'ON')).toBe(true);
    expect(codeNamesProvince('quebec qst', 'QC')).toBe(true);
  });

  it('does NOT match federal-only / shared names or substrings', () => {
    expect(codeNamesProvince('GST', 'ON')).toBe(false);
    expect(codeNamesProvince('Exempt', 'ON')).toBe(false);
    expect(codeNamesProvince('Out of scope', 'ON')).toBe(false);
    expect(codeNamesProvince('Non-taxable', 'ON')).toBe(false); // "on" inside "Non" → no token
    expect(codeNamesProvince('HST', 'NB')).toBe(false); // shared Atlantic HST names no province
    expect(codeNamesProvince(undefined, 'ON')).toBe(false);
  });

  it('does NOT treat the English word "on" as Ontario (case-sensitive abbr)', () => {
    // Regression: a lowercase-"on" code name must not false-match ON.
    expect(codeNamesProvince('GST on sales', 'ON')).toBe(false);
    expect(codeNamesProvince('Tax on purchases', 'ON')).toBe(false);
    expect(codeNamesProvince('HST ON', 'ON')).toBe(true); // uppercase token still matches
  });
});

describe('resolveProvinceLinksByName', () => {
  it('links a province to the single code naming it + carries QB rate to adopt', () => {
    const links = resolveProvinceLinksByName([{ province: 'ON' }], [hstOn, exempt, gstPstBc], rateById);
    expect(links).toEqual([{ province: 'ON', taxCodeId: '5', ratePct: 13, status: 'linked' }]);
  });

  it('unmatched when no code names the province (regardless of rate)', () => {
    const links = resolveProvinceLinksByName([{ province: 'QC' }], [hstOn, exempt], rateById);
    expect(links[0]).toEqual({ province: 'QC', taxCodeId: null, ratePct: null, status: 'unmatched' });
  });

  it('ambiguous when >1 active code names the province', () => {
    const dup = code('99', ['12'], { Name: 'HST ON (old)' });
    const links = resolveProvinceLinksByName([{ province: 'ON' }], [hstOn, dup], rateById);
    expect(links[0]).toEqual({ province: 'ON', taxCodeId: null, ratePct: null, status: 'ambiguous' });
  });

  it('a lone naming code whose rate cannot be resolved → unmatched', () => {
    const broken = code('7', ['999'], { Name: 'HST ON' }); // rate ref 999 unknown
    const links = resolveProvinceLinksByName([{ province: 'ON' }], [broken], rateById);
    expect(links[0]).toEqual({ province: 'ON', taxCodeId: null, ratePct: null, status: 'unmatched' });
  });

  it('ambiguous when 2 codes name a province even if only one rate resolves', () => {
    // Regression: ambiguity is counted by NAME before rate-resolvability, so a
    // broken duplicate does not let the resolvable one silently win.
    const broken = code('99', ['999'], { Name: 'HST ON' }); // names ON, rate unresolvable
    const links = resolveProvinceLinksByName([{ province: 'ON' }], [hstOn, broken], rateById);
    expect(links[0]).toEqual({ province: 'ON', taxCodeId: null, ratePct: null, status: 'ambiguous' });
  });

  it('ignores inactive codes', () => {
    const inactive = code('5', ['12'], { Name: 'HST ON', Active: false });
    const links = resolveProvinceLinksByName([{ province: 'ON' }], [inactive], rateById);
    expect(links[0].status).toBe('unmatched');
  });
});

describe('applyTaxCodeSync — empty-read guard', () => {
  it('fails closed (throws) on empty codes or rates, never clearing links', async () => {
    const rates = [{ Id: '12', RateValue: 13 }];
    // exec is never reached — the guard throws first — so a dummy is safe.
    const exec = {} as never;
    await expect(applyTaxCodeSync([], rates, exec)).rejects.toThrow(/no tax codes or rates/i);
    await expect(applyTaxCodeSync([hstOn], [], exec)).rejects.toThrow(/no tax codes or rates/i);
  });
});

describe('decodeTaxSyncSummary', () => {
  it('round-trips and rejects garbage', () => {
    expect(decodeTaxSyncSummary('3.2.1')).toEqual({ linked: 3, unmatched: 2, ambiguous: 1 });
    expect(decodeTaxSyncSummary('bad')).toBeNull();
    expect(decodeTaxSyncSummary(null)).toBeNull();
  });
});
