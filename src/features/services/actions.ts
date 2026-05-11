'use server';

import { revalidatePath } from 'next/cache';
import { and, eq, isNotNull, isNull } from 'drizzle-orm';
import { db } from '@/lib/db';
import { serviceItems } from '@/lib/db/schema';
import { capabilityClient, formDataSchema } from '@/lib/actions/action-client';
import { field, parseId } from '@/features/schedule/validators';
import type { ServiceItemUnit } from './queries';

type ActionResult = { ok: true } | { error: string };

const UNITS: readonly ServiceItemUnit[] = [
  'flat',
  'per-record',
  'per-touch',
  'per-day',
  'range',
];

// Lowercase letters, digits, hyphens; 2–60 chars; no leading/trailing hyphen.
const CODE_RE = /^[a-z0-9](?:[a-z0-9-]{0,58}[a-z0-9])?$/;

// Match `numeric(10,2)` on the column: up to 8 whole digits, up to 2 decimal
// digits. Validates server-side; `step="0.01"` in the form UI is advisory only.
const MONEY_RE = /^(0|[1-9]\d{0,7})(\.\d{1,2})?$/;
// Postgres `integer` (signed 32-bit) upper bound; we already reject negatives.
const MAX_PG_INTEGER = 2_147_483_647;

type ServiceItemFields = {
  label: string;
  unit: ServiceItemUnit;
  unitPrice: string | null;
  unitPriceMin: string | null;
  unitPriceMax: string | null;
  description: string | null;
  sortOrder: number;
};

function parseNumericMoney(raw: string, name: string): string | null | { error: string } {
  if (!raw) return null;
  if (!MONEY_RE.test(raw)) {
    return {
      error: `${name} must be a non-negative dollar amount with at most 8 whole digits and 2 decimal places.`,
    };
  }
  // Normalize via string manipulation — going through `Number` would IEEE-754-
  // round inputs like "2.675" to "2.67" silently. Pad/truncate fractional part
  // to exactly 2 digits.
  const [whole, frac = ''] = raw.split('.');
  return `${whole}.${(frac + '00').slice(0, 2)}`;
}

function parseServiceItemFields(formData: FormData): ServiceItemFields | { error: string } {
  const label = field(formData, 'label');
  if (!label) return { error: 'Label is required.' };
  if (label.length > 120) return { error: 'Label must be 120 characters or fewer.' };

  const unit = field(formData, 'unit') as ServiceItemUnit;
  if (!UNITS.includes(unit)) return { error: 'Invalid unit.' };

  const description = field(formData, 'description');
  if (description.length > 500) return { error: 'Description must be 500 characters or fewer.' };

  const sortOrderRaw = field(formData, 'sortOrder');
  const sortOrder = sortOrderRaw === '' ? 0 : Number(sortOrderRaw);
  if (!Number.isInteger(sortOrder) || sortOrder < 0 || sortOrder > MAX_PG_INTEGER) {
    return { error: 'Sort order must be a non-negative integer.' };
  }

  const unitPrice = parseNumericMoney(field(formData, 'unitPrice'), 'Unit price');
  if (typeof unitPrice === 'object' && unitPrice && 'error' in unitPrice) return unitPrice;
  const unitPriceMin = parseNumericMoney(field(formData, 'unitPriceMin'), 'Min price');
  if (typeof unitPriceMin === 'object' && unitPriceMin && 'error' in unitPriceMin) return unitPriceMin;
  const unitPriceMax = parseNumericMoney(field(formData, 'unitPriceMax'), 'Max price');
  if (typeof unitPriceMax === 'object' && unitPriceMax && 'error' in unitPriceMax) return unitPriceMax;

  if (unit === 'range') {
    if (unitPriceMin == null || unitPriceMax == null) {
      return { error: 'Range items need both min and max prices.' };
    }
    if (Number(unitPriceMin) > Number(unitPriceMax)) {
      return { error: 'Min price must be ≤ max price.' };
    }
  }

  return {
    label,
    unit,
    unitPrice: unit === 'range' ? null : (unitPrice as string | null),
    unitPriceMin: unit === 'range' ? (unitPriceMin as string | null) : null,
    unitPriceMax: unit === 'range' ? (unitPriceMax as string | null) : null,
    description: description || null,
    sortOrder,
  };
}

function parseCode(formData: FormData): string | { error: string } {
  const code = field(formData, 'code').toLowerCase();
  if (!code) return { error: 'Code is required.' };
  if (!CODE_RE.test(code)) {
    return { error: 'Code must be lowercase kebab-case (letters, digits, hyphens).' };
  }
  return code;
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
    const code = parseCode(formData);
    if (typeof code !== 'string') return code;

    const fields = parseServiceItemFields(formData);
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

    const fields = parseServiceItemFields(formData);
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
