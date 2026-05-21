# Inline "+ Add" for Dealer & Coach in the Booking Window — Plan

**Intent:** [`intent.md`](intent.md)
**Started:** _Not started — scaffolded 2026-05-21_

## Progress Tracker

| Phase | Status | Commit |
|-------|--------|--------|
| 1: Focused coach quick-add form (reuses `createPerson`) | Done | `coach-add-form.tsx` + pure `coach-add-schema.ts` + test (forces roles=coach + appAccess=1) |
| 2: "+ Add" dealer button + dialog in booking form | Done | dealer Field gains "+ Add" → Dialog hosting `DealerForm` (`defaultStatus='prospect'`) |
| 3: "+ Add" coach button + dialog in booking form | Done | coach Field gains "+ Add" → Dialog hosting `CoachAddForm` |
| 4: Refresh + auto-select the new option without dropping the draft | Done | coach auto-selects (local `extraCoaches` + controlled `coachId`); dealer = refresh-only (follow-up) |
| 5: Tests + smoke verification | In Progress | unit done (886 pass); browser smoke pending (dev server restart) |

This chunk wires inline create affordances into the booking dialog's dealer and coach pickers, reusing the existing create actions/forms. "Done" looks like: clicking "+ Add" opens a create dialog, saving inserts the record and selects it in the picker, and the in-progress booking is preserved.

## Code Anchors

| New code | Anchor (`path:line`) | Why this anchor |
|----------|---------------------|-----------------|
| "+ Add" button + Dialog next to dealer/coach pickers | `src/app/(app)/calendar/booking-form.tsx:244-278` (Manage button + `<Dialog>` for Event Format / Data Source) | Same dialog pattern already in this file — match it exactly |
| Dealer create dialog body | `src/features/dealers/dealer-form.tsx:55` (`DealerForm` — already reusable, `onSuccess`/`onCancel`/`defaultStatus`) | Drop-in; built in 0035 for exactly this |
| New `CoachAddForm` (`src/features/people/coach-add-form.tsx`) | `src/features/dealers/dealer-form.tsx:55` (`DealerForm` — `onSuccess`/`onCancel`, `useActionState`) | Focused quick-add; mirror DealerForm's callback shape rather than extract the heavy `PersonForm` (see Phase 1 decision) |
| Picker option refresh/append | `src/features/schedule/queries.ts:166` (`loadDealers`), `:258` (`loadCoaches`) | Source of the prop lists; the create action returns the new row to append |
| Create actions | `src/features/dealers/*` `createDealer`, `src/features/people/actions.ts` `createPerson` | Reuse — no new mutation surface |

**Conventions referenced:**
- `docs/wiki/data-model.md` — coaches are Contacts with `team_member_roles(role='coach')`; dealers carry the `prospect` lifecycle status.
- `CLAUDE.md` → **Conventions** — creates go through the existing Server Actions.

**Overall Progress:** 90% (4.5/5 phases — code complete; only the browser smoke remains)

**Note:**
- `DealerForm` reused as-is. Coach side uses the new focused `CoachAddForm` (Phase 1 decision) rather than extracting `PersonForm`.
- **Follow-up — dealer inline auto-select:** the coach picker auto-selects the new coach (its form returns the id); the **dealer** picker doesn't, because `createDealer` returns `{ ok: true }` (no id) and `DealerForm.onSuccess` is argless. After an inline dealer create the dialog closes and `router.refresh()` repopulates the list, but the user re-picks the dealer manually. To match the coach UX, make `createDealer` return `dealerId` and thread it through `DealerForm.onSuccess(createdId?)` → booking-form auto-select. Out of scope here (touches a capability-gated action + the shared form); small additive change when picked up.

### Phase Checklist

#### Phase 1: Coach quick-add form
> **Decision (2026-05-21):** build a focused coach quick-add form instead of extracting `PersonForm`. `PersonForm` (`people-admin.tsx:336-635`) is ~300 lines and security-sensitive (admin/dealer roles, app-access ban-confirm, dealer-links Combobox/Listbox) — overkill mid-booking. We only need name + email + phone; the real single source (the `createPerson` Server Action + its Zod validation) is reused either way. Lower blast radius on the people-admin surface, simpler booking UX.
- [x] `src/features/people/coach-add-form.tsx` — client form: first/last name, email (required — coach implies app access), phone; hidden `roles=coach` + `appAccess=1`
- [x] Submits to `createPerson`; on success calls `onCreated(contactId, label)` so the caller can append + select the new coach
- [x] `onCancel` callback; mirrors `DealerForm`'s `onSuccess`/`onCancel` shape
- [x] Unit/render test: renders fields; forces `roles=coach` + `appAccess=1` in the wire format

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
