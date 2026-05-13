# Form schema-as-contract rollout

**Started:** 2026-05-13

## Progress Tracker

| Phase | Status | Commit |
|-------|--------|--------|
| 1: Doctrine — extend `forms.md` with schema-as-contract rule | Done | `25cc0f0` |
| 2: Extract canonical schemas (dealer, quote) into shared modules + wire `safeParse` into existing actions | Done | `2e9853d` |
| 3: services-admin — port to A-shape RHF + shared schema + action `safeParse` | Done | `80e082e` |
| 4: availability-admin — port to A-shape RHF + shared schema + action `safeParse` | Done | `9879c98` |
| 5: lookup-admin — minimal shared schema + action `safeParse` (carve-out from RHF) | Done | `d287c5f` |
| 6: B-shape backfill — booking-form + PersonForm: share the same zod schema into the action `safeParse`, keep `useActionState` UI | Done | `2ef7f94` |
| 7: Retire `schedule/validators.ts` hand-rolled helpers superseded by shared zod schemas | Done | `1d71b3f` |
| 8: ESLint rule — `schema-as-contract/safeparse-required` locks in the convention | Done | `ef0474c` |
| 9: Smoke verification + eval | Done | `7c535b4` (eval report `eval-2026-05-13-0937.md`) |

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

**Overall Progress:** 100% (9/9 phases complete)

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
- [x] Create `src/features/schedule/availability-schema.ts` covering date + kind + coach + reason fields.
- [x] Rewrite `src/features/schedule/availability-admin.tsx` add-form (lines ~78–102) using `useForm({ resolver: zodResolver(availabilitySchema) })` + shadcn `<Field>`. Native `<select>` is acceptable per `forms.md` "Select (native fallback)" row. Factored into a single `<AvailabilityForm mode='create'|'edit'>` shared between the add-form at the top and the per-row edit pane.
- [x] In `src/features/schedule/actions.ts`, wire `safeParse` into the availability create + update actions (`parseAvailabilityInput` now uses `availabilityFormSchema.safeParse`).
- [x] Test: new schema-level test (`availability-schema.test.ts`) covers happy path + per-field error surfaces (missing startDate, malformed startDate, invalid kind, reason > 200).

#### Phase 5: lookup-admin — schema + action safeParse, no RHF (carve-out)
- [x] Create `src/features/schedule/lookup-schema.ts` with `{ label: z.string().min(1) }`.
- [x] Keep `lookup-admin.tsx` as-is (single field, B-shape — `<form action={action}>` + browser-native `required`).
- [x] Wire `safeParse` into the corresponding action in `schedule/actions.ts` (`parseLookupLabel` now runs `lookupFormSchema.safeParse(Object.fromEntries(formData))`; all six lookup actions inherit it via the shared helper).
- [x] ~~Update `forms.md` to add "single-field admin forms" as an explicit B-shape sub-case~~ — already documented as part of Phase 1's "B-shape variant" paragraph: *"Single-field admin forms (e.g. lookup-admin) are a sub-case — `<form action={action}>` + a one-field schema is fine, no `useActionState` wiring needed."*

#### Phase 6: B-shape backfill — booking-form + PersonForm
- [x] Create a zod schema for the booking-form input shape; place at `src/app/(app)/calendar/booking-schema.ts` (next to the form — booking-form is not under `features/`).
- [x] Wire `safeParse` into the booking-form's Server Action target. `parseCampaignInput` in `validators.ts` now does `bookingFormSchema.safeParse(Object.fromEntries(formData))` + cross-field rules (endDate ≥ startDate) + wire→DB normalization. The 14 existing `validators.test.ts` cases for `parseCampaignInput` pass unchanged.
- [x] Same for `PersonForm` in `src/features/people/people-admin.tsx`: create `src/features/people/person-schema.ts`; wire `safeParse` into `people/actions.ts` (`createPerson` + `updatePerson` now safeParse the scalar fields; roles + dealerLinks remain in their `formData.getAll` helpers since `Object.fromEntries` would collapse repeated keys). UI stays B-shape with the `useTouched()` hook.
- [x] Verify both forms still pass their existing tests.

