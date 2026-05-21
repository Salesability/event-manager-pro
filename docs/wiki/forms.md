# Forms

The form convention for staff-facing UI. Established by 0042 (shadcn/ui sweep): every domain form is built on **react-hook-form (RHF) + zod + shadcn `<Field>` primitives**, with submission going through a **Server Action**.

Two acceptable shapes (per-form complexity dictates which):

1. **Full RHF + zod port** — `useForm` + `zodResolver` + `form.handleSubmit`. Field-level validation, dirty/touched tracking, programmatic `setError`. Use this when the form has computed values driven by `watch`, conditional sections, or non-trivial validation rules. Reference: `src/features/dealers/dealer-form.tsx`, `src/features/quotes/quote-composer.tsx`.
2. **Partial port** — native `<form action={formAction}>` + `useActionState`, browser-native `required` / `type="email"` validation, custom `useTouched()` hook for inline required-state messages. Use this when the form has auto-fill UX driven by raw `useState` (e.g. dealer-pick populates contact/phone/email unless touched) and a full RHF restructure would be net-negative. Reference: `src/app/(app)/calendar/booking-form.tsx`, `src/features/people/people-admin.tsx` PersonForm.

Both shapes use the same shadcn Field primitives for layout + validation visuals.

**Page-level vs. dialog-level submission.** Form save buttons inside `<Dialog>`s stay in `<DialogFooter>` — that's the canonical dialog UX. Page-level primary actions (Save / Send / Export on a full-page form like the quote composer) live in `<PageHeader actions>` per the [layout.md](layout.md) convention, not at the bottom of a scrolling page. The two patterns don't collide; the dividing line is *which kind of submit it is*.

## Primitives

| What | Import | Notes |
|---|---|---|
| Form layout | `<Field>`, `<FieldGroup>`, `<FieldLabel>`, `<FieldDescription>`, `<FieldError>`, `<FieldSet>`, `<FieldLegend>` | From `@/components/ui/field`. Never use raw `<div className="flex flex-col gap-1">` for a labeled control — that's what `<Field>` is for. |
| Text inputs | `<Input>`, `<Textarea>` | From `@/components/ui/input` / `@/components/ui/textarea`. Wrap each one in `<Field>`. |
| Option sets (2–7 choices) | `<ToggleGroup>` + `<ToggleGroupItem>` | From `@/components/ui/toggle-group`. Base UI's ToggleGroup uses **array-shape `value`** for single-select mode — see `quote-composer.tsx`'s retrieval-bracket Controller for the `field.value → [String(field.value)]` adapter. |
| Combobox / dealer picker | `<Combobox>` + `<ComboboxInput>` + `<ComboboxContent>` + `<ComboboxList>` + `<ComboboxItem>` + `<ComboboxEmpty>` | From `@/components/ui/combobox`. Object items: pass `items={objArray}` + `itemToStringValue={...}` + `itemToStringLabel={...}`. `value` is the selected item object (or `null`). |
| Select (native fallback) | Native `<select>` | Acceptable for 2–3 option toggles where shadcn `<Select>` would be overkill (status enum, role picker). See dealer-form's status `<select>`. |
| Dialog wrapper | `<Dialog>` + `<DialogContent>` + `<DialogTitle>` + `<DialogDescription>` + `<DialogClose>` | From `@/components/ui/dialog`. `open` + `onOpenChange`, **not** `open` + `onClose`. The overlay/portal is rendered inside `<DialogContent>` — don't add a separate backdrop. |
| Validation state | `data-invalid` on `<Field>`, `aria-invalid` on the control | Both must be set so the shadcn focus-ring + label color flip correctly. Use `data-invalid={touched.x || undefined}` so `false` collapses out of the attribute. |

## Schema-as-contract

The same zod schema is the single source of truth for **both** sides of the wire — the client form (via `zodResolver`) and the Server Action (via `safeParse`). Client validation rejects bad input before it ships; server validation rejects it again because the action layer is the security boundary and can't trust the client. Drift between the two is the bug class this rule prevents.

**Where the schema lives.** One zod schema per form, in a sibling `*-schema.ts` module next to the form component. The form imports it, the Server Action imports it. Examples:

```
src/features/dealers/dealer-schema.ts     ← imported by both
src/features/dealers/dealer-form.tsx       ← uses zodResolver(dealerFormSchema)
src/features/schedule/actions.ts           ← uses dealerFormSchema.safeParse(...)
```

Colocated-inside-component (`const schema = z.object({...})` declared in the same file as `useForm`) is **not** allowed for forms whose Server Action target also wants to validate. The schema must live in a module both sides can import.

**The wire format and the round-trip.** Server Actions take `FormData` (a string-keyed multimap). The form's `valuesToFormData(values, id?)` adapter (per the "Server Action submission" section below) converts RHF's typed values back into that wire format on submit. The Server Action reverses it:

```ts
const parsed = dealerFormSchema.safeParse(Object.fromEntries(formData));
if (!parsed.success) {
  return { error: 'Invalid input.', fieldErrors: parsed.error.flatten().fieldErrors };
}
const values = parsed.data;
```

