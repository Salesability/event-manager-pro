# Form schema-as-contract rollout

**Started:** 2026-05-13

## Progress Tracker

| Phase | Status | Commit |
|-------|--------|--------|
| 1: Doctrine — extend `forms.md` with schema-as-contract rule | Done | `25cc0f0` |
| 2: Extract canonical schemas (dealer, quote) into shared modules + wire `safeParse` into existing actions | Done | `2e9853d` |
| 3: services-admin — port to A-shape RHF + shared schema + action `safeParse` | Done | `80e082e` |
| 4: availability-admin — port to A-shape RHF + shared schema + action `safeParse` | In Progress | - |
| 5: lookup-admin — minimal shared schema + action `safeParse` (carve-out from RHF) | Pending | - |
| 6: B-shape backfill — booking-form + PersonForm: share the same zod schema into the action `safeParse`, keep `useActionState` UI | Pending | - |
| 7: Retire `schedule/validators.ts` hand-rolled helpers superseded by shared zod schemas | Pending | - |
| 8: ESLint rule — `schema-as-contract/safeparse-required` locks in the convention | Pending | - |
| 9: Smoke verification + eval | Pending | - |

The forms audit on 2026-05-13 surfaced two gaps: (a) the same zod schema is **not** shared between the client form and the Server Action — every action today either hand-rolls validation (`schedule/validators.ts`) or has none at all (`services-admin`); (b) three forms (`services-admin`, `availability-admin`, `lookup-admin`) don't follow either of the two shapes documented in `docs/wiki/forms.md`. The doctrine in `forms.md` is already correct; this chunk **closes the schema-sharing loop and brings the stragglers onto a documented shape**. "Done" means every non-trivial form has a single zod schema imported by both client (`zodResolver`) and server (`safeParse`), every Server Action's first lines are `const parsed = schema.safeParse(...); if (!parsed.success) return …;`, and the hand-rolled `validators.ts` helpers it replaces are deleted.

## Code Anchors

| New code | Anchor (`path:line`) | Why this anchor |
|----------|---------------------|-----------------|
| `src/features/dealers/dealer-schema.ts` (new — extracted) | `src/lib/quotes/pricing.ts` (`quoteInputsSchema`) | Existing example of a zod schema in its own module, imported by both UI and server logic — the pattern this chunk generalizes. |
| `src/features/quotes/quote-schema.ts` (new — extracted) | `src/lib/quotes/pricing.ts` | Same — and the existing `quoteInputsSchema` likely belongs in this new file or is re-exported through it. |
| `src/features/services/service-schema.ts` (new) | `src/features/dealers/dealer-form.tsx:33` (existing colocated `dealerFormSchema`) | Same shape as the dealer schema once extracted; field set is small and string-heavy. |
| `src/features/schedule/availability-schema.ts` (new) | `src/features/dealers/dealer-form.tsx:33` | A-shape schema for a multi-field form (date + kind + coach). |
| `src/features/schedule/lookup-schema.ts` (new) | `src/features/schedule/validators.ts:1` | Single-field schema; anchor on the hand-rolled helpers it replaces to confirm coverage. |
| `services-admin.tsx` A-shape rewrite | `src/features/dealers/dealer-form.tsx` (whole file) | Closest existing A-shape form — same dialog-mount pattern, same `valuesToFormData` adapter shape. |
| `availability-admin.tsx` A-shape rewrite | `src/features/dealers/dealer-form.tsx` | Same — A-shape with mixed inputs. |
| `createDealer` / `updateDealer` `safeParse` insertion (`schedule/actions.ts`) | `src/features/people/actions.ts` (existing hand-rolled action shape that pulls fields from FormData) | Anchors on how a Server Action currently extracts FormData; the new pattern replaces those `field(formData, 'x')` calls with `schema.safeParse(Object.fromEntries(formData))`. |
| All other action `safeParse` calls | Same — once one action is converted, subsequent conversions anchor on it. | Within-chunk anchoring after Phase 2. |

**Conventions referenced:**
- `docs/wiki/forms.md` — already establishes the two acceptable form shapes (full RHF + partial RHF) and shadcn `<Field>` layout. This chunk *adds* the schema-sharing requirement.
- `docs/wiki/conventions.md` — Server Actions for mutations.
- `CLAUDE.md` → "Mutations go through Server Actions, not route handlers."

**Overall Progress:** 33% (3/9 phases complete)

