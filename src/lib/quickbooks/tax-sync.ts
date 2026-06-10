import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { taxRates } from '@/lib/db/schema';
import { CA_PROVINCE_NAMES, type CaProvinceCode } from '@/lib/ca-provinces';
import type { QboTaxCode, QboTaxRate } from '@/lib/quickbooks/client';

// Map the app's province tax rates (0065) onto the connected QBO company's
// TaxCodes (0074). The Estimate push (quote-push.ts) sets
// `TxnTaxDetail.TxnTaxCodeRef = { value: tax_rates.quickbooks_tax_code_id }` so
// QBO computes tax with its own code — replacing the dropped `TotalTax` override
// (see docs/chunks/.../0074-quickbooks-tax-alignment/decision.md).
//
// Matching is by RATE: a province links to the (single) QBO TaxCode whose summed
// sales rate equals the province's rate. Unambiguous-only — if zero or >1 codes
// match, the province is left unlinked (the push then fails closed). Rate-
// collision provinces (e.g. the 15% HST group) won't auto-link; a manual mapping
// UI is a follow-up.

type Database = typeof db;
type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
type Executor = Database | Transaction;

// A TaxCode's effective sales rate = the sum of its `SalesTaxRateList` details'
// referenced `TaxRate.RateValue`s (a single rate for HST; two for GST+PST
// groups). Returns null when any referenced rate can't be resolved.
export function resolveCodeRatePct(
  code: QboTaxCode,
  rateById: Map<string, number>,
): number | null {
  const details = code.SalesTaxRateList?.TaxRateDetail ?? [];
  if (details.length === 0) return null;
  let sum = 0;
  for (const d of details) {
    const id = d.TaxRateRef?.value;
    const rv = id != null ? rateById.get(id) : undefined;
    if (rv == null) return null;
    sum += rv;
  }
  return sum;
}

export type TaxCodeMatch = { taxCodeId: string | null; ambiguous: boolean };

// Pure: find the unambiguous QBO TaxCode for a province rate (percent).
export function matchProvinceTaxCode(
  appRatePct: number,
  codes: QboTaxCode[],
  rateById: Map<string, number>,
): TaxCodeMatch {
  const matches = codes
    .filter((c) => c.Active !== false)
    .map((c) => ({ id: c.Id, rate: resolveCodeRatePct(c, rateById) }))
    .filter((c) => c.rate != null && Math.abs(c.rate - appRatePct) < 0.001);
  if (matches.length === 1) return { taxCodeId: matches[0].id, ambiguous: false };
  return { taxCodeId: null, ambiguous: matches.length > 1 };
}

export type ProvinceLink = {
  province: string;
  taxCodeId: string | null;
  status: 'linked' | 'unmatched' | 'ambiguous';
};

// Pure: resolve every province's final link, accounting for collisions BOTH ways.
// A province is `ambiguous` (→ unlinked) when either >1 QBO code matches its rate
// (matchProvinceTaxCode) OR the single matched code is also claimed by another
// province at the same rate (e.g. BC + MB both 12% but only one 12% code exists)
// — rate alone can't say which province owns the code, so we link neither and
// leave it for a manual mapping (follow-up). Only a 1:1 province↔code rate match
// auto-links.
export function resolveProvinceLinks(
  appRates: { province: string; rate: string | number }[],
  qboCodes: QboTaxCode[],
  rateById: Map<string, number>,
): ProvinceLink[] {
  const tentative = appRates.map((ar) => ({
    province: ar.province,
    match: matchProvinceTaxCode(Number(ar.rate), qboCodes, rateById),
  }));
  const claims = new Map<string, number>();
  for (const t of tentative) {
    if (t.match.taxCodeId) claims.set(t.match.taxCodeId, (claims.get(t.match.taxCodeId) ?? 0) + 1);
  }
  return tentative.map((t) => {
    const collision = t.match.taxCodeId != null && (claims.get(t.match.taxCodeId) ?? 0) > 1;
    if (collision || t.match.ambiguous) {
      return { province: t.province, taxCodeId: null, status: 'ambiguous' };
    }
    if (t.match.taxCodeId) return { province: t.province, taxCodeId: t.match.taxCodeId, status: 'linked' };
    return { province: t.province, taxCodeId: null, status: 'unmatched' };
  });
}

// --- 0075: name-heuristic matching (QuickBooks is the tax-rate source of truth)
// Rate-matching (above) is circular once the goal is to pull QB's possibly-
// *different* rate, so a province is matched to its QB code by JURISDICTION/NAME
// and then adopts that code's rate. See docs/chunks/0075-.../decision.md.