The schema's job is to accept that wire-format input cleanly. Practical implications:

- Optional fields should accept `''` from the FormData wire (not just `undefined`). Use `.optional()` on top of `z.string()` — empty strings round-trip through `Object.fromEntries` as `''`, not absent. Trim with `.trim()` inside `z.string()` so the action gets a normalized value.
- Numeric IDs arrive as strings — coerce explicitly with `z.coerce.number().int().positive()` (or a custom `z.preprocess` for nullable ids).
- Enum fields use `z.enum(['active', 'prospect'])` — the string set matches the wire shape directly.

**B-shape variant.** Forms that stay on the partial-RHF path (native `<form action={formAction}>` + `useActionState`, e.g. booking-form, PersonForm) do **not** call `zodResolver` — they get browser-native `required` + `useTouched()` for inline visuals. **The action still imports and `safeParse`s the same schema.** The client gets simpler validation visuals; the server gets the same zod contract either way. Single-field admin forms (e.g. lookup-admin) are a sub-case — `<form action={action}>` + a one-field schema is fine, no `useActionState` wiring needed.

## Schema-first with zod + `z.infer`

Every RHF form starts with a zod schema in a sibling `*-schema.ts` module. Derive the values type with `z.infer` so the resolver and the form state line up exactly.

```ts
// src/features/dealers/dealer-schema.ts — imported by form + action
export const dealerFormSchema = z.object({
  name: z.string().trim().min(1, 'Dealership name is required.'),
  contactFirst: z.string().trim().optional(),
  contactLast: z.string().trim().optional(),
  contactEmail: z
    .string()
    .trim()
    .refine((v) => v === '' || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), 'Email looks invalid.')
    .optional(),
  contactPhone: z.string().trim().optional(),
  address: z.string().trim().optional(),
  status: z.enum(['active', 'prospect']),
  acquiredVia: z.string().trim().max(200).optional(),
});
export type DealerFormValues = z.infer<typeof dealerFormSchema>;
```

```ts
// src/features/dealers/dealer-form.tsx
const form = useForm<DealerFormValues>({
  resolver: zodResolver(dealerFormSchema),
  defaultValues: { /* … */ },
  mode: 'onTouched',
});
```

`mode: 'onTouched'` matches the project's UX: errors don't shout while you're typing, they appear once you've left the field. `'onBlur'` is the same idea but `'onTouched'` keeps the error visible once it appears even if the field is re-focused.

## Server Action submission

The submission target is **always a Server Action**, not a route handler (CLAUDE.md → "Mutations go through Server Actions"). The Server Action signature is FormData-in, `{ ok: true } | { error, fieldErrors? }`-out (via `toLegacyResult`).

### Full RHF path

```tsx
async function onSubmit(values: DealerFormValues) {
  const fd = valuesToFormData(values, dealer?.id);
  const result = toLegacyResult(await action(fd));
  if ('ok' in result) {
    toast.success('Saved');
    onSuccess();
    return;
  }
  // Field-shaped errors → setError; otherwise toast.
  if (result.fieldErrors) {
    for (const [name, message] of Object.entries(result.fieldErrors)) {
      form.setError(name as keyof DealerFormValues, { type: 'server', message });
    }
  } else {
    toast.error(result.error);
  }
}

return (
  <form onSubmit={form.handleSubmit(onSubmit)}>
    {/* … */}
  </form>
);
```

Notes:
- `valuesToFormData(values, id?)` is a per-form adapter that translates RHF's typed values back into the FormData shape the Server Action expects. Keep this adapter narrow — the action's wire format is the contract.
- `setError(fieldName, { type: 'server', message })` lights up the corresponding `<FieldError>` next to the input. The `type: 'server'` tag distinguishes server-side errors from client-side zod-resolver errors; useful when you want to programmatically clear only server errors on next submit.
- Today most Server Actions return single-string `{ error }` payloads (not `{ fieldErrors }`). Per-field mapping is wired up on the form side; it just doesn't fire until an action surfaces a field-shaped payload. When you add one, the form will route it automatically.

### Partial path (native `<form action={formAction}>` + `useActionState`)

```tsx
const [state, formAction, pending] = useActionState<PersonFormState, FormData>(
  async (_prev, fd) => toLegacyResult(await action(fd)),
  null,
);

useEffect(() => {
  if (!state) return;
  if ('ok' in state) {
    toast.success('Saved');
    onSuccess();
  } else {
    toast.error(state.error);
  }
}, [state, onSuccess]);

return (
  <form action={formAction}>
    <Field data-invalid={touched.firstName || undefined}>
      <FieldLabel htmlFor="person-firstName">First name</FieldLabel>
      <Input
        id="person-firstName"
        name="firstName"
        required
        aria-invalid={touched.firstName || undefined}
        {...fieldHandlers('firstName')}
      />
      {touched.firstName && <FieldError>First name is required.</FieldError>}
    </Field>
    {/* … */}
  </form>
);
```

The `useTouched()` hook (`src/features/people/people-admin.tsx`) adds a blur-triggered required-state path on top of the browser's native validation (which only fires on `change` / `invalid` events, not blur).

