import 'server-only';
import { asc, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { dealers, taxRates } from '@/lib/db/schema';
import type { CaProvinceCode } from '@/lib/ca-provinces';
import { rateForProvince, type TaxRate } from '@/lib/tax-rates';
import { getConnection, getValidAccessToken } from '@/lib/quickbooks/connection';
import { fetchTaxCodes, fetchTaxRates } from '@/lib/quickbooks/client';
import {
  buildProvinceMappingRows,
  buildTaxCodeOptions,
  type ProvinceMappingInput,
  type TaxMappingAdminData,
} from './mapping';

// Province → sales-tax rate loaders (0065). One row per province, seeded; the
// admin edits rates via `/admin/lookups` (Phase 3); the quote pricing path reads
// the dealer's province rate (Phase 4).

export async function loadTaxRates(): Promise<TaxRate[]> {
  return db
    .select({
      province: taxRates.province,
      label: taxRates.label,
      rate: taxRates.rate,
    })
    .from(taxRates)
    .orderBy(asc(taxRates.label));
}

/** Province tax rows incl. the QBO `quickbooks_tax_code_id` — the input to the
 *  0076 `/admin/lookups` mapping view-model (`buildProvinceMappingRows`). */
export async function loadTaxRatesForMapping(): Promise<ProvinceMappingInput[]> {
  return db
    .select({
      province: taxRates.province,
      label: taxRates.label,
      rate: taxRates.rate,
      quickbooksTaxCodeId: taxRates.quickbooksTaxCodeId,
    })
    .from(taxRates)
    .orderBy(asc(taxRates.label));
}

/** Loader for the `/admin/lookups` tax-code mapping section (0076). Connected →
 *  the full per-province view-model + the live QBO code dropdown options; not
 *  connected (or a QBO read failed) → a read-only list with a connect hint, so a
 *  QB hiccup never breaks the rest of the lookups page. */
export async function loadTaxMappingAdmin(): Promise<TaxMappingAdminData> {
  const appRows = await loadTaxRatesForMapping();
  const conn = await getConnection();
  if (!conn) return { connected: false, rows: appRows };
  try {
    const { realmId, accessToken } = await getValidAccessToken();
    const [codes, rates] = await Promise.all([
      fetchTaxCodes(realmId, accessToken),
      fetchTaxRates(realmId, accessToken),
    ]);
    return {
      connected: true,
      rows: buildProvinceMappingRows(appRows, codes, rates),
      options: buildTaxCodeOptions(codes, rates),
    };
  } catch {
    return { connected: false, rows: appRows };
  }
}

/** Combined sales-tax percent for a single province (number), or null if the
 *  province is unset / has no rate row. */
export async function taxRateForProvince(
  province: CaProvinceCode | null,
): Promise<number | null> {
  if (!province) return null;
  return rateForProvince(await loadTaxRates(), province);
}

/** The sales-tax rate (percent) for a dealer's province, or 0 when the dealer
 *  has no province / no rate row. One join — `tax_rates` is stable config, so a
 *  read on the app pool (outside any quote tx) is fine. Used by the quote
 *  actions to auto-compute tax (0065). */
export async function dealerTaxRatePct(dealerId: number): Promise<number> {
  const [r] = await db
    .select({ rate: taxRates.rate })
    .from(dealers)
    .leftJoin(taxRates, eq(taxRates.province, dealers.province))
    .where(eq(dealers.id, dealerId))
    .limit(1);
  return r?.rate ? Number(r.rate) : 0;
}
