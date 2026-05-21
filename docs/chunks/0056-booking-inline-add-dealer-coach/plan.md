# Inline "+ Add" for Dealer & Coach in the Booking Window — Plan

**Intent:** [`intent.md`](intent.md)
**Started:** _Not started — scaffolded 2026-05-21_

## Progress Tracker

| Phase | Status | Commit |
|-------|--------|--------|
| 1: Extract `PersonForm` → exportable, coach-default | Pending | - |
| 2: "+ Add" dealer button + dialog in booking form | Pending | - |
| 3: "+ Add" coach button + dialog in booking form | Pending | - |
| 4: Refresh + auto-select the new option without dropping the draft | Pending | - |
| 5: Tests + smoke verification | Pending | - |

This chunk wires inline create affordances into the booking dialog's dealer and coach pickers, reusing the existing create actions/forms. "Done" looks like: clicking "+ Add" opens a create dialog, saving inserts the record and selects it in the picker, and the in-progress booking is preserved.

## Code Anchors

| New code | Anchor (`path:line`) | Why this anchor |
|----------|---------------------|-----------------|
| "+ Add" button + Dialog next to dealer/coach pickers | `src/app/(app)/calendar/booking-form.tsx:244-278` (Manage button + `<Dialog>` for Event Format / Data Source) | Same dialog pattern already in this file — match it exactly |
| Dealer create dialog body | `src/features/dealers/dealer-form.tsx:55` (`DealerForm` — already reusable, `onSuccess`/`onCancel`/`defaultStatus`) | Drop-in; built in 0035 for exactly this |
| Extracted `PersonForm` (coach default) | `src/features/people/people-admin.tsx:336` (local `PersonForm`) | Move out of the admin file, add `defaultRole='coach'`; keep RHF+Zod shape |
| Picker option refresh/append | `src/features/schedule/queries.ts:166` (`loadDealers`), `:258` (`loadCoaches`) | Source of the prop lists; the create action returns the new row to append |
| Create actions | `src/features/dealers/*` `createDealer`, `src/features/people/actions.ts` `createPerson` | Reuse — no new mutation surface |

**Conventions referenced:**
- `docs/wiki/data-model.md` — coaches are Contacts with `team_member_roles(role='coach')`; dealers carry the `prospect` lifecycle status.
- `CLAUDE.md` → **Conventions** — creates go through the existing Server Actions.

**Overall Progress:** 0% (0/5 phases complete)

**Note:**
- `DealerForm` is already reusable — Phase 2 is mostly the dialog wiring. The real work is Phase 1 (extracting `PersonForm`) + Phase 4 (preserving the booking draft on refresh).

### Phase Checklist

#### Phase 1: Extract PersonForm
- [ ] Move `PersonForm` from `people-admin.tsx` into `src/features/people/person-form.tsx`, exported
- [ ] Add a `defaultRole='coach'` prop; in coach context, hide/force role selection to coach
- [ ] Re-import into `people-admin.tsx` (no behavior change there)
- [ ] Unit/render test: form renders coach-defaulted; admin usage unchanged

#### Phase 2: "+ Add" dealer button + dialog
- [ ] Add "+ Add" button next to the dealership picker (`booking-form.tsx:183`), matching the Manage-button style
- [ ] Open a `<Dialog>` hosting `DealerForm` with `mode='create'` + `defaultStatus='prospect'` + `onSuccess`/`onCancel`

#### Phase 3: "+ Add" coach button + dialog
- [ ] Add "+ Add" button next to the coach picker (`booking-form.tsx:336`)
- [ ] Open a `<Dialog>` hosting the extracted coach form with `defaultRole='coach'`

#### Phase 4: Refresh + auto-select
- [ ] On create success, append the returned record to the picker's option list and select it
- [ ] Confirm the in-progress booking fields are preserved (no full reload that resets state)
- [ ] Handle the dealer auto-fill path (`onDealerChange` contact/phone/email) for a freshly-created dealer

#### Phase 5: Tests + smoke verification
- [ ] Smoke (web-test): `goto /calendar`; click "Book Event"; dialog shows dealership + coach pickers each with a "+ Add" button
- [ ] Smoke (web-test): click dealer "+ Add"; dialog with `DealerForm` fields appears (read-only traversal — do not submit)
- [ ] Smoke (web-test): click coach "+ Add"; coach form dialog appears
- [ ] Unit test: extracted `PersonForm` coach-default + admin reuse
