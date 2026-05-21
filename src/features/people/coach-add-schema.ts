import { z } from 'zod';

// Schema + wire-format mapper for the booking dialog's coach quick-add (chunk
// 0056), split into its own pure module — no React/server imports — so it can
// be unit-tested in the node vitest env and shared by the client form
// (`coach-add-form.tsx`). Mirrors the `dealer-schema.ts` split that
// `dealer-form.tsx` uses.

export const coachFormSchema = z.object({
  firstName: z.string().trim().min(1, 'First name is required.'),
  lastName: z.string().trim().min(1, 'Last name is required.'),
  // Coaches get app access (sign-in), which requires an email — `createPerson`
  // enforces this server-side too; mirrored here for inline feedback.
  email: z
    .string()
    .trim()
    .min(1, 'Email is required.')
    .email('Enter a valid email.'),
  phone: z.string().trim().optional(),
});

export type CoachFormValues = z.infer<typeof coachFormSchema>;

// Maps validated values to the `createPerson` FormData wire format, forcing the
// coach-specific bits: `roles=coach` + `appAccess=1` (coach implies sign-in).
export function coachValuesToFormData(values: CoachFormValues): FormData {
  const fd = new FormData();
  fd.set('firstName', values.firstName);
  fd.set('lastName', values.lastName);
  fd.set('email', values.email);
  fd.set('phone', values.phone ?? '');
  fd.append('roles', 'coach');
  fd.set('appAccess', '1');
  return fd;
}
