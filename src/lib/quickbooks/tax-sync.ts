import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { taxRates } from '@/lib/db/schema';
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

export type TaxCodeSyncResult = {
  linked: number;
  unmatched: string[]; // province codes with no matching QBO code
  ambiguous: string[]; // province codes where >1 QBO code matched the rate
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

  const result: TaxCodeSyncResult = { linked: 0, unmatched: [], ambiguous: [] };
  for (const ar of appRates) {
    const match = matchProvinceTaxCode(Number(ar.rate), qboCodes, rateById);
    const newId = match.taxCodeId;
    if (newId !== ar.current) {
      await exec.update(taxRates).set({ quickbooksTaxCodeId: newId }).where(eq(taxRates.id, ar.id));
    }
    if (newId) {
      result.linked += 1;
    } else if (match.ambiguous) {
      result.ambiguous.push(ar.province);
    } else {
      result.unmatched.push(ar.province);
    }
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
