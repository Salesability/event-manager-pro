import { z } from 'zod';

// Single source of truth for availability-block validation. Imported by both
// the client component (`availability-admin.tsx` via `zodResolver`) and the
// Server Action (`schedule/actions.ts` via `safeParse(Object.fromEntries(formData))`).
//
// Schema validates the wire shape (FormData → string values everywhere); the
// action layer applies cross-field rules (kind ↔ coachId, endDate ≥ startDate)
// and the wire → DB normalization after `safeParse` confirms the format.

export const AVAILABILITY_KINDS = [
  'statutory_holiday',
  'company_closure',
  'coach_unavailable',
] as const;

export type AvailabilityKind = (typeof AVAILABILITY_KINDS)[number];

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const availabilityFormSchema = z.object({
  startDate: z
    .string({ error: 'Start date is required.' })
    .refine((v) => ISO_DATE_RE.test(v), 'Start date is required.'),
  endDate: z
    .string()
    .refine(
      (v) => v === '' || ISO_DATE_RE.test(v),
      'End date must be YYYY-MM-DD.',
    )
    .optional(),
  kind: z.enum(AVAILABILITY_KINDS, { error: 'Invalid block type.' }),
  coachId: z
    .string()
    .refine((v) => v === '' || /^\d+$/.test(v), 'Coach id must be a positive integer.')
    .optional(),
  reason: z
    .string()
    .max(200, 'Reason must be 200 characters or fewer.')
    .optional(),
});

export type AvailabilityFormValues = z.infer<typeof availabilityFormSchema>;
