import { z } from 'zod';

// Single source of truth for the single-field lookup add-form (Event Styles +
// Data Sources). Imported by both the client component (`lookup-admin.tsx` —
// uses the schema for type only, since the form is native `<form action={...}>`
// + `required`) and the Server Action (`schedule/actions.ts` — runs
// `safeParse(Object.fromEntries(formData))` as the validation contract).
//
// Single-field B-shape carve-out per `docs/wiki/forms.md` → "B-shape variant"
// — no `zodResolver`, no `useActionState`, just native HTML + the schema as
// the server-side validation contract.

export const lookupFormSchema = z.object({
  label: z
    .string({ error: 'Label is required.' })
    .trim()
    .min(1, 'Label is required.')
    .max(120, 'Label must be 120 characters or fewer.'),
});

export type LookupFormValues = z.infer<typeof lookupFormSchema>;
