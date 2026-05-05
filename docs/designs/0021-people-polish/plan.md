# People page polish — UX follow-ups from 0020

**Started:** 2026-05-05

The 0020 People page (`/admin/people`) ships the structural unification — one row per person, one Server Action surface, archived facets stay durable. This chunk closes the visible UX gaps that surfaced in the Phase 3 + Phase 4 evals plus the user's review of the live page: the "Team & contacts" subhead is redundant, coaches without app access look identical to coaches with sign-in, the Last sign-in column eats space for rows that can't have it, the Edit form silently splits the generated `displayName` instead of reading raw fields, archive is a one-click destructive op without context, and disabling app access bans the auth user without a confirm step. None are blockers; together they make the page feel like the canonical admin entry point instead of a v1 first cut. **Done =** a coach with no sign-in is visibly distinct from one with `app` access; the Last sign-in column hides when no row has it; Edit Person prefills from `firstName`/`lastName` (no `displayName.split` heuristic); the archive ✕ shows a per-row preview ("this archive will: drop coach role, ban sign-in"); toggling App access off in Edit Person triggers a confirm; auto-uncheck Admin/Coach when App access flips off; a search box + 3 role filter pills (`coach` / `admin` / `customer-side`) trim the table; and the redundant subhead is gone.

## Decisions

1. **Adopt TanStack Table as the admin-table foundation.** Initial recommendation was "stay native at current scale", but the user's call-out — sortable headers (Roles + Last sign-in are the obvious wants), pagination, and consistent muscle memory across People + Production + Lookups — flips the calculus. TanStack Table is headless (~14 KB gzipped, no theme conflicts with Tailwind), gives sortable column headers + pagination + faceted filtering for free, and pays back across at least three existing admin tables once adopted. Land it here on People; future polish chunks port Production + Lookups onto the same primitives.
2. **Drop the "Team & contacts" subhead entirely.** The page heading is "People" with a description; the card needs no second identity. Keep the count + Add Person button. Avoids the false promise of two segregated groups (the rows are interleaved on purpose).
3. ~~**`app` chip on the Roles column when `hasAppAccess === true`.**~~ **Reversed 2026-05-05 (Phase 2 review).** Going forward, everyone who needs app access has it by default (except dealer-side staff), so a chip that just says "this person has a sign-in" is redundant signal. The `coach`/`admin` chips already imply app access; rows with neither don't get one. Removed from `people-columns.tsx`.
10. **App access is implicit, not toggled.** Phase 2 also removes the `App access` checkbox from the Add/Edit Person dialog. Picking Admin or Coach implies a sign-in (the form sends `appAccess=1` to the Server Action automatically); leaving both unchecked is the dealer-side path (no sign-in). The convention now matches: "everyone who needs APP gets it by default, except dealer staff." This collapses three checkboxes to two and eliminates the inconsistent state where a coach has a role but no auth user (the Adam Godin legacy state stays editable — opening Edit on him with `coach` ticked will provision the missing auth user on save). The reverse transition (un-tick all roles on a person who currently has app access) takes the existing `updatePerson` ban path, which Phase 3's confirm dialog will guard.
4. **Auto-clear role checkboxes when App access flips off.** Two-line `useEffect` keeping React state honest; the server already coerces, but the UI was misleading. Fixes Codex Phase 3 follow-up.
5. **Confirm dialog when an Edit Person submission would ban an existing auth user.** `confirm()` with copy "Disable app access for {name}? Their sign-in account will be banned. Their team-member roles will be cleared. The contact record stays." Skip when `appAccess` was already off (no-op transition).
6. **Per-row archive preview message.** The current `confirm()` is generic. New: build the message from the actual facets — "This archive will: drop {coach role | dealer link to X | …} {and ban sign-in for {email}}. The contact record stays." Tells the admin exactly what's about to disappear.
7. **Hide `Last sign-in` column when *no* visible row has app access.** Conditional column, not row-level "—". When at least one row has app access, the column appears for all of them (maintains alignment); when none do, drop it. Trade-off: column appears/disappears as filters change. Acceptable.
8. **Search + filter pills, hand-rolled.** Single textbox (case-insensitive substring match across `displayName`, `email`, dealer names); three filter pills (`Coach`, `Admin`, `Customer-side`). Each pill toggles a boolean; the filter is the AND of all active pills + the search match. Empty state when filters return nothing.
9. **Expose raw `firstName`/`lastName` on `AdminPersonRow`.** Drop the `displayName.split` heuristic in `PersonForm`. The query reads them already (lines 27-28 of `loadAdminPeople`); the type just doesn't surface them. Trivial.

