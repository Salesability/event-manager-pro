'use server';

import { and, eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { capabilityClient, formDataSchema } from '@/lib/actions/action-client';
import { db } from '@/lib/db';
import { taxRates } from '@/lib/db/schema';
import { CA_PROVINCE_CODES, type CaProvinceCode } from '@/lib/ca-provinces';
import { fetchTaxCodes, fetchTaxRates } from '@/lib/quickbooks/client';
import { getValidAccessToken } from '@/lib/quickbooks/connection';
import { resolveCodeRatePct } from '@/lib/quickbooks/tax-sync';
import { planRateRefresh } from './mapping';
import { loadTaxRatesForMapping } from './queries';

type ActionResult = { ok: true } | { error: string };
type RefreshResult = { ok: true; updated: number; broken: number } | { error: string };

// 0076 — map a province to a QuickBooks tax code (the explicit per-province
// override that replaces 0075's auto-apply name heuristic). `lookup:edit`
// (admin-only), same gate as the other /admin/lookups editors. An empty
// `taxCodeId` UNMAPS the province (clears the link, keeps the app rate as a
// fallback). A set id is re-validated against the live company codes (so a
// stale/deleted code can't be assigned), then the code's summed rate (group-
// aware via `resolveCodeRatePct` — QC's GST+QST, BC's GST+PST) is adopted into
// `tax_rates.rate`.
const assignTaxCodeSchema = z.object({
  province: z.enum(CA_PROVINCE_CODES, { error: 'Invalid province.' }),
  taxCodeId: z.string().trim().default(''),
});

export const assignProvinceTaxCode = capabilityClient('lookup:edit')
  .schema(formDataSchema)
  .action(async ({ parsedInput: formData }): Promise<ActionResult> => {
    const parsed = assignTaxCodeSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) {
      const first = Object.values(parsed.error.flatten().fieldErrors).flat()[0];
      return { error: first ?? 'Invalid mapping input.' };
    }
    const { province, taxCodeId } = parsed.data;

    if (!taxCodeId) {
      // Unmap: clear the code link, keep the app rate.
      await db
        .update(taxRates)
        .set({ quickbooksTaxCodeId: null })
        .where(eq(taxRates.province, province));
      revalidatePath('/admin/lookups');
      return { ok: true };
    }

    // Re-validate against the live company + adopt the code's (group-aware) rate.
    const { realmId, accessToken } = await getValidAccessToken();
    const [codes, rates] = await Promise.all([
      fetchTaxCodes(realmId, accessToken),
      fetchTaxRates(realmId, accessToken),
    ]);
    const code = codes.find((c) => c.Id === taxCodeId && c.Active !== false);
    if (!code) return { error: 'That QuickBooks tax code no longer exists or is inactive.' };

    const rateById = new Map<string, number>();
    for (const r of rates) if (r.RateValue != null) rateById.set(r.Id, r.RateValue);
    const ratePct = resolveCodeRatePct(code, rateById);
    if (ratePct == null) {
      // No resolvable sales rate (adjustment/non-sales code) → mapping it would
      // leave a stale `tax_rates.rate`. Reject (the dropdown excludes these too).
      return {
        error: `"${code.Name ?? taxCodeId}" has no sales-tax rate in QuickBooks and can't be mapped to a province.`,
      };
    }

    // rate is always adopted now (we reject an unresolvable rate above).
    await db
      .update(taxRates)
      .set({ quickbooksTaxCodeId: taxCodeId, rate: ratePct.toFixed(3) })
      .where(eq(taxRates.province, province));

    revalidatePath('/admin/lookups');
    return { ok: true };
  });

// 0076 — re-sync the rates of already-mapped provinces from QuickBooks (the safe
// replacement for 0075's auto-apply "Pull tax codes"). Rate-ONLY: for each mapped
// province it re-reads its linked code's current rate and updates `tax_rates.rate`
// if it changed; it NEVER changes a code link (so it can't clobber the mapping). A
// mapped code missing from the live set is reported, not cleared. `lookup:edit`.
// validation: skip — no FormData input (a no-arg refresh trigger).
export const refreshTaxRates = capabilityClient('lookup:edit')
  .schema(formDataSchema)
  .action(async (): Promise<RefreshResult> => {
    const { realmId, accessToken } = await getValidAccessToken();
    const [codes, rates, appRows] = await Promise.all([
      fetchTaxCodes(realmId, accessToken),
      fetchTaxRates(realmId, accessToken),
      loadTaxRatesForMapping(),
    ]);
    const { writes, broken } = planRateRefresh(appRows, codes, rates);

    if (writes.length) {
      await db.transaction(async (tx) => {
        for (const w of writes) {
          // Compare-and-set on the expected code id: if a concurrent re-map changed
          // the province's code between planning and now, this updates 0 rows rather
          // than writing the old code's rate onto the new mapping (TOCTOU guard).
          // w.province is a DB-sourced ca_province value widened to string — narrow back.
          await tx
            .update(taxRates)
            .set({ rate: w.rate })
            .where(
              and(
                eq(taxRates.province, w.province as CaProvinceCode),
                eq(taxRates.quickbooksTaxCodeId, w.quickbooksTaxCodeId),
              ),
            );
        }
      });
    }

    revalidatePath('/admin/lookups');
    return { ok: true, updated: writes.length, broken: broken.length };
  });
