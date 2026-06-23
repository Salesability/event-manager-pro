# Rationalize the dealer-contact role taxonomy — Intent

**Created:** 2026-06-22 · Surfaced from a prod bug report this session ("Dealer has no customer
contact with a primary email address" when quoting an imported prospect) → root-caused to a
`dealer_contacts.role` modeling problem. **Hotfix A already shipped** (`9489978`): the
quote/MSA recipient now picks the priority-primary contact instead of requiring `role='customer'`,
unblocking quoting. **This chunk does the durable cleanup** the hotfix points at.

## Problem

`dealer_contacts.role = customer | staff | prospect` is a category error inherited from the
legacy flat model, and it's barely load-bearing:

- **The dealership *is* the customer** (`dealers` row + `dealers.status: prospect|active`). The
  people linked via `dealer_contacts` are all "a person at the dealership." So
  `customer`-as-a-*contact*-role doesn't describe a relationship — it's really just "the person
  we send things to."
- **`prospect` is dead** — 0 rows; `dealers.status='prospect'` already carries prospect-ness.
- **`staff` is overloaded** — it also exists in the *us-side* `team_member_roles` enum
  (`admin|staff|coach|viewer|dealer`), where it means a Salesability employee. Same word, opposite
  side of the relationship.
- **Lopsided data** (sandbox, prod-shaped): `staff` = 313, `customer` = 24 (only the legacy
  `import-from-sheets.ts` ever wrote `customer`), `prospect` = 0. Every UI-created dealer + the
  0086 Atlantic import + the QBO import tag their contact `staff`.

The value is *read* in only ~4 places: `recipient.ts` (post-hotfix, priority not `customer`-only),
`queries.ts` `DEALER_CONTACT_ROLE_PRIORITY` (staff>customer>prospect — picks the displayed
primary contact), `people-columns.tsx` (a "Customer" filter/badge), and `people-admin.tsx` (the
role dropdown when linking a contact) + `people/actions.ts` validation.

## Desired outcome

A coherent model where a `dealer_contacts` row = **"a person at this dealership"**:

- **Job/title** stays in the existing free-text `dealer_contacts.title`.
- An **explicit primary-contact designation** marks who receives quotes/MSAs — replacing the
  `customer`/`staff`/`prospect` enum. Two candidate shapes (Phase-1 decision):
  - `is_primary` boolean on `dealer_contacts` (+ a partial-unique index for one primary per
    dealer), or
  - a 2-value role `primary | additional`.
- **Recipient resolution keys off the explicit designation** (deterministic fallback to lowest
  id), *superseding* hotfix A's priority heuristic with a real, user-editable choice.
- The People link UI lets an admin set/!change the primary contact instead of picking an opaque
  customer/staff/prospect role.

Observable end state: a dealer's primary contact is an explicit, editable property; quoting/MSA
sending targets it; the confusing `customer`/`prospect`/`staff` contact roles are gone, and
`staff` no longer collides with the us-side `team_member_roles` meaning.

## Non-goals (v1 scope guard)

- **No change to `team_member_roles`** (the us-side admin/coach/dealer/… enum) — different axis.
- **No multi-recipient send** (cc additional contacts / bcc coach) — still v2 (separate from this).
- **No billing-contact vs primary-contact split** unless Phase 1 decides it's cheap to include;
  default v1 is a single "primary" designation.
- **No contact-dedup / merge work** — that's the 0085 family.

## Success criteria

- `dealer_contacts` carries an explicit primary-contact designation; the old role enum is dropped
  (expand→migrate→contract per `db-conventions`), with the 24 `customer` rows + every dealer's
  current priority-primary backfilled correctly.
- `resolveQuoteRecipient` selects the designated primary (deterministic fallback); the priority
  heuristic from hotfix A is retired.
- The People link UI + `people/actions.ts` validation + the `people-columns.tsx` badge are updated
  to the new model with no dangling references to `customer`/`staff`/`prospect`.
- `data-model.md` (and `auth.md` if a gate changes) updated; static gate green; new behavior has
  unit + a real-DB integration test (primary selection + backfill correctness).

## Open questions (Phase-1 decision gate)

- **Designation shape** — `is_primary` boolean (+ partial-unique one-primary-per-dealer) vs a
  `primary | additional` enum. Lean: `is_primary` boolean (simplest; matches "one recipient").
- **Keep any descriptive role at all?** — e.g. a separate optional `billing` flag, or rely solely
  on `title` for "what they do." Lean: title-only for v1; no descriptive role.
- **Recipient tiebreak** — if somehow >1 primary (or 0) exists, the deterministic rule (lowest
  `dealer_contacts.id` among primaries; fallback to lowest-id emailable contact). Confirm.
- **Backfill rule** — each dealer's current priority-primary (staff>customer>prospect, lowest id)
  becomes the primary; confirm this matches the displayed contact so nothing visibly moves.

## Why now

A prod bug just exposed the incoherence; hotfix A unblocked sending but left the taxonomy messy
and the recipient a heuristic rather than an explicit choice. With 188 imported prospects now being
actively quoted, the "who is the contact" model should be honest and user-editable before more
data accretes against the confusing roles.