// Does this QB tax-code name identify a specific province? Matches the province's
// 2-letter code as a WORD TOKEN ("HST ON" → ON) or its full name ("Ontario …" →
// ON), case-insensitive. Federal-only names ("GST", "Exempt", "Out of scope")
// and shared HST names name no province → those provinces stay app-managed. The
// word boundary on the abbreviation avoids false hits (e.g. "ON" inside "Non-").
export function codeNamesProvince(name: string | undefined | null, province: string): boolean {
  if (!name) return false;
  const hay = name.toLowerCase();
  const abbr = province.toLowerCase();
  if (new RegExp(`\\b${abbr}\\b`).test(hay)) return true;
  const full = CA_PROVINCE_NAMES[province as CaProvinceCode]?.toLowerCase();
  return full != null && hay.includes(full);
}

export type ProvinceTaxLink = {
  province: string;
  taxCodeId: string | null;
  /** QB's summed sales rate for the matched code (percent), to adopt into
   *  `tax_rates.rate`; null when the province is unmanaged. */
  ratePct: number | null;
  status: 'linked' | 'unmatched' | 'ambiguous';
};

// Pure: match each province to the single ACTIVE QB tax code whose NAME identifies
// it (`codeNamesProvince`) AND whose sales rate resolves (`resolveCodeRatePct`) —
// a confident 1:1 match `linked`s the province and carries QB's rate to adopt.
// Zero naming codes → `unmatched`; >1 → `ambiguous` (the deferred per-province
// override territory). Replaces the rate-based `resolveProvinceLinks`.
export function resolveProvinceLinksByName(
  appRates: { province: string }[],
  qboCodes: QboTaxCode[],
  rateById: Map<string, number>,
): ProvinceTaxLink[] {
  const active = qboCodes.filter((c) => c.Active !== false);
  return appRates.map((ar) => {
    const candidates = active
      .filter((c) => codeNamesProvince(c.Name, ar.province))
      .map((c) => ({ id: c.Id, rate: resolveCodeRatePct(c, rateById) }))
      .filter((c): c is { id: string; rate: number } => c.rate != null);
    if (candidates.length === 1) {
      return {
        province: ar.province,
        taxCodeId: candidates[0].id,
        ratePct: candidates[0].rate,
        status: 'linked',
      };
    }
    return {
      province: ar.province,
      taxCodeId: null,
      ratePct: null,
      status: candidates.length > 1 ? 'ambiguous' : 'unmatched',
    };
  });
}

export type TaxCodeSyncResult = {
  linked: number;
  unmatched: string[]; // province codes with no matching QBO code
  ambiguous: string[]; // >1 QBO code matched the rate, OR >1 province claimed one code
};

// Reconcile `tax_rates.quickbooks_tax_code_id` against the connected company's
// TaxCodes. Sets each province's link to its matched code (or null), clearing
// stale links. Executor-injected (no default — callers pass a transaction).
export async function applyTaxCodeSync(
  qboCodes: QboTaxCode[],
  qboRates: QboTaxRate[],
  exec: Executor,
): Promise<TaxCodeSyncResult> {
  const rateById = new Map<string, number>();
  for (const r of qboRates) {
    if (r.RateValue != null) rateById.set(r.Id, r.RateValue);
  }

  const appRates = await exec
    .select({
      id: taxRates.id,
      province: taxRates.province,
      rate: taxRates.rate,
      current: taxRates.quickbooksTaxCodeId,
    })
    .from(taxRates);

  const links = resolveProvinceLinks(appRates, qboCodes, rateById);
  const byProvince = new Map<string, (typeof appRates)[number]>(
    appRates.map((ar) => [ar.province, ar]),
  );

  const result: TaxCodeSyncResult = { linked: 0, unmatched: [], ambiguous: [] };
  for (const link of links) {
    const ar = byProvince.get(link.province);
    if (!ar) continue;
    if (link.taxCodeId !== ar.current) {
      await exec
        .update(taxRates)
        .set({ quickbooksTaxCodeId: link.taxCodeId })
        .where(eq(taxRates.id, ar.id));
    }
    if (link.status === 'linked') result.linked += 1;
    else if (link.status === 'ambiguous') result.ambiguous.push(link.province);
    else result.unmatched.push(link.province);
  }
  return result;
}

// `linked.unmatched.ambiguous` counts for the redirect flash. Mirrors
// item-sync's encodeItemSyncSummary.
export function encodeTaxSyncSummary(r: TaxCodeSyncResult): string {
  return `${r.linked}.${r.unmatched.length}.${r.ambiguous.length}`;
}

export function decodeTaxSyncSummary(
  s: string | null | undefined,
): { linked: number; unmatched: number; ambiguous: number } | null {
  if (!s) return null;
  const parts = s.split('.').map((n) => Number.parseInt(n, 10));
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n) || n < 0)) return null;
  return { linked: parts[0], unmatched: parts[1], ambiguous: parts[2] };
}