**Note:**
- Schema sharing requires the schema to live in a module that **both** client component and Server Action can import. Colocated-inside-component is therefore insufficient — Phase 2 extracts the two canonical examples first to establish the pattern.
- The form's `valuesToFormData` adapter (per `forms.md` line 85) bridges the RHF-typed values back into the FormData wire format. The Server Action's `safeParse(Object.fromEntries(formData))` reverses the adapter — schema is the contract, FormData is the wire format, RHF values is the typed-client shape.
- Phase 7 is a cleanup gate — only delete `validators.ts` helpers that have a zod-schema replacement covering the same input. Helpers used only by un-ported B-shape forms stay.
- Phase 8 lands an ESLint rule modeled on the existing `eslint-plugins/action-gate.mjs` — runs as `error` from day one because every prior phase has converted its actions. Opt-out comment mirrors `// authz: public`: `// validation: skip` on the function. Lands after Phase 7's cleanup so the rule sees a uniform surface.

### Phase Checklist

#### Phase 1: Doctrine — extend `forms.md` with schema-as-contract rule
- [x] Add a new section "Schema-as-contract" to `docs/wiki/forms.md` stating: one zod schema per form lives in a sibling `*-schema.ts` module; imported by the component (`zodResolver(schema)`) and the Server Action (`schema.safeParse(Object.fromEntries(formData))`); the schema is the single source of truth for both client validation and server-side rejection.
- [x] Document the `valuesToFormData` / `safeParse(Object.fromEntries(formData))` round-trip explicitly.
- [x] Add a row to the "Conventions checklist" section: "Schema lives in `<feature>/<thing>-schema.ts`, imported by both the form and the action."
- [x] Document the B-shape variant: native `<form action={action}>` does not call `zodResolver` but the action still imports + `safeParse`s the same schema. The client gets browser-native validation + `useTouched()` for visuals; the server gets the same zod contract.
- [x] Append entry to `docs/wiki/log.md`.

#### Phase 2: Extract canonical schemas + wire `safeParse` into existing actions
- [x] Create `src/features/dealers/dealer-schema.ts`; move `dealerFormSchema` from `dealer-form.tsx:33` into it; re-export from form file if needed for backward compat (probably not — internal-only).
- [x] Update `dealer-form.tsx` to import the schema.
- [x] In `schedule/actions.ts`, find `createDealer` and `updateDealer`; replace per-field `field(formData, ...)` extraction with `const parsed = dealerFormSchema.safeParse(Object.fromEntries(formData))`; return `{ error, fieldErrors: parsed.error.flatten().fieldErrors }` on failure; pass `parsed.data` into the DB write.
- [x] ~~Same for the quote schema: extract from `quote-composer.tsx`, place at `src/features/quotes/quote-schema.ts`~~ — `quoteInputsSchema` already lives at `src/lib/quotes/pricing.ts` and is the right home (shared with the PDF renderer + pricing module); no move needed. Composer imports it via `quoteFormSchema = quoteInputsSchema.extend(...)`.
- [x] Update the quote create/update Server Actions in `src/features/quotes/actions.ts` to `safeParse` the same schema. `parseQuoteInputs` now JSON-parses the wire `inputs` field, merges over `DEFAULT_QUOTE_INPUTS`, then `quoteInputsSchema.safeParse(merged)` — strict-strip keeps the unknown-key defense.
- [x] Test: existing `actions.test.ts` in dealers + quotes should still pass with the same assertions; add a new test case per file: malformed FormData → action returns `{ error, fieldErrors }` shape.

#### Phase 3: services-admin — A-shape port
- [x] Create `src/features/services/service-schema.ts` covering the service add + edit field set (name, category, default price, etc. — derive from current `services-admin.tsx` form).
- [x] Rewrite `src/features/services/services-admin.tsx` add-form (lines ~80–161) using `useForm({ resolver: zodResolver(serviceSchema) })` + shadcn `<Field>` primitives + `form.handleSubmit`. Mirror `dealer-form.tsx` structure.
- [x] Rewrite the edit-form (lines ~263–346) same way; if shape is identical to add-form, factor a shared `<ServiceForm>` component. Factored into one `<ServiceForm mode='create'|'edit'>` — code is read-only in edit mode, otherwise the field set is identical.
- [x] In `src/features/services/actions.ts`, add `safeParse(Object.fromEntries(formData))` to each mutation; return field-shaped errors.
- [x] Test: `actions.test.ts` for services — add fieldError-shape assertion.
- [x] Side-effect: extended `toLegacyResult` to forward `fieldErrors` when the action returns them, so the form's `setError` per-field routing works through the legacy adapter.

#### Phase 4: availability-admin — A-shape port
- [ ] Create `src/features/schedule/availability-schema.ts` covering date + kind + coach + reason fields.
- [ ] Rewrite `src/features/schedule/availability-admin.tsx` add-form (lines ~78–102) using `useForm({ resolver: zodResolver(availabilitySchema) })` + shadcn `<Field>`. Native `<select>` is acceptable per `forms.md` "Select (native fallback)" row.
- [ ] In `src/features/schedule/actions.ts`, wire `safeParse` into the availability create action.
- [ ] Test: new action-level test covering happy path + fieldErrors on bad input.

