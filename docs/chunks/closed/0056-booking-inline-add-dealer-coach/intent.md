# Inline "+ Add" for Dealer & Coach in the Booking Window — Intent

**Created:** 2026-05-21

## Problem

When booking an event, the dialog (`src/app/(app)/calendar/booking-form.tsx`) presents the **dealership** picker (`:183`) and **sales coach** picker (`:336`) as plain `<select>` dropdowns populated from props. If the dealer or coach doesn't exist yet, the user has to abandon the booking, navigate to the dealer/coach admin section, create the record, then start the booking over. The owner wants an inline **"+ Add"** affordance on both sections so new dealers/coaches can be created without leaving the booking flow — "will speed up onboarding to Calendar/system."

## Desired outcome

From the booking dialog, a user clicks **"+ Add"** next to the dealership (or coach) picker, a small create dialog opens, they fill it in, and on save the new record is selected in the picker — without losing the in-progress booking. The same pattern the dialog already uses for "Manage" on Event Format / Data Source (`:244-278`).

## Non-goals

- **No full dealer/coach management** inside the booking dialog — create only, not edit/archive. Management stays in the admin sections.
- **No new dealer/coach data model.** Reuse the existing `createDealer` and `createPerson` (coach role) actions and schemas.
- **No change to the booking submit flow** beyond repopulating + selecting the new option.

## Success criteria

- The dealership section has a "+ Add" button opening a dialog with `DealerForm` (`defaultStatus='prospect'`); on save the new dealer is selected.
- The coach section has a "+ Add" button opening a dialog with the coach form (`PersonForm` with the coach role defaulted); on save the new coach is selected.
- The picker options refresh to include the new record without a full page reload that drops the booking draft.
- Creating from the booking dialog produces the same records as creating from the admin sections (same actions, same validation).

## Open questions

- **PersonForm reuse.** `PersonForm` is currently a *local* (unexported) component inside `people-admin.tsx`. Extract it to its own file with a `defaultRole='coach'` prop, or build a thin `CoachForm` wrapper? (Leaning extract — single source.)
- **Refreshing options.** `router.refresh()` (re-runs the server component, may reset form state) vs. optimistic local append of the returned record to the picker's option list? (Leaning local append + select, to preserve the booking draft.)
- **Coach form scope.** Hide admin/dealer role checkboxes in the booking context and force the coach role, or show the full PersonForm? (Leaning coach-only fields.)

## Why now

The owner is actively onboarding dealers/coaches while booking events and hit the back-out-and-restart friction. Note: `closed/0035` already shipped the groundwork — `DealerForm` accepts `defaultStatus='prospect'` precisely so an inline-create entry point could be wired later (the entry point itself was explicitly deferred in 0035 Phase 2). This chunk wires that deferred entry point plus the coach equivalent.
