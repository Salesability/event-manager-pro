'use server';

import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { capabilityClient, formDataSchema } from '@/lib/actions/action-client';
import { db } from '@/lib/db';
import { taxRates } from '@/lib/db/schema';
import { taxRateUpdateSchema } from './tax-rate-schema';

type ActionResult = { ok: true } | { error: string };

// Admin edits a single province's sales-tax rate (0065). The 13 rows are seeded
// and fixed (no create/archive), so this is the only mutation — a guarded UPDATE
// keyed on the province. `lookup:edit` (admin-only), same gate as the other
// /admin/lookups editors. `updated_at` bumps via the `timestamps` $onUpdate.
export const updateTaxRate = capabilityClient('lookup:edit')
  .schema(formDataSchema)
  .action(async ({ parsedInput: formData }): Promise<ActionResult> => {
    const parsed = taxRateUpdateSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) {
      const first = Object.values(parsed.error.flatten().fieldErrors).flat()[0];
      return { error: first ?? 'Invalid tax rate input.' };
    }
    const { province, rate } = parsed.data;

    const updated = await db
      .update(taxRates)
      .set({ rate })
      .where(eq(taxRates.province, province))
      .returning({ province: taxRates.province });
    if (!updated.length) return { error: 'No tax rate on file for that province.' };

    revalidatePath('/admin/lookups');
    return { ok: true };
  });
