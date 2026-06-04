import 'server-only';
import { asc } from 'drizzle-orm';
import { db } from '@/lib/db';
import { taxRates } from '@/lib/db/schema';
import type { CaProvinceCode } from '@/lib/ca-provinces';
import { rateForProvince, type TaxRate } from '@/lib/tax-rates';

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

/** Combined sales-tax percent for a single province (number), or null if the
 *  province is unset / has no rate row. */
export async function taxRateForProvince(
  province: CaProvinceCode | null,
): Promise<number | null> {
  if (!province) return null;
  return rateForProvince(await loadTaxRates(), province);
}
