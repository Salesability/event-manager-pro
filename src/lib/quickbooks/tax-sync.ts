import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { taxRates } from '@/lib/db/schema';
import { CA_PROVINCE_NAMES, type CaProvinceCode } from '@/lib/ca-provinces';
import type { QboTaxCode, QboTaxRate } from '@/lib/quickbooks/client';

// QuickBooks is the SOURCE OF TRUTH for province tax rates (0075). A "Pull tax
// codes" sync matches each province (0065 `tax_rates`) to the QBO TaxCode whose
// NAME identifies the jurisdiction ("HST ON" → ON; `resolveProvinceLinksByName`)
// and ADOPTS that code's rate into `tax_rates.rate` — the app no longer hand-
// maintains rates (the in-app editor was removed). Provinces with no confident
// name match keep their app rate, flagged unmanaged (`quickbooks_tax_code_id`
// stays null). The Estimate push (quote-push.ts) reads the linked code to set
// `TxnTaxDetail.TxnTaxCodeRef` so QBO computes tax with its own code
// (see docs/chunks/0075-quickbooks-tax-rate-source/decision.md).

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

export type TaxRateWrite = {
  id: number;
  quickbooksTaxCodeId: string | null;
  /** 3-decimal rate string to adopt into `tax_rates.rate`, or null to leave the
   *  rate unchanged (the column is NOT NULL — the executor only sets it when
   *  non-null). */
  rate: string | null;
};

// Pure: the minimal set of UPDATEs to reconcile `tax_rates` with the resolved
// links. A `linked` province ADOPTS QB's rate (`ratePct.toFixed(3)`) + sets the
// code id; an unmanaged province (unmatched/ambiguous) only CLEARS a stale code
// id, keeping its app rate as a fallback. Rows already in the desired state are
// omitted. Mirrors item-sync's classify/apply split so the adopt logic is unit-
// tested without a DB.
export function planTaxRateWrites(
  appRows: { id: number; province: string; rate: string; current: string | null }[],
  links: ProvinceTaxLink[],
): TaxRateWrite[] {
  const linkByProvince = new Map(links.map((l) => [l.province, l]));
  const writes: TaxRateWrite[] = [];
  for (const row of appRows) {
    const link = linkByProvince.get(row.province);
    if (!link) continue;
    if (link.status === 'linked' && link.ratePct != null) {
      const newRate = link.ratePct.toFixed(3);
      const rateChanged = newRate !== row.rate;
      const codeChanged = link.taxCodeId !== row.current;
      if (rateChanged || codeChanged) {
        writes.push({
          id: row.id,
          quickbooksTaxCodeId: link.taxCodeId,
          rate: rateChanged ? newRate : null,
        });
      }
    } else if (row.current !== null) {
      // unmanaged: drop a stale code link only; keep the app rate.
      writes.push({ id: row.id, quickbooksTaxCodeId: null, rate: null });
    }
  }
  return writes;
}

export type TaxCodeSyncResult = {
  linked: number; // provinces now QB-managed (code linked + rate adopted)
  unmatched: string[]; // province codes no QBO code names → kept app-managed
  ambiguous: string[]; // >1 QBO code names the province → deferred to a manual override
};

// Adopt QB's tax rates into `tax_rates` for the connected company: name-match each
// province to a QBO TaxCode (`resolveProvinceLinksByName`), then apply the planned
// writes — `linked` provinces take QB's rate + code id, unmanaged provinces have a
// stale code id cleared (app rate kept). Executor-injected (no default — callers
// pass a transaction).
export async function applyTaxCodeSync(
  qboCodes: QboTaxCode[],
  qboRates: QboTaxRate[],
  exec: Executor,
): Promise<TaxCodeSyncResult> {
  const rateById = new Map<string, number>();
  for (const r of qboRates) {
    if (r.RateValue != null) rateById.set(r.Id, r.RateValue);
  }

  const appRows = await exec
    .select({
      id: taxRates.id,
      province: taxRates.province,
      rate: taxRates.rate,
      current: taxRates.quickbooksTaxCodeId,
    })
    .from(taxRates);

  const links = resolveProvinceLinksByName(appRows, qboCodes, rateById);
  const writes = planTaxRateWrites(appRows, links);

  for (const w of writes) {
    const set: { quickbooksTaxCodeId: string | null; rate?: string } = {
      quickbooksTaxCodeId: w.quickbooksTaxCodeId,
    };
    if (w.rate != null) set.rate = w.rate;
    await exec.update(taxRates).set(set).where(eq(taxRates.id, w.id));
  }

  const result: TaxCodeSyncResult = { linked: 0, unmatched: [], ambiguous: [] };
  for (const link of links) {
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
