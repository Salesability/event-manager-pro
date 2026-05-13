'use server';

import { revalidatePath } from 'next/cache';
import { and, eq, isNotNull, isNull } from 'drizzle-orm';
import { db } from '@/lib/db';
import { serviceItems } from '@/lib/db/schema';
import { capabilityClient, formDataSchema } from '@/lib/actions/action-client';
import { parseId } from '@/features/schedule/validators';
import {
  normalizeMoney,
  serviceItemFormSchema,
  type ServiceItemFormValues,
} from './service-schema';
import type { ServiceItemUnit } from './queries';

type ActionResult =
  | { ok: true }
  | { error: string; fieldErrors?: Record<string, string[] | undefined> };

type ServiceItemFields = {
  label: string;
  unit: ServiceItemUnit;
  unitPrice: string | null;
  unitPriceMin: string | null;
  unitPriceMax: string | null;
  description: string | null;
  sortOrder: number;
};

type FieldErrors = Record<string, string[] | undefined>;
function firstFieldError(fieldErrors: FieldErrors): string | undefined {
  for (const list of Object.values(fieldErrors)) {
    if (list && list.length) return list[0];
  }
  return undefined;
}

/** Apply wire → DB normalization on a successfully-parsed form value. The
 *  schema validates per-field format; this helper handles the cross-field
 *  range rule and the string → number / string → padded-money transforms. */
function toServiceItemFields(
  v: ServiceItemFormValues,
): ServiceItemFields | { error: string } {
  const sortOrder = v.sortOrder ? Number(v.sortOrder) : 0;
  const unitPrice = normalizeMoney(v.unitPrice);
  const unitPriceMin = normalizeMoney(v.unitPriceMin);
  const unitPriceMax = normalizeMoney(v.unitPriceMax);

  if (v.unit === 'range') {
    if (unitPriceMin == null || unitPriceMax == null) {
      return { error: 'Range items need both min and max prices.' };
    }
    if (Number(unitPriceMin) > Number(unitPriceMax)) {
      return { error: 'Min price must be ≤ max price.' };
    }
  }

  return {
    label: v.label,
    unit: v.unit,
    unitPrice: v.unit === 'range' ? null : unitPrice,
    unitPriceMin: v.unit === 'range' ? unitPriceMin : null,
    unitPriceMax: v.unit === 'range' ? unitPriceMax : null,
    description: v.description ? v.description : null,
    sortOrder,
  };
}

function isDuplicateCodeError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message;
  return msg.includes('duplicate key') && msg.includes('service_items_code_unique');
}

function revalidateLookupAdmin() {
  revalidatePath('/admin/lookups');
}

export const createServiceItem = capabilityClient('lookup:edit')
  .schema(formDataSchema)
  .action(async ({ parsedInput: formData }): Promise<ActionResult> => {
    const parsed = serviceItemFormSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) {
      const fieldErrors = parsed.error.flatten().fieldErrors;
      return {
        error: firstFieldError(fieldErrors) ?? 'Invalid service-item input.',
        fieldErrors,
      };
    }
    if (!parsed.data.code) return { error: 'Code is required.' };
    const code = parsed.data.code;

    const fields = toServiceItemFields(parsed.data);
    if ('error' in fields) return fields;

    // Un-archive an existing archived row with this code (matches
    // `createCampaignStyle`'s recovery shape) — keeps the global UNIQUE on
    // `code` from permanently locking out a coded slot after archive.
    const restored = await db
      .update(serviceItems)
      .set({ ...fields, archivedAt: null })
      .where(and(eq(serviceItems.code, code), isNotNull(serviceItems.archivedAt)))
      .returning({ id: serviceItems.id });
    if (restored.length) {
      revalidateLookupAdmin();
      return { ok: true };
    }

    try {
      await db.insert(serviceItems).values({ code, ...fields });
    } catch (err) {
      if (isDuplicateCodeError(err)) return { error: 'That code is already in use.' };
      throw err;
    }

    revalidateLookupAdmin();
    return { ok: true };
  });

export const updateServiceItem = capabilityClient('lookup:edit')
  .schema(formDataSchema)
  .action(async ({ parsedInput: formData }): Promise<ActionResult> => {
    const id = parseId(formData);
    if (id == null) return { error: 'Invalid service-item id.' };

    const parsed = serviceItemFormSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) {
      const fieldErrors = parsed.error.flatten().fieldErrors;
      return {
        error: firstFieldError(fieldErrors) ?? 'Invalid service-item input.',
        fieldErrors,
      };
    }

    const fields = toServiceItemFields(parsed.data);
    if ('error' in fields) return fields;

    const result = await db
      .update(serviceItems)
      .set(fields)
      .where(and(eq(serviceItems.id, id), isNull(serviceItems.archivedAt)))
      .returning({ id: serviceItems.id });
    if (!result.length) return { error: 'Service item not found.' };

    revalidateLookupAdmin();
    return { ok: true };
  });

// validation: skip — id-only action; `parseId` is the only input check.
export const archiveServiceItem = capabilityClient('lookup:edit')
  .schema(formDataSchema)
  .action(async ({ parsedInput: formData }): Promise<ActionResult> => {
    const id = parseId(formData);
    if (id == null) return { error: 'Invalid service-item id.' };

    await db
      .update(serviceItems)
      .set({ archivedAt: new Date() })
      .where(and(eq(serviceItems.id, id), isNull(serviceItems.archivedAt)));

    revalidateLookupAdmin();
    return { ok: true };
  });