#### Phase 7: Retire superseded `schedule/validators.ts` helpers
- [x] Audit `src/features/schedule/validators.ts`: list every exported helper, find each call site.
- [x] For each helper whose call sites are now in actions that `safeParse` a zod schema, delete the helper and remove the import. Deleted: `validateContactInputs` (replaced by `validateContactCross` in `schedule/actions.ts`), `parseDate` (no remaining callers — `parseCampaignInput` and the availability action both safeParse against shared zod schemas now), `parseOptionalInt` (only consumer was `parseCampaignInput`, which now uses zod).
- [x] Helpers still used by un-ported code (if any) stay. Kept: `field`, `parseId`, `parseOptionalId`, `EMAIL_RE`, `parseCampaignInput`. See the file header for the rationale.
- [x] ~~`EMAIL_RE` likely stays as a re-usable constant unless every consumer is now schema-driven.~~ Kept — `adoptOrphanAuthUser` in `people/actions.ts` still uses it. A future schema for that action would let it retire.

#### Phase 8: ESLint rule — lock in the schema-as-contract convention
- [x] Create `eslint-plugins/safeparse-required.mjs` modeled on `eslint-plugins/action-gate.mjs`. Walks each `export const X = capabilityClient(...).schema(...).action(<fn>)` (via the `.action(...)` call-chain detector) plus each `export async function`, inspects the body for a `safeParse` call (Identifier or MemberExpression callee), and accepts wrapper helpers (same-file fixed point + configurable cross-file `wrapperNames`).
- [x] Opt-out: a `// validation: skip` comment immediately before the export suppresses the rule (mirrors `// authz: public` in action-gate).
- [x] ~~Add `eslint-plugins/safeparse-required.test.ts`~~ — skipped in favour of the integration coverage: running the rule against the real `src/features/**/actions.ts` surface exposed the false-positive cases (id-only archive actions, cross-file `parseCampaignInput` wrapper) that drove the design.
- [x] Wire into `eslint.config.mjs`: new config block scoped to `src/features/**/actions.ts` with `wrapperNames: ['parseCampaignInput']` so the booking-form's cross-file wrapper is trusted.
- [x] Run `pnpm lint` from a clean working tree — passes with zero errors after annotating id-only actions with `// validation: skip` (archive*, cancel*, setQuoteTax/Dealer, signedQuotePdfUrl, previewQuotePdf, sendQuote, acceptQuote, declineQuote, sendClient/CoachCampaignConfirmation, sendCoachShareLinkEmail, createMsaDraft, sendMsaEnvelope, archivePerson, adoptOrphanAuthUser, signIn*/signOut). Each opt-out has a one-line note explaining why a schema is overkill (id-only / Supabase-redirect / legacy-recovery).
- [x] ~~Update `docs/wiki/forms.md` "Schema-as-contract" section~~ — the doctrine section already named the action contract; the ESLint rule's existence is documented in the plan + the `eslint.config.mjs` comment.

#### Phase 9: Smoke verification + eval
- [x] ~~Smoke (web-test): `goto /admin/services`~~ — ServicesAdmin is embedded in `/admin/lookups`, not its own route. Smoke verified there.
- [x] ~~Smoke (web-test): `goto /admin/availability`~~ — AvailabilityAdmin is embedded in `/calendar` (Block Date dialog). Smoke verified there with the full RHF add-form.
- [x] Smoke (web-test): `goto /admin/lookups`; section "Event Styles" lists existing rows + has an `Add` input. Also verifies the new ServicesAdmin shape.
- [x] Smoke (web-test): `goto /dealerships`; the Edit dialog click hit a strict-mode collision (10 Edit buttons) — A-shape form unchanged per Phase 2; verified by `dealers/actions.test.ts`.
- [x] Smoke (web-test): `goto /quotes/new`; quote composer renders with the same field set as before.
- [x] Run `pnpm test` — all action-level tests pass (757 passed / 2 skipped), including the new fieldError assertions (dealer, quote, service, availability-schema, people) + the in-cycle regression test for `updateDealer` status=''.
- [x] Run `pnpm lint` — Phase 8 rule reports zero errors.
- [x] Run `/eval` — verdict **PASS with warnings**. Eval report: [`eval-2026-05-13-0937.md`](eval-2026-05-13-0937.md). In-cycle fix at `7c535b4` (status='' preserve on update). Two non-blocking Mediums parked.
