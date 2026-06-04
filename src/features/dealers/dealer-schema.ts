import { z } from 'zod';
import { CA_PROVINCE_CODES } from '@/lib/ca-provinces';

// Single source of truth for dealer-form validation. Imported by both the
// client component (`dealer-form.tsx` via `zodResolver`) and the Server Action
// (`schedule/actions.ts` via `safeParse(Object.fromEntries(formData))`).
//
// Wire-format note: `Object.fromEntries(FormData)` yields string values for
// every present key. Optional fields therefore arrive as `''` when the user
// left them blank — `z.string().optional()` accepts that since the empty
// string is still a string. `acquiredVia` is intentionally *not* coerced from
// `''` → `undefined`, because the updateDealer patch needs to distinguish
// "field absent" (preserve) from "field present as ''" (clear to null).

export const dealerFormSchema = z.object({
  name: z
    .string({ error: 'Dealership name is required.' })
    .trim()
    .min(1, 'Dealership name is required.'),
  contactFirst: z.string().trim().optional(),
  contactLast: z.string().trim().optional(),
  contactEmail: z
    .string()
    .trim()
    .refine(
      (v) => v === '' || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v),
      'Contact email looks invalid.',
    )
    .optional(),
  contactPhone: z.string().trim().optional(),
  address: z.string().trim().optional(),
  // CA province/territory (0065). Accepts a code or '' (= unset/clear); the
  // form's select submits '' for the "no province" option. Stored nullable.
  province: z
    .union([z.enum(CA_PROVINCE_CODES), z.literal('')], {
      error: 'Invalid province.',
    })
    .optional(),
  status: z
    .enum(['active', 'prospect'], { error: 'Invalid dealer status.' })
    .optional(),
  acquiredVia: z
    .string()
    .trim()
    .max(200, 'Acquired-via must be 200 characters or fewer.')
    .optional(),
});

export type DealerFormValues = z.infer<typeof dealerFormSchema>;
