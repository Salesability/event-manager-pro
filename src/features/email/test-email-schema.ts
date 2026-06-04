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
  // Single mailbox only — the char classes exclude `,` and `;` (as well as
  // whitespace, which covers CR/LF) so an address-list like `a@x.com,b@y.com`
  // is rejected at the validation layer. Enforces the "No bulk / multi-
  // recipient send" non-goal (intent.md) rather than relying on Resend's
  // parsing of a comma-joined string.
  to: z
    .string({ error: 'Recipient address is required.' })
    .trim()
    .min(1, 'Recipient address is required.')
    .refine(
      (v) => /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(v),
      'Enter a single valid email address.',
    ),
  // Reject control characters (CR/LF) in the subject — header-shaped values
  // have no place in a one-line subject, and it keeps the field clean before
  // it reaches the email provider.
  subject: z
    .string({ error: 'Subject is required.' })
    .trim()
    .min(1, 'Subject is required.')
    .refine((v) => !/[\r\n]/.test(v), 'Subject must be a single line.'),
  body: z
    .string({ error: 'Message body is required.' })
    .trim()
    .min(1, 'Message body is required.'),
});

export type TestEmailFormValues = z.infer<typeof testEmailFormSchema>;
