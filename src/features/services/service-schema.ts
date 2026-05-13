import { z } from 'zod';
import type { ServiceItemUnit } from './queries';

// Single source of truth for service-item form validation. Imported by both
// the client component (`services-admin.tsx` via `zodResolver`) and the Server
// Action (`services/actions.ts` via `safeParse(Object.fromEntries(formData))`).
//
// Schema validates the wire shape (FormData → string values everywhere); the
// action layer handles the wire → DB normalization (string '12.5' → '12.50',
// string '9' → number 9) after `safeParse` confirms the format is well-formed.

export const SERVICE_UNITS: readonly ServiceItemUnit[] = [
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
export const MONEY_RE = /^(0|[1-9]\d{0,7})(\.\d{1,2})?$/;
const MAX_PG_INTEGER = 2_147_483_647;

function moneyField(name: string) {
  return z
    .string()
    .refine(
      (v) => v === '' || MONEY_RE.test(v),
      `${name} must be a non-negative dollar amount with at most 8 whole digits and 2 decimal places.`,
    )
    .optional();
}

export const serviceItemFormSchema = z.object({
  code: z
    .string()
    .trim()
    .transform((v) => v.toLowerCase())
    .refine(
      (v) => v === '' || CODE_RE.test(v),
      'Code must be lowercase kebab-case (letters, digits, hyphens).',
    )
    .optional(),
  label: z
    .string({ error: 'Label is required.' })
    .trim()
    .min(1, 'Label is required.')
    .max(120, 'Label must be 120 characters or fewer.'),
  unit: z.enum(['flat', 'per-record', 'per-touch', 'per-day', 'range'], {
    error: 'Invalid unit.',
  }),
  description: z
    .string()
    .trim()
    .max(500, 'Description must be 500 characters or fewer.')
    .optional(),
  sortOrder: z
    .string()
    .refine((v) => {
      if (!v) return true;
      const n = Number(v);
      return Number.isInteger(n) && n >= 0 && n <= MAX_PG_INTEGER;
    }, 'Sort order must be a non-negative integer.')
    .optional(),
  unitPrice: moneyField('Unit price'),
  unitPriceMin: moneyField('Min price'),
  unitPriceMax: moneyField('Max price'),
});

export type ServiceItemFormValues = z.infer<typeof serviceItemFormSchema>;

/** Normalize a wire-format money string ('12.5') to a canonical 2-decimal
 *  shape ('12.50') for `numeric(10,2)` columns. Returns null on empty input.
 *  String manipulation only — `Number` would IEEE-754-round '2.675' silently. */
export function normalizeMoney(raw: string | undefined): string | null {
  if (!raw) return null;
  const [whole, frac = ''] = raw.split('.');
  return `${whole}.${(frac + '00').slice(0, 2)}`;
}
