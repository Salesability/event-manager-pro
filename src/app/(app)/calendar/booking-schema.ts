import { z } from 'zod';

// Single source of truth for booking-form validation. The form itself is a
// B-shape carve-out per `docs/wiki/forms.md` (auto-fill UX driven by dealer
// pick — populates contact/phone/email unless touched — doesn't fit a full
// RHF restructure), so the client uses native `<form action={action}>` +
// `useActionState`. The action layer (`createCampaign` / `updateCampaign` in
// `schedule/actions.ts`) imports this schema via `parseCampaignInput` and
// runs `safeParse(Object.fromEntries(formData))` — the shared schema is the
// server-side validation contract regardless of the client shape.
//
// Cross-field rules (endDate ≥ startDate) and the wire → DB normalization
// (string → number, lowercased email) stay in `parseCampaignInput` after
// `safeParse` confirms per-field shape.

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const optPositiveId = z
  .string()
  .refine(
    (v) => v === '' || (/^\d+$/.test(v) && Number(v) > 0),
    'Must be a positive integer.',
  )
  .optional();

export const bookingFormSchema = z.object({
  startDate: z
    .string()
    .refine(
      (v) => ISO_DATE_RE.test(v),
      'Start and end date are required (YYYY-MM-DD).',
    ),
  endDate: z
    .string()
    .refine(
      (v) => ISO_DATE_RE.test(v),
      'Start and end date are required (YYYY-MM-DD).',
    ),
  dealerId: z
    .string()
    .refine(
      (v) => /^\d+$/.test(v) && Number(v) > 0,
      'Dealer is required.',
    ),
  coachId: optPositiveId,
  styleId: optPositiveId,
  audienceSourceId: optPositiveId,
  contact: z.string().trim().optional(),
  phone: z.string().trim().optional(),
  email: z
    .string()
    .trim()
    .refine(
      (v) => v === '' || EMAIL_RE.test(v),
      'Contact email looks invalid.',
    )
    .optional(),
  notes: z.string().optional(),
});

export type BookingFormValues = z.infer<typeof bookingFormSchema>;
