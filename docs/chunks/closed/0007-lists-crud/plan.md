# Lists CRUD — 2026-04-30

Follow-up to `docs/chunks/closed/0006-port-views/plan.md`. The Lists view currently renders dealers + coaches read-only; the legacy UI (`deprecated/index.html` lines 449–486 modals, 1273–1437 handlers) exposed `+ Add Client`, `+ Add Coach`, per-row `Edit`, and per-row delete (red ✕) on each card. This chunk wires those affordances through to Postgres so the Lists page reaches CRUD parity. Done = `/lists` lets a signed-in user create, edit, and (soft-)archive a dealer or a coach with the same five / five form fields legacy used; `loadDealers` is extended to surface the primary dealer contact (name + email + phone) so the list rows match legacy density; and no other view (Calendar, Production) regresses.

Scope is the Lists page only — sub-plan 5.1 of the migration tracker. Booking-modal CRUD on the Calendar (5.2) and quote/contract/invoice/payment flows (Phase 7) stay deferred. Mutations land as Server Actions (per `CLAUDE.md`); deletes are soft via `archived_at` to preserve referential integrity with `campaigns`.

**Legacy → new-schema mapping (the non-obvious bit).** Legacy stored a Client row as `[id, name, contact, phone, email, address]` — five fields collapsed onto one Sheets row. The new schema decomposes that into four tables: `dealers(name, address)` + `dealer_contacts(role, dealerId, contactId)` + `contacts(firstName, lastName)` + `contact_identifiers(kind, value, isPrimary)`. So a dealer create is a 4-table transactional write, not a single insert; "Contact Person" splits into `firstName` + `lastName` (both `NOT NULL` in `contacts`), so the form has two name inputs not one.

## Progress Tracker

| Phase | Status | Commit |
|-------|--------|--------|
| 1: UI primitives setup (Sonner + Headless UI wrappers) | Done | `60e80f8` |
| 2: Server actions module + dealer CRUD | Done | `942ba69` |
| 3: Coach CRUD (contact + role + identifiers) | Done | `2bd779e` |
| 4: List page wiring (modals, forms, toast-driven UX) | Done | `1b6358e` |
| 5: Verification (tsc + vitest + dev-server smoke) | Done (one item — edit dealer name — visually verified; UI polish + remaining smoke deferred) | - |

## Code Anchors

For each new file or method below, the builder reads the anchor first and matches its shape (length, error handling, naming, query style). For modifications to an existing file, the anchor is the nearest sibling method in that same file.

