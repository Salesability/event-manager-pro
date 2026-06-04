import { z } from 'zod';

// Single source of truth for the admin "Send Test Email" form (chunk 0064).
// Imported by both the client component (`send-test-email-form.tsx` via
// `zodResolver`) and the Server Action (`email/actions.ts` via
// `safeParse(Object.fromEntries(formData))`). Free-compose: every field is
// required — the recipient is a typed address (no recipient-on-file), and the
// body is plain text (maps to `sendEmail`'s `text`; no HTML).
//
// Email idiom matches `dealers/dealer-schema.ts` — a regex `.refine()` rather
// than `z.email()`, kept consistent across the codebase's form schemas.

export const testEmailFormSchema = z.object({
  to: z
    .string({ error: 'Recipient address is required.' })
    .trim()
    .min(1, 'Recipient address is required.')
    .refine(
      (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v),
      'Recipient address looks invalid.',
    ),
  subject: z
    .string({ error: 'Subject is required.' })
    .trim()
    .min(1, 'Subject is required.'),
  body: z
    .string({ error: 'Message body is required.' })
    .trim()
    .min(1, 'Message body is required.'),
});

export type TestEmailFormValues = z.infer<typeof testEmailFormSchema>;
