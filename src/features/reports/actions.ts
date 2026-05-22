'use server';

import { revalidatePath } from 'next/cache';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/lib/db';
import { billingAdjustments } from '@/lib/db/schema';
import { capabilityClient, formDataSchema } from '@/lib/actions/action-client';

type ActionResult = { ok: true } | { error: string };

// `value` is an integer quantity. Cap well under int4 max (2_147_483_647) so a
// fat-fingered figure is rejected here rather than blowing up at the DB. The
// raw string is validated by zod (presence/shape); the empty-vs-number split
// happens after, since '' is a meaningful "clear" signal, not an error.
const MAX_BILLING_VALUE = 1_000_000_000;

const billingAdjustmentSchema = z.object({
  campaignId: z.coerce.number().int().positive(),
  // Mirrors the campaign columns + the table's CHECK constraint.
  field: z.enum(['qty_records', 'sms_email', 'letters', 'bdc']),
  value: z.string(),
});

/** Set or clear one billing adjustment cell on the /reports Full Production
 *  Report. Admin-only (`reports:edit-billing`). An empty `value` DELETEs the
 *  adjustment so the report falls back to the campaign's own column — that's
 *  how "the original stays recoverable" works. A present value UPSERTs on the
 *  (campaign_id, field) unique key. Last-write-wins per cell: admin-only, low
 *  contention, and a single numeric override doesn't need the lifecycle
 *  optimistic-lock that `setQuoteInputs` carries. */
export const setBillingAdjustment = capabilityClient('reports:edit-billing')
  .schema(formDataSchema)
  .action(async ({ parsedInput: formData, ctx }): Promise<ActionResult> => {
    const userId = ctx.user.id;

    const parsed = billingAdjustmentSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) return { error: 'Invalid billing adjustment.' };
    const { campaignId, field: fieldKey } = parsed.data;
    const rawValue = parsed.data.value.trim();

    try {
      if (rawValue === '') {
        // Clear → revert to the campaign's own value.
        await db
          .delete(billingAdjustments)
          .where(
            and(
              eq(billingAdjustments.campaignId, campaignId),
              eq(billingAdjustments.field, fieldKey),
            ),
          );
        revalidatePath('/reports');
        return { ok: true };
      }

      const value = Number(rawValue);
      if (!Number.isInteger(value) || value < 0 || value > MAX_BILLING_VALUE) {
        return { error: `Enter a whole number between 0 and ${MAX_BILLING_VALUE.toLocaleString()}.` };
      }

      await db
        .insert(billingAdjustments)
        .values({ campaignId, field: fieldKey, value, createdById: userId, updatedById: userId })
        .onConflictDoUpdate({
          target: [billingAdjustments.campaignId, billingAdjustments.field],
          set: { value, updatedById: userId },
        });
      revalidatePath('/reports');
      return { ok: true };
    } catch {
      // Most likely a FK violation (campaign deleted between load and edit).
      return { error: 'Could not save the adjustment — the campaign may no longer exist.' };
    }
  });