| New code | Anchor (`path:line`) | Why this anchor |
|----------|---------------------|-----------------|
| `src/components/ui/toaster.tsx` (`'use client'`: thin wrapper around Sonner's `<Toaster/>` with cream/navy classNames; re-exports `toast`) | `src/components/app/app-header.tsx:1` | Sibling shared client component under `src/components/`; same `'use client'` + Tailwind class shape. |
| `src/components/ui/dialog.tsx` (`'use client'`: themed wrappers around Headless UI's `Dialog` / `DialogBackdrop` / `DialogPanel` / `DialogTitle` / `Description` exposed under a `Dialog.*` namespace) | `src/components/app/app-header.tsx:1` | Sibling shared client component; same shape (one file, several small named exports). |
| Wrap children with `<ToasterProvider/>` (Provider + Viewport) in `src/app/(app)/layout.tsx` after `<AppHeader/>` | `src/app/(app)/layout.tsx:11` | Modify in place — same layout already mounts `<AppHeader/>` once for every app route. |
| `src/features/schedule/actions.ts` (`'use server'`: `createDealer`, `updateDealer`, `archiveDealer`, `createCoach`, `updateCoach`, `archiveCoach`) | `src/features/auth/actions.ts:1` | The only existing `'use server'` module — same FormData-in shape. Departs from auth's `redirect(?error=)` pattern and instead **returns** `{ ok: true } \| { error: string }` so client components can render the result via `useActionState` + `toast`. |
| Modify `loadDealers()` in `src/features/schedule/queries.ts:64` — extend return shape with `primaryContactName`, `primaryEmail`, `primaryPhone` (joined through `dealer_contacts` → `contacts` → `contact_identifiers`, mirroring the existing `loadCoaches` identifier-merge) | `src/features/schedule/queries.ts:78` (`loadCoaches`) | Same file already does the contact + primary-identifier merge for coaches; the dealer variant is the same shape with one extra junction (`dealer_contacts`). |
| `loadDealer(id)` added to `src/features/schedule/queries.ts` (single-row fetch for edit-form pre-fill, includes primary dealer-contact) | `src/features/schedule/queries.ts:64` (`loadDealers`) | Sibling query — single-row variant of the extended `loadDealers`. |
| `loadCoach(id)` added to `src/features/schedule/queries.ts` (single-row coach + primary identifiers) | `src/features/schedule/queries.ts:78` (`loadCoaches`) | Sibling query — reuse the same join + identifier-merge idiom, return one row. |
| Modify `src/app/(app)/lists/page.tsx` — wire Add buttons in card headers, Edit + ✕ buttons per row, render `<ListActions/>` slots | `src/app/(app)/lists/page.tsx:74` (`ListCard`) | The file itself is its own anchor — extend the existing `ListCard` / row markup rather than redesigning. |
| `src/app/(app)/lists/list-actions.tsx` (`'use client'`: opens modal, holds `useTransition` for delete confirm + dispatch to server actions) | `src/app/(app)/production/production-filters.tsx:1` | Only existing client component — same `'use client'` + `useTransition` + `useRouter().refresh()` pattern. |
| `src/app/(app)/lists/dealer-form.tsx` (`'use client'`: form posting to `createDealer` / `updateDealer` server action) | `src/app/login/page.tsx:50` | Existing `<form action={serverAction}>` with named inputs and a hidden field — same shape applies. |
| `src/app/(app)/lists/coach-form.tsx` (`'use client'`: name + email + phone + specialty fields → `createCoach` / `updateCoach`) | `src/app/login/page.tsx:50` | Same form-action pattern; multi-field variant. |

**Conventions referenced:**
- `docs/wiki/conventions.md` / `CLAUDE.md` — Mutations go through Server Actions, never route handlers. `'use server'` modules live in `src/features/<area>/actions.ts`.
- `docs/wiki/data-model.md` — Coaches are `contacts` rows joined to `team_member_roles(role='coach')`. Dealers are `dealers` rows linked to `contacts` via `dealer_contacts`. Primary email/phone are rows in `contact_identifiers` with `is_primary = true` and `archived_at IS NULL`. The `contact_identifiers_contact_kind_primary_unique` partial index enforces one primary per kind, so swapping primary is "archive old → insert new" inside one transaction.
- `docs/wiki/data-model.md` / `src/lib/db/schema/_columns.ts` — Soft-delete via `archived_at` (the `archivable` mixin). Hard-delete is reserved for cases with no FK fanout; dealers and coach roles both have FKs from `campaigns`, so use soft-delete.
- `docs/wiki/auth.md` — Server actions read the current user via `getUser()` (`src/lib/supabase/session.ts`) to populate `created_by_id` / `updated_by_id`. Unauthenticated calls should redirect to `/login`.

**Decisions:**
- The legacy "Contact Person" is an employee of the dealership → `dealer_contact_role = 'staff'`. Use that role for every dealer-contact row this chunk creates.
- ~~`loadDealers()` filters dealer-contacts on `role='staff'`~~ → relaxed during Phase 2: the importer wrote legacy "Contact Person" rows as `role='customer'`, so a strict `staff`-only filter would render no contact info on every already-imported dealer. Read path in `fetchPrimaryDealerContacts` accepts any active role and prefers `staff > customer > prospect` when multiple exist; new writes still use `staff` per the bullet above. Re-mapping the importer's existing rows to `'staff'` is a one-line backfill and is deferred until we cut over.
- Form uses two name inputs (First, Last), not a single "Contact Person" string. Why: STAR-aligned `contacts` row has `first_name` + `last_name` both `NOT NULL` with a generated `display_name` (`docs/wiki/data-model.md:131`). The wiki explicitly notes the legacy single-row flattening was abandoned (`data-model.md:246`).
- UI primitives: ~~adopt Base UI for Toast + Dialog~~ → switched mid-Phase 1. Toast = [`sonner`](https://sonner.emilkowal.ski/) (single `<Toaster/>` component, dead-simple `toast.success(...)` / `toast.error(...)` API). Dialog = [`@headlessui/react`](https://headlessui.com) (Tailwind Labs, pairs naturally with our Tailwind stack). Why the swap: Base UI's `useToastManager()` re-subscribes to the `toasts` array unconditionally ([mui/base-ui#4234](https://github.com/mui/base-ui/issues/4234)), which makes any consumer that puts the manager in a `useEffect`/`useMemo` dep array infinite-loop. Workarounds exist (destructure stable methods) but the API ergonomics and bug history were enough to walk away. Tooltip (calendar ribbons) and Select-with-filters are deferred — Headless UI doesn't ship Tooltip, so when we need it we'll add Floating UI directly or Radix Tooltip à la carte.
- Server actions return `{ ok: true } | { error: string }` rather than redirecting; client forms wrap with React 19's `useActionState` and call Sonner's `toast.success(...)` / `toast.error(...)` based on the returned state. The `auth/actions.ts` `?error=` pattern stays as-is for now (login lives outside the `(app)` group and pre-dates the toast infra) — revisit if/when login moves in.

**Overall Progress:** 100% (5/5 phases complete) — shipped functionally; UI polish and remaining smoke checklist explicitly deferred. Reopen if Phase 5.2 (Campaign CRUD) work surfaces a regression.

**Note:**
- All deletes are soft (`archived_at = now()`) — `loadDealers` / `loadCoaches` already filter on `isNull(archivedAt)`.
- Coach create is the only multi-row write: `contacts` + `team_member_roles` + up to two `contact_identifiers`. Wrap in a single Drizzle transaction.
- After every mutation, call `revalidatePath('/lists')` (and `'/calendar'`, `'/production'` where relevant — coach rename should reflect on existing campaign rows).
- No new tests required for the views; add a unit test only if a non-trivial pure helper (e.g. identifier-diff for coach edits) gets factored out.

### Phase Checklist

#### Phase 1: UI primitives setup ✅ shipped
- [x] `pnpm add sonner @headlessui/react` (production deps). _(Tried `@base-ui/react` first; backed out — see Decisions.)_
- [x] `src/components/ui/toaster.tsx` (`'use client'`): thin wrapper around Sonner's `<Toaster/>` configured with `position="top-right"`, `richColors`, cream/navy classNames; re-exports `toast` (the canonical Sonner dispatcher).
- [x] `src/components/ui/dialog.tsx` (`'use client'`): themed wrappers around Headless UI's `Dialog` / `DialogBackdrop` / `DialogPanel` / `DialogTitle` / `Description` plus a `Close` re-export of `CloseButton`. API surface kept namespace-style (`Dialog.Root`, `Dialog.Backdrop`, `Dialog.Panel`, `Dialog.Title`, `Dialog.Description`, `Dialog.Close`) so Phase 4 forms have a consistent import.
- [x] Mount `<Toaster/>` once inside `(app)/layout.tsx` after `<main>` (Sonner needs no provider — single component manages its own portal).
- [~] Visual smoke deferred to Phase 4 forms — tsc clean + dev-server compile clean is the wired-up signal we have for now.

#### Phase 2: Server actions module + dealer CRUD ✅ shipped
- [x] `src/features/schedule/actions.ts` (`'use server'`) — exports `createDealer`, `updateDealer`, `archiveDealer`. All three return `{ ok: true } | { error: string }`. `requireUserId()` redirects to `/login` if `getUser()` returns null.
- [x] `loadDealers()` extended in `queries.ts` to return primary contact via two helper queries (`fetchPrimaryDealerContacts` joins `dealer_contacts` → `contacts` and prioritizes role `staff > customer > prospect`; `fetchPrimaryIdentifiers` merges primary email/phone). `Dealer` type now carries `contactId`, `contactFirstName`, `contactLastName`, `primaryEmail`, `primaryPhone`. Lists view renders `${contact} · ${phone}` line plus email in `text-status-blue`.
- [x] `loadDealer(id: number)` — single-row variant for edit-form pre-fill.
- [x] `createDealer(formData)` — transactional. Inserts `dealers` (publicId via `randomBytes(9).base64url`, matching `import-from-sheets.ts`). If any contact field present, inserts `contacts` + `dealer_contacts(role='staff', source='admin')` + primary `contact_identifiers` for non-empty email/phone. Audit columns populated from session user.
- [x] `updateDealer(formData)` — transactional. Updates `dealers.name` / `address`; finds the active `dealer_contacts(role='staff')` link (creates one on demand when contact name is provided); updates `contacts.firstName/lastName`; calls `swapPrimaryIdentifier()` for email + phone — archives the existing primary then inserts the new one (same transaction → partial-index-safe).
- [x] `archiveDealer(formData)` — soft-archive only the `dealers` row.
- [x] Validation: `name` non-empty, `id` parses to positive int, email matches a basic regex when non-empty, contact first+last must both be present if any contact field is set (avoids breaking the `contacts.first_name`/`last_name` NOT NULL invariant).
- [x] Each action calls `revalidatePath('/lists')` + `revalidatePath('/production')` before returning.

#### Phase 3: Coach CRUD (contact + role + identifiers) ✅ shipped
- [x] `loadCoach(id)` in `queries.ts` — single-row variant, joins `contacts` + active `team_member_roles(role='coach')`, merges primary email/phone via `fetchPrimaryIdentifiers`.
- [x] `createCoach(formData)` — transactional. Inserts a fresh `contacts` row, then `team_member_roles(role='coach')` (with optional specialty), then primary `contact_identifiers` for non-empty email/phone.
- [x] `updateCoach(formData)` — transactional. Looks up the active coach record, updates `contacts.firstName/lastName`, updates `team_member_roles.specialty`, calls `swapPrimaryIdentifier()` for email + phone (same archive-then-insert dance as the dealer flow).
- [x] `archiveCoach(formData)` — soft-archives only the `team_member_roles(role='coach')` row. Leaves the `contacts` row + identifiers intact since the same person may still be a dealer contact / portal user.
- [x] Each coach action calls `revalidatePath('/lists')` + `'/calendar'` + `'/production'` (coach name surfaces on calendar ribbons and production rows).
- [x] Same `{ ok } | { error }` contract as the dealer actions.

**Constraint to watch:** `team_member_roles_contact_id_role_unique` is a regular UNIQUE on `(contactId, role)` — not partial. After `archiveCoach` runs, a future `createCoach` for the *same contact* would still insert a *new contacts row* (we never look up by name), so this isn't a hot path. Only matters if someone wires a "reactivate" flow later — at that point, swap the index to a partial one (`WHERE archived_at IS NULL`) or have the reactivate path clear `archived_at` instead of inserting.

#### Phase 4: List page wiring (modals, forms, toast-driven UX) ✅ shipped
- [x] `+ Add Client` button in the Dealerships card header (`AddDealerButton`); opens `<DealerForm mode="create"/>` in a Headless UI dialog.
- [x] `+ Add Coach` in the Sales Coaches card header (`AddCoachButton`); opens `<CoachForm mode="create"/>`.
- [x] Per dealer row: `Edit` opens `<DealerForm mode="edit" dealer={...}/>`; ✕ runs a native `confirm()` then dispatches `archiveDealer` via `useTransition`.
- [x] Per coach row: same `Edit` / ✕ pair wired to `<CoachForm mode="edit" coach={...}/>` / `archiveCoach`.
- [x] `src/app/(app)/lists/list-actions.tsx` exports `<AddDealerButton>`, `<DealerRowActions>`, `<AddCoachButton>`, `<CoachRowActions>` — each holds its own `Dialog.Root` open-state. Forms are conditionally mounted (`{open && <Form…>}`) so each open re-mounts a fresh `useActionState`.
- [x] `dealer-form.tsx` (Name, Contact First/Last, Phone, Email, Address) and `coach-form.tsx` (First, Last, Email, Phone, Specialty). Both use `useActionState(async (_p, fd) => action(fd), null)`. Hidden `<input name="id">` for edit variant. `Cancel` button calls `onSuccess()` to close without submit.
- [x] `state.ok` → `toast.success('… saved' | '… added')` + close dialog. `state.error` → `toast.error(state.error)`, dialog stays open. Server actions handle revalidation.
- [x] Confirm-delete uses native `confirm()` per plan; toast on result.
- [x] Empty-state copy now includes hint pointing at the Add buttons.

**Out of scope for this chunk:** the legacy header had a global "🏢 Add Client / 🎯 Add Coach" pair (lines 276–277) that opened the same modals from any tab. New app's `app-header.tsx` doesn't expose those — defer until we decide whether to bring them back.

#### Phase 5: Verification
- [x] `pnpm tsc --noEmit` clean.
- [x] `pnpm test` clean (5 → 18 tests; new `validators.test.ts` covers `EMAIL_RE` / `field` / `parseId` / `validateContactInputs`).
- [x] `pnpm dev` boot + `/lists` compile clean (no SSR errors; auth redirects to `/login` as expected on unauthenticated curl).
**Phase 5 finding — global email/phone uniqueness (`5fbf9f4`):** first visual run surfaced a 500 on `updateDealer`. Root cause: `contact_identifiers_kind_value_active_unique` is a *global* partial unique on `(kind, value) WHERE archived_at IS NULL`, so the same email cannot be active on two different `contacts` rows simultaneously. Fix: `swapPrimaryIdentifier()` now pre-checks for an active matching identifier on a different `contact_id` and throws an `IdentifierConflictError`; all four mutations (`createDealer`, `updateDealer`, `createCoach`, `updateCoach`) wrap their transaction in `toActionResult()` and return `{ error: 'That email address is already linked to another contact.' }` instead of throwing. Schema implication: a single human who is both a coach AND a dealer-staff contact must be modeled as **one** `contacts` row with **two** roles (`team_member_roles role='coach'` + `dealer_contacts role='staff'`); today's UI always inserts a fresh `contacts` row, so cross-role linking is a one-line SQL job until a contact-picker lands.

**Phase 5 finding — `updateDealer` was duplicating contacts (`1c2b4bf`):** the toast in `5fbf9f4` was masking the actual cause of the 500 we hit when *just editing a dealer name*. Sequence: `loadDealers` reads the dealer's contact via priority `staff > customer > prospect` (relaxed in Phase 2 to keep already-imported dealers visible). For a legacy-imported dealer the link is `role='customer'`. The form pre-fills with that contact's data; the user edits only the name and submits. `updateDealer`'s lookup was hardcoded to `role='staff'`, found nothing, and fell into the "create a new contact + new staff link" branch — duplicating the contact and triggering the email-uniqueness conflict. Fix: `updateDealer`'s lookup mirrors the read path's priority order (staff > customer > prospect) and updates whichever active link exists in place. The link's role is left alone (legacy `customer` rows aren't silently re-tagged). Only creates a new staff link when no active link exists at all.

- [ ] `pnpm dev` visual smoke (driver: human at the browser):
  - [ ] Add a dealer → green toast appears, modal closes, dealer shows up in the list with contact + email + phone rendered.
  - [ ] Submit dealer form with empty name → red toast with the validation message, modal stays open.
  - [ ] Edit a dealer name → green toast; reflects on `/lists` and on any campaign row that displays dealer name.
  - [ ] Archive a dealer → green toast; row drops from `/lists`; existing campaigns still render (FK preserved by soft-delete).
  - [ ] Add a coach with email + phone + specialty → green toast; appears on `/lists`; coach filter pills on `/calendar` include them.
  - [ ] Edit a coach's email → primary email row swaps; old identifier is archived (verify with a quick `select * from contact_identifiers where contact_id = ?`).
  - [ ] Archive a coach → green toast; drops from `/lists` and `/calendar` filter pills; their existing campaigns still render with the coach name on the ribbon.
- [ ] Update `docs/chunks/0004-port-migration/plan.md` (if present) to note Lists CRUD shipped, and append a one-liner to `docs/wiki/log.md`.
