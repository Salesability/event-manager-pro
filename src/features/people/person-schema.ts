import { z } from 'zod';

// Single source of truth for PersonForm validation. PersonForm itself is a
// B-shape carve-out per `docs/wiki/forms.md` (native `<form action={action}>`
// + `useActionState` + `useTouched()` — auto-fill-heavy UX doesn't fit a full
// RHF restructure), so the form does *not* call `zodResolver`. The action
// layer still imports this schema and runs `safeParse(Object.fromEntries(formData))`
// — the shared schema is the server-side validation contract regardless of
// which client shape submits to it.
//
// Roles + dealer-links are multi-valued FormData keys (`roles` repeated, plus
// `dealerLinks` as `<id>:<role>` strings). `Object.fromEntries` would collapse
// them to a single value, so those stay as separate `formData.getAll(...)`
// parsers in `people/actions.ts`. This schema covers the simple scalar fields.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const personFormSchema = z.object({
  firstName: z
    .string({ error: 'First and last name are both required.' })
    .trim()
    .min(1, 'First and last name are both required.'),
  lastName: z
    .string({ error: 'First and last name are both required.' })
    .trim()
    .min(1, 'First and last name are both required.'),
  email: z
    .string()
    .trim()
    .refine((v) => v === '' || EMAIL_RE.test(v), 'Email looks invalid.')
    .optional(),
  phone: z.string().trim().optional(),
  // Wire format from the form's hidden `appAccess` checkbox: `'1'` when
  // granted, `''` or absent otherwise.
  appAccess: z
    .string()
    .refine((v) => v === '' || v === '1', 'Invalid app-access flag.')
    .optional(),
});

export type PersonFormValues = z.infer<typeof personFormSchema>;
