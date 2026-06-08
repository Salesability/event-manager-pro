import { z } from 'zod';

// Single source of truth for the admin "Send Test MSA" form (chunk 0067).
// Imported by both the client component (`send-test-msa-form.tsx` via
// `zodResolver`) and the Server Action (`msa/actions.ts` via
// `safeParse(Object.fromEntries(formData))`). Free-compose: a typed recipient
// + signer name, with an optional custom message. Email idiom matches
// `test-email-schema.ts` — a regex `.refine()` (not `z.email()`) and the
// single-mailbox char-class exclusion, kept consistent across form schemas.

export const testMsaFormSchema = z.object({
  // Single mailbox only — char classes exclude `,`/`;`/whitespace so an
  // address-list is rejected at the validation layer (matches the test-email
  // schema's anti-multi-recipient stance).
  to: z
    .string({ error: 'Recipient address is required.' })
    .trim()
    .min(1, 'Recipient address is required.')
    .refine(
      (v) => /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(v),
      'Enter a single valid email address.',
    ),
  // Printed in the MSA signature block ("For the Client"). Reject control
  // characters — a single-line name has no CR/LF.
  signerName: z
    .string({ error: 'Signer name is required.' })
    .trim()
    .min(1, 'Signer name is required.')
    .max(120, 'Signer name must be 120 characters or fewer.')
    .refine((v) => !/[\r\n]/.test(v), 'Signer name must be a single line.'),
  // Optional custom cover message on the BoldSign envelope; falls back to a
  // default in the action when blank.
  message: z
    .string()
    .trim()
    .max(1000, 'Message must be 1000 characters or fewer.')
    .optional(),
});

export type TestMsaFormValues = z.infer<typeof testMsaFormSchema>;
