import { z } from 'zod';
import { CA_PROVINCE_CODES } from '@/lib/ca-provinces';

// 0065 — validation contract for an admin tax-rate edit. Shared by the
// `updateTaxRate` Server Action (`safeParse`) and unit tests. `rate` is a
// percent string (numeric(6,3)): up to 2 integer digits + up to 3 decimals,
// capped at a sane 0–30% so a fat-fingered 1300 can't ship.
export const taxRateUpdateSchema = z.object({
  province: z.enum(CA_PROVINCE_CODES, { error: 'Invalid province.' }),
  rate: z
    .string({ error: 'Rate is required.' })
    .trim()
    .refine(
      (v) => /^\d{1,2}(\.\d{1,3})?$/.test(v),
      'Rate must be a percent with up to 3 decimals.',
    )
    .refine((v) => {
      const n = Number(v);
      return n >= 0 && n <= 30;
    }, 'Rate must be between 0 and 30%.'),
});

export type TaxRateUpdate = z.infer<typeof taxRateUpdateSchema>;