#### Phase 5: lookup-admin — schema + action safeParse, no RHF (carve-out)
- [ ] Create `src/features/schedule/lookup-schema.ts` with `{ label: z.string().min(1) }`.
- [ ] Keep `lookup-admin.tsx` as-is (single field, B-shape — `<form action={action}>` + browser-native `required`).
- [ ] Wire `safeParse` into the corresponding action in `schedule/actions.ts`.
- [ ] Update `forms.md` to add "single-field admin forms" as an explicit B-shape sub-case where `useActionState` is overkill and `<form action={action}>` is fine — but the action still `safeParse`s.

#### Phase 6: B-shape backfill — booking-form + PersonForm
- [ ] Create a zod schema for the booking-form input shape; place at `src/app/(app)/calendar/booking-schema.ts` (next to the form — booking-form is not under `features/`).
- [ ] Wire `safeParse` into the booking-form's Server Action target. Leave the UI as-is (per `forms.md`, this is an intentional B-shape carve-out for auto-fill UX).
- [ ] Same for `PersonForm` in `src/features/people/people-admin.tsx`: create `src/features/people/person-schema.ts`; wire `safeParse` into `people/actions.ts`. UI stays B-shape with the `useTouched()` hook.
- [ ] Verify both forms still pass their existing tests.

#### Phase 7: Retire superseded `schedule/validators.ts` helpers
- [ ] Audit `src/features/schedule/validators.ts`: list every exported helper, find each call site.
- [ ] For each helper whose call sites are now in actions that `safeParse` a zod schema, delete the helper and remove the import.
- [ ] Helpers still used by un-ported code (if any) stay.
- [ ] `EMAIL_RE` likely stays as a re-usable constant unless every consumer is now schema-driven.

#### Phase 8: ESLint rule — lock in the schema-as-contract convention
- [ ] Create `eslint-plugins/schema-as-contract.mjs` mirroring the shape of `eslint-plugins/action-gate.mjs`. Export a single rule `safeparse-required` that walks each exported async function in matched files, inspects its body for a `FormData` parameter (or a top-level `formData` reference), and reports if no `<schema>.safeParse(Object.fromEntries(<formData>))` (or `<schema>.safeParse(<formData>)`) call appears in the first ~10 statements.
- [ ] Opt-out: a `// validation: skip` comment immediately above the function declaration suppresses the rule for that function (mirrors `// authz: public` in action-gate).
- [ ] Add `eslint-plugins/schema-as-contract.test.ts` with cases covering: (a) action with `safeParse` → pass; (b) action without `safeParse` → error; (c) action with `// validation: skip` → pass; (d) non-FormData action (no `FormData` parameter) → pass (rule doesn't apply); (e) action that destructures FormData but doesn't call `safeParse` → error.
- [ ] Wire into `eslint.config.mjs`: add a new config block scoped to `src/features/**/actions.ts` registering the plugin with `"schema-as-contract/safeparse-required": "error"`. Do **not** scope to `src/app/**/route.ts` — route handlers accept external callers and their validation contract is different.
- [ ] Run `pnpm lint` from a clean working tree — must pass with zero errors. If any action lights up, it's a Phase 3–7 conversion miss, not a rule bug; fix the action.
- [ ] Update `docs/wiki/forms.md` "Schema-as-contract" section: add a sentence noting the lint rule enforces this in `src/features/**/actions.ts` and reference the opt-out comment.

#### Phase 9: Smoke verification + eval
- [ ] Smoke (web-test): `goto /admin/services`; section "Services" with add-form fields `Name` / `Category` / `Price` / `Add Service` button.
- [ ] Smoke (web-test): `goto /admin/availability`; add-form with `Start Date` / `End Date` / `Type` / `Coach` / `Reason` / `Add Block`.
- [ ] Smoke (web-test): `goto /admin/lookups`; section "Event Styles" lists existing rows + has an `Add` input.
- [ ] Smoke (web-test): `goto /dealerships`; click into a dealer detail → "Edit" → dialog opens with the dealer form A-shape unchanged.
- [ ] Smoke (web-test): `goto /quotes/new`; quote composer dialog renders with the same field set as before.
- [ ] Run `pnpm test` — all action-level tests pass, including new fieldError assertions.
- [ ] Run `pnpm lint` — Phase 8 rule must report zero errors.
- [ ] Run `/eval` — gate must pass before commit.