## Progress Tracker

| Phase | Status | Commit |
|-------|--------|--------|
| 1: TanStack Table foundation on `/admin/people` (sortable headers + pagination) | Done | d0c6f04 |
| 2: Field exposure + drop chrome + App-access toggle removal | Done | d0c6f04 |
| 3: Confirm dialogs (disable app access, per-row archive preview) + auto-uncheck on App-access flip | In Progress | aab1755 (confirm + unban) |
| 4: Search + role filter pills (TanStack global filter + faceted filters) | Pending | - |
| 5: Verification | Pending | - |

## Code Anchors

| New code | Anchor (`path:line`) | Why this anchor |
|----------|---------------------|-----------------|
| `@tanstack/react-table` dependency + `src/components/ui/data-table.tsx` (small wrapper) | `src/components/ui/dialog.tsx:1` | Same `src/components/ui/` layer as the existing in-house Dialog wrapper. Headless tables get a thin re-usable wrapper that exposes `<DataTable columns={...} data={...} />` plus header-sort + pagination controls; the wrapper is reused on Production and Lookups in future polish chunks. |
| `src/features/people/people-columns.tsx` (column defs) | `src/features/people/people-admin.tsx:80-95` (current static `<thead>` rows) | New file, same layer as the existing component. Column definitions become the source of truth for header label, accessor, sort fn, and conditional visibility (e.g. `Last sign-in` shown only when `hasAppAccess` is in the population). |
| `people-admin.tsx` rewritten as a `<DataTable>` consumer | `src/features/people/people-admin.tsx:1-100` (existing component) | Same file; converts from hand-rolled `<table>` to `<DataTable columns={peopleColumns} data={visiblePeople} />`. Add/Edit/Archive dialog state stays where it is. |
| `AdminPersonRow.firstName` + `.lastName` (new fields) | `src/features/people/queries.ts:34` (existing `AdminPersonRow` type + the query already SELECTs these on line 53) | Same module; one type extension + one mapping line. |
| `PersonForm` prefill from raw `firstName`/`lastName` | `src/features/people/people-admin.tsx:251-257` (current `displayName.split` heuristic — what we're replacing) | Same file, same component. Direct read of the new fields. |
| `app` chip on the Roles column | `src/features/people/people-admin.tsx:128-150` (existing roles-chip block) | Same chip styling; appears in the column-cell renderer in the new column-defs file. |
| Subhead drop | `src/features/people/people-admin.tsx:71-77` (current "Team & contacts" h2 + count) | Replace the h2 + p with just the count + Add Person button. (The DataTable's pagination controls below the table fill the layout role the subhead was occupying.) |
| `Last sign-in` column visibility | TanStack Table's `getInitialState().columnVisibility` + a `useMemo` that flips the `lastSignInAt` column on when `data.some(p => p.hasAppAccess)` | Built into the library — set once in column-def init; no per-cell guard scattered through JSX. |
| Header-sort on `Roles` column | TanStack `sortingFn` per column. For `roles` we sort by a derived rank: `admin > coach > none` (admin chip first), then `displayName` ASC as tiebreak. | Roles is the column the user explicitly called out; the rank function is one closure inside the column def. |
| Pagination | TanStack's `getPaginationRowModel()` + `<DataTable>` controls. Default page size 25; `[10, 25, 50, 100]` selector. | Library-provided; the wrapper renders Prev/Next + page indicator + page-size dropdown. |
| `useEffect` auto-uncheck on App-access flip | `src/features/people/people-admin.tsx:266-272` (existing `setAppAccess` + role checkbox state) | Inline effect inside `PersonForm`; matches the existing local-state pattern. |
| Confirm-on-disable-app-access | `src/features/people/people-admin.tsx:298-321` (existing `submit` function) | Insert pre-submit guard; keep the same `confirm()` call shape used by `onArchive`. |
| Per-row archive preview message | `src/features/people/people-admin.tsx:105-121` (existing `onArchive` function with hard-coded message) | Build the message from `person.roles` + `person.dealerLinks` + `person.hasAppAccess` and feed into the existing `confirm()` call. |
| Search + filter pills | TanStack `globalFilter` (single string across `displayName`, `email`, dealer names) + `columnFilters` for the `Roles` and `Dealer-side` faceted filters | Library-built; the input + pills are local React state that calls `table.setGlobalFilter` / `table.setColumnFilters`. |
| Vitest for `firstName`/`lastName` exposure | `src/features/people/queries.test.ts:1` | Add one case to the existing test file; the mock already returns these fields. |

**Conventions referenced:**
- `docs/wiki/lifecycle.md` — the lifecycle helper landed in 0020 Phase 3 (`active` / `banned` / `inactive`); this chunk doesn't change it but the archive-confirm message draws on the same facet model.
- `docs/wiki/auth.md` — toggling App access off is documented as banning the auth user via Supabase soft-delete idiom; the new confirm dialog should mirror that wording.

**Overall Progress:** 40% (2/5 phases complete)

**Note:**
- Phases 2–4 are `people-admin.tsx`-local work plus the column-defs file. Phase 1 introduces a project-wide primitive (`<DataTable>`) that future polish chunks can reuse on Production + Lookups.
- The polish doesn't change any actions' contracts — `createPerson` / `updatePerson` / `archivePerson` / `adoptOrphanAuthUser` stay as 0020 left them.

### Phase 1: TanStack Table foundation on `/admin/people`

- [x] `pnpm add @tanstack/react-table` — `8.21.3`, single dep, no peer additions.
- [x] `src/components/ui/data-table.tsx` — wrapper exposing `<DataTable columns data />` plus pagination controls (`← Prev` / `Next →` / page-indicator / page-size dropdown `[10, 25, 50, 100]`). Built on `useReactTable({ getCoreRowModel, getSortedRowModel, getFilteredRowModel, getPaginationRowModel })`. Header cells render a sort indicator (`↕` / `↑` / `↓`) when `enableSorting: true`. Hoisted `globalFilter` + `columnFilters` props so consumers (Phase 4) can wire their own search/pill UI without re-implementing the table chrome. ESLint `react-hooks/incompatible-library` false positive disabled with a justification comment.
- [x] `src/features/people/people-columns.tsx` — column defs: `displayName` (sortable), `email` (sortable, em-dash when missing), `roles` (sortable by `roleRank` `admin > coach > app-only > none`; renderer composes `app` + role chips), `dealerLinks` (cell-only, sortable by count), `lastSignInAt` (sortable; conditional visibility), `status` (sortable; lifecycle-derived), `actions` (Edit + Archive buttons via `PeopleColumnActions` callbacks). The `lifecycle()` helper moved here so columns compute status without a round-trip through the consumer.
- [x] `lastSignInAt` column visibility — `useMemo(() => ({ lastSignInAt: people.some(p => p.hasAppAccess) }), [people])` passed as `columnVisibility`. Column hides for populations with no app-access rows.
- [x] Default sort: `displayName` ASC via `initialSorting={[{ id: 'displayName', desc: false }]}`.
- [x] `people-admin.tsx` rewritten — hand-rolled `<table>` removed; `<DataTable>` consumed; Edit dialog lifted to `PeopleAdmin` state (single dialog, driven by `editing: AdminPersonRow | null` instead of per-row `editOpen` booleans); archive driven by `buildPeopleColumns({ onEdit, onArchive })` callback.
- [x] Smoke (web-test): `/admin/people` 200; column headers all rendered with sort indicators (↕); clicking the `Roles` header reorders the rows (verified by row reshuffle). Pagination chrome rendered (`← Prev` / `Next →` / page-indicator `1 / N` / page-size dropdown). Screenshot at `/tmp/web-test-people-tanstack.png`.

### Phase 2: Field exposure + chip + drop chrome (page subtitle + card subhead)

- [x] `src/features/people/queries.ts` — add `firstName: string` and `lastName: string` to `AdminPersonRow`. The SELECT already pulls them; just add to the returned object on lines 173-185.
- [x] `src/features/people/people-admin.tsx:PersonForm` — replace `person?.displayName.split(...)` heuristic with direct `person?.firstName ?? ''` and `person?.lastName ?? ''`.
- [x] ~~`people-columns.tsx:roles` cell — render `app` chip when `row.original.hasAppAccess`.~~ **Reversed in Phase 2 review** — the chip was redundant once "everyone who needs app has it" became the default. Removed. `roleRank` simplified to admin (0) → coach (1) → nothing (2).
- [x] `src/app/(app)/admin/people/page.tsx` — drop the four-sentence subtitle paragraph. The h1 "People" + the count + the `+ Add Person` button + the dialog's self-describing checkboxes already carry the story; the prose was admin-facing documentation that doesn't earn its real-estate on every visit.
- [x] `src/features/people/people-admin.tsx` — drop the "Team & contacts" h2 + paragraph. Keep the count + Add Person button as the only header content of the card. *(Landed in Phase 1 during the DataTable rewrite.)*
- [x] `src/features/people/people-admin.tsx:PersonForm` — drop the `App access` checkbox. Add a one-line note above the role checkboxes ("Picking a role grants a sign-in at the email above. Leave both unchecked for dealer-side contacts."). Derive `const wantsAppAccess = admin || coach`; remove the `disabled={!appAccess}` guards on the Admin/Coach checkboxes; submit handler sends `fd.set('appAccess', '1')` when `wantsAppAccess`. Update validation copy to "Email is required for Admin or Coach roles." Update Add Person dialog description to "Adds a contact. Picking Admin or Coach also creates a sign-in at this email." Server Action contract unchanged. The reverse transition (existing app-access user with all roles unticked) flows through `updatePerson`'s existing `!appAccess && current.userId != null` ban path — Phase 3's confirm dialog adds the guardrail.
- [x] Vitest: extend `src/features/people/queries.test.ts` to assert `firstName` + `lastName` are present on `AdminPersonRow`.
- [x] Smoke (web-test): `goto /admin/people`; expect heading "People" with **no** subtitle paragraph, the card with **no** "Team & contacts" subhead, `+ Add Person` button. ~~At least one row's Roles column shows the `app` chip alongside `coach` or `admin`.~~ Last-sign-in column is visible (there's at least one app-access user). Verified 2026-05-05.

### Phase 3: Confirm dialogs

- [ ] ~~`src/features/people/people-admin.tsx:PersonForm` — `useEffect(...)` auto-uncheck role boxes on App-access flip.~~ **Obsolete after Phase 2 review** — the `appAccess` checkbox no longer exists; the React/UI disagreement it was guarding against can't happen.
- [x] `src/features/people/people-admin.tsx:PersonForm` — pre-submit guard: when `mode === 'edit' && person?.hasAppAccess && !wantsAppAccess`, `window.confirm("Saving with no roles will end app access for {name} and ban their sign-in account. The contact record stays. Continue?")`; abort on cancel. Pulled forward from Phase 3 after Adam Godin got accidentally banned during Phase 2 review.
- [x] `src/features/people/actions.ts:updatePerson` — add unban-on-Save in the `appAccess && current.userId != null` branch (`auth.admin.updateUserById(userId, { ban_duration: 'none' })` — idempotent on already-active users). This is the restore path: an admin re-ticking a role on a previously-banned person now lifts the ban. **Pulled forward from Phase 3** because without it there's no in-app way to reverse an accidental ban — the user has to drop into a script or the Supabase dashboard. Surfaced after Adam Godin needed a manual restore.
- [x] `people-admin.tsx:archive` — extracted `buildArchiveConfirmMessage(person)` that composes from facets (`person.roles` + `person.dealerLinks` + `person.hasAppAccess`/`email`). E.g. `This archive will: drop coach role, end relationship with Trevors Nissan (customer), and ban sign-in for adam.godin@gmail.com. The contact record stays. Continue?` Falls back to a "nothing to remove" message for orphan contacts. Anchor lives in `people-admin.tsx` (where `archive()` is defined) rather than `people-columns.tsx` since `actions.onArchive` is just a callback pointer.
- [x] Smoke: `window.confirm` dialogs not driveable by the browse-tool — manual-visual confirmation deferred to per-developer testing; behavior covered by the message-builder pure function (no dialog framework involved).

### Phase 4: Search + role filter pills (TanStack-native)

- [ ] `src/features/people/people-admin.tsx:PeopleAdmin` — `useState` for `globalFilter: string` and `columnFilters: ColumnFiltersState`. Wire to `table.setGlobalFilter` / `table.setColumnFilters` (both API'd by TanStack).
- [ ] Custom `globalFilterFn` in `<DataTable>` wrapper: case-insensitive substring across `displayName`, `email`, `dealerLinks[].dealerName`. Default TanStack global-filter is per-column; we need cross-column.
- [ ] Render: text `<input>` placeholder="Search by name, email, or dealer…" + three pill buttons (`Coach`, `Admin`, `Customer-side`). Pills are `aria-pressed` toggles that flip a `columnFilters` entry on the relevant column (`roles` / `dealerLinks`).
- [ ] `Coach` ⇒ `columnFilter on 'roles' { value: ['coach'] }`; `Admin` ⇒ `{ value: ['admin'] }`; `Customer-side` ⇒ `columnFilter on 'dealerLinks' { mode: 'has-customer' }`. Filter functions live in the column defs.
- [ ] Empty-state row when `table.getRowModel().rows.length === 0`: `No people match.` + a `Clear filters` button (resets both `globalFilter` and `columnFilters`).
- [ ] Smoke (web-test): `goto /admin/people`; type "shannon" in the search box; expect 1 visible row. Click `Coach` pill; only coach rows visible. Clear search; click `Customer-side`; only rows with a customer dealer link.

### Phase 5: Verification

- [ ] `pnpm tsc --noEmit` clean.
- [ ] `pnpm test` clean (the new vitest case from Phase 1 passes).
- [ ] `pnpm lint` clean (no new warnings; pre-existing 4 stay).
- [ ] /eval against `0021-people-polish/plan.md`.
- [ ] Smoke (web-test): all of Phase 1 / Phase 3 driveable checks pass; Phase 2 dialogs captured as visual screenshots.

## Out of scope

- **TanStack Table.** Defer; native suffices at current scale.
- **Bulk actions.** No multi-select / bulk archive in this chunk.
- **Column resize / reorder.** Out of scope.
- **CSV export of People.** Out of scope.
- **Password reset / auth recovery flows.** Out of scope.
- **Dealer-side filtering by specific dealer.** The "Customer-side" pill is the bucket; per-dealer filter would need a dropdown — defer to a future polish chunk if needed.
- **Sorting on column headers.** The query already sorts by `displayName` ASC; column-header sort is a TanStack-shaped capability and out of scope.
- **The Browns-VW data hygiene problem** (a dealership name as a person row from the legacy import). One-time data fix, not a UI change. Track separately.