## Decision matrix — in-house vs shadcn primitive

The 0042 sweep replaced the in-house `dialog` / `combobox` / `tabs` wrappers with shadcn Base UI primitives. Two pre-existing primitives **kept their in-house implementation** because they carry project-specific behaviour:

| Primitive | Status | Reason |
|---|---|---|
| `@/components/ui/dialog` | shadcn (Base UI) | Direct port from in-house Radix wrapper. The new API is `<Dialog open onOpenChange>` + `<DialogContent>` (overlay rendered inside) instead of `<Dialog.Root open onClose>` + `<Dialog.Backdrop>` + `<Dialog.Panel>`. |
| `@/components/ui/combobox` | shadcn (Base UI) | Compositional API (`<Combobox items={...}>` + `<ComboboxInput>` + `<ComboboxContent><ComboboxList>{(item) => <ComboboxItem>…</ComboboxItem>}</ComboboxList></ComboboxContent>`). Replaced the in-house cmdk-based `<Combobox options={...} value={...} onChange={...}>` wrapper. |
| `@/components/ui/tabs` | shadcn (Base UI) | `<Tabs value onValueChange>` + `<TabsList>` + `<TabsTrigger>` + `<TabsContent>`. The shipped `data-horizontal:flex-col` selector was rewritten to `data-[orientation=horizontal]:flex-col` (and the matching group-variants) so the root's horizontal-stack layout actually fires against the explicit `data-orientation="horizontal"` attribute. |
| `@/components/ui/data-table` | in-house | Carries column-config conventions from 0023 (column ordering, archived-row dimming, dealer-link cell rendering). Built on TanStack Table; not a direct shadcn equivalent. |
| `@/components/ui/toaster` | in-house | Wraps `sonner` but adds **audit-log callbacks** per closed/0030 — every `toast.success`/`toast.error` can route to the forensic audit log if the call site opts in. Pure-sonner would lose that. |
| `@/components/ui/field`, `input`, `textarea`, `label`, `button`, `select`, `popover`, `separator`, `toggle`, `toggle-group`, `input-group` | shadcn (Base UI) | Stock shadcn primitives, no project-specific behaviour. |

### When to extend a shadcn component vs build new

Default is "**use shadcn as-shipped**" — the components are already in `src/components/ui/` and can be edited. The 0042 sweep made small, targeted edits (the Tabs orientation-selector rewrite is the canonical example). Don't build a new wrapper layer around a shadcn primitive unless one of these applies:

1. **Project-specific side effect** that the primitive doesn't model (e.g. `toaster`'s audit-log callbacks).
2. **Wire format mismatch** that affects many call sites and would otherwise mean adapter logic at every site (e.g. the in-house `<Combobox options={...}>` was a wrapper around cmdk for this reason — the shadcn 4.x Base UI Combobox replaces it because the new compositional API is the project pattern going forward).
3. **Accessibility plumbing** that the primitive doesn't supply and we can't push upstream (none today).

Adding a thin variant (a CVA `variant: "compact"`) directly in the shadcn file is fine; that's still shadcn-as-shipped.

## Conventions checklist

- [ ] Schema: zod, in a sibling `<feature>/<thing>-schema.ts` module, imported by **both** the form and the Server Action.
- [ ] Values type: `export type X = z.infer<typeof xSchema>` from the schema module.
- [ ] Resolver (A-shape): `zodResolver(schema)`. Mode: `'onTouched'` unless there's a specific reason to use `'onChange'`/`'onBlur'`.
- [ ] Action validation: first lines of the Server Action are `const parsed = schema.safeParse(Object.fromEntries(formData)); if (!parsed.success) return { error: '…', fieldErrors: parsed.error.flatten().fieldErrors };`. Use `parsed.data` for the DB write.
- [ ] Layout: `<Field>` + `<FieldLabel htmlFor>` + control + optional `<FieldError>`. Never raw `<div className="flex flex-col gap-1">`.
- [ ] Validation visuals: `data-invalid` on `<Field>`, `aria-invalid` on the control. Use `{cond || undefined}` so `false` collapses.
- [ ] Submission: `form.handleSubmit(async values => …)` calls a Server Action. No `fetch` to a route handler.
- [ ] Server-error routing: single-string `{ error }` → `toast.error`. Per-field `{ fieldErrors }` → `form.setError(name, { type: 'server', message })`.
- [ ] Submit button: outside any `<FormField>` block; `disabled={form.formState.isSubmitting || !hasRequiredState}`.

## See also

- `CLAUDE.md` → "Mutations go through Server Actions, not route handlers."
- `docs/wiki/conventions.md` → cross-cutting rules (Server Actions, Drizzle, audit columns).
- `docs/wiki/security.md` → action-layer authorization (`requireRole`) sits between the form submission and the database write.
- `docs/chunks/closed/0024-people-admin/plan.md` → original Radix Form adoption decision (Phase 4 was deferred, then revisited and reversed by 0042 Phase 6).
- `docs/chunks/closed/0042-shadcn-ui-sweep/plan.md` → primitive-by-primitive port log, including the Tabs orientation-selector regression.
