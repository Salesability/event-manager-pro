# Lists → Dealers (TanStack DataTable + Radix Form polish)

**Started:** 2026-05-07

## Progress Tracker

| Phase | Status | Commit |
|-------|--------|--------|
| 1: Rename + chrome simplify | Done | 539746f |
| 2: TanStack DataTable foundation on Dealers + route move to `/dealerships` | Done | 62de77d |
| 3: Radix Dialog + form swap (DealerForm) | Done | eadff5f |
| 4: Optional Radix Form adoption (decision tree) | Done | 0564cb2 |
| 5: Tests + smoke verification | Done | covered by Phase 1–4 evals |

After 0020 retired Sales Coaches, `/lists` collapsed to a one-section "Manage Lists" page that just shows dealerships — but kept all the multi-section chrome (umbrella h1, explanatory subtitle linking to `/admin/people`, redundant `🏢 Dealerships 26` ListCard header). The screenshot the user shared makes the redundancy obvious: title, subtitle, and section header all say the same thing. This chunk renames the page to "Dealers" (since dealers/companies *are* the page now) and migrates it onto the same toolbar + TanStack DataTable + Radix Dialog pattern that 0021 + 0024 established on `/admin/people`. End state: visiting `/dealerships` (route moved from `/lists` in Phase 2) shows a single h1 "Dealers", a toolbar with `N dealers` count + search box + `+ Add Dealer`, a sortable/searchable table of dealerships, and an Edit/Add dialog that uses the same Radix Dialog wrapper as PersonForm. Out of scope: dealer schema changes; marketing-site rename. Phase 1 shipped at the original `/lists` route (commit `539746f`); Phase 2 moves the folder to `/dealerships` while rewriting the page.

## Code Anchors

For each new file or method below, the builder reads the anchor first and matches its shape. For modifications to an existing file, the anchor is the nearest sibling method in that same file.

| New code | Anchor (`path:line`) | Why this anchor |
|----------|---------------------|-----------------|
| `src/app/(app)/dealerships/page.tsx` (rewrite) | `src/app/(app)/admin/people/page.tsx:1` | Same layer (admin server-component page that loads + renders one client admin component); same `await requireRole(...)` + parallel `loadX()` shape. |
| `src/features/dealers/dealers-admin.tsx` (new client component) | `src/features/people/people-admin.tsx:108` | Same role: client wrapper that owns toolbar state (search, filters), renders `<DataTable>`, opens `Dialog.Root` for Add/Edit. Mirror the `useState`/`useTransition` + `archive(...)` + `useMemo(columns)` shape. |
| `src/features/dealers/dealers-columns.tsx` (new) | `src/features/people/people-columns.tsx:54` | Same `ColumnDef<Row>[]` builder, same `chipBase`/`fmtDateTime` style, same `actions: { onEdit, onArchive }` injection. |
| `src/features/dealers/dealer-form.tsx` (rewrite, moved from `app/(app)/dealerships/dealer-form.tsx`) | `src/features/people/people-admin.tsx:324` (`PersonForm`) | Same `useActionState`-driven form inside a `Dialog.Panel`; matches the input/label idiom + Cancel/Submit footer + toast wiring. The current `Field`-helper version isn't aligned with PersonForm. |
| `src/features/dealers/queries.ts` (new — re-exports `loadDealers` + `Dealer` type from `schedule/queries`, or moves them) | `src/features/schedule/queries.ts:161` | Existing dealer queries live in `schedule/` for historical reasons; co-locating with the new feature folder mirrors how `people` does it. **Open question:** move vs. re-export — see Open Questions. |
| `src/components/app/app-nav.tsx:11` (label edit) | `src/components/app/app-nav.tsx:13` | Same line, sibling tab; matches the existing `{ href, label }` shape. |
| Search/global-filter wiring | `src/features/people/people-admin.tsx:24` (`peopleGlobalFilterFn`) | Reuse the cross-column substring filter pattern; on Dealers it'll match name + contact name + email + phone. |
| Archive confirm message builder | `src/features/people/people-admin.tsx:287` (`buildArchiveConfirmMessage`) | Same composition pattern from row facets ("Archive X? Existing campaigns will keep their reference."). The current `confirm(...)` is one-liner; bring it into line. |

**Conventions referenced:**
- `CLAUDE.md` → "Mutations go through Server Actions" — `archiveDealer`/`createDealer`/`updateDealer` already in `src/features/schedule/actions.ts`; keep them there for this chunk (the actions don't move with the UI).
- `docs/wiki/auth.md` (RBAC) — page-level gate: `/lists` is staff-only today, no role tightening needed (admins/coaches both manage dealers). Keep the existing gate from `(app)/layout.tsx`.

**Overall Progress:** 100% (5/5 phases complete)

Phase 5's spec items are all covered by the four prior phase evals (`eval-2026-05-07-{1010,1040,1111,1129}.md`). Cross-walk:

| Phase 5 spec item | Covered by |
|-------------------|-----------|
| `pnpm test --run` 150/150 | All 4 evals |
| `pnpm tsc --noEmit` + `pnpm lint` clean | All 4 evals |
| h1 "Dealers" + search input + "+ Add Dealer" button | Phase 1 + 2 evals |
| Column headers Name/Contact/Email/Phone/Address + at least one row | Phase 2 eval |
| Add Dealer dialog full field set + Cancel/Add Dealer buttons | Phase 2 + 3 + 4 evals |
| Search "honda" narrows rows + Clear-filters affordance | Phase 2 eval (narrowing); Clear-filters affordance source-traced (no narrow→empty path exercised since 26-row dataset) |
| Name column header sort flip asc → desc | Phase 2 eval |
| Visual smoke screenshot vs. original chrome | Phase 1 + 2 + 4 screenshots in `/tmp/web-test-*` |
| "Manage Lists" nav label gone, "Dealers" present | Phase 1 + 2 evals |
| Edit row click → "Edit Dealer — <name>" with prefilled fields | **SKIPPED** — strict-mode collision (26 ambiguous `Edit` buttons), same as PersonForm has hit since 0023. Source-traced in Phase 3 eval: `dealers-admin.tsx:55` sets `editing=row.original` → DealerForm renders with `mode="edit" dealer={editing}` → defaultValues prefill from the Dealer row. |

**Note:**
- Each phase includes both implementation and a fast smoke check (typecheck + lint).
- Phase 4 is conditional — see decision tree.
- Phase 5 is the cross-phase verification, run via `web-test`.

## Open Questions

1. **Move `loadDealers` + `Dealer` type to `src/features/dealers/queries.ts`, or re-export from `schedule/queries.ts`?**
   - *Move:* cleaner long-term (dealers ≠ schedule); ~10 import sites to update across the codebase (campaigns, lookups, etc.).
   - *Re-export:* zero churn, but leaves the historical mis-placement.
   - **Working assumption:** re-export only — keep the move out of this chunk to avoid touching campaigns/lookups during a UI polish. File a follow-up if the friction shows up.

2. **Route: keep `/lists` or move to `/dealerships`?** *(decided 2026-05-07: move to `/dealerships`)*
   - Keep `/lists`: zero-disruption, nav label already shifting from "Manage Lists" → "Dealers".
   - Move to `/dealerships`: better URL hygiene; touches the nav href, four `revalidatePath('/lists')` call sites in `src/features/{schedule,people}/actions.ts`, and one assertion in `src/lib/supabase/middleware.test.ts`.
   - **Decision:** move to `/dealerships` as part of Phase 2 (the page rewrite already touches the file). No `/lists` → `/dealerships` redirect added — staff-only ~5 users will update muscle memory; if a bookmark complaint surfaces, add a one-line `redirect()` page at `src/app/(app)/dealerships/page.tsx` later.

3. **Adopt Radix Form here?** (Carry-forward from 0024 Phase 4.)
   - 0024's Parked note: "revisit alongside the 0016 booking-intake form so both forms' validation surfaces migrate in one pass." Same logic now applies to a third form joining the family.
   - *Yes:* adopt now → all three forms (PersonForm, DealerForm, future BookingForm) migrate together; one validation idiom across the app.
   - *No:* keep `useActionState` + toast → ship Phase 1–3 fast, defer Phase 4.
   - **Decision tree:** if Phase 1–3 ship clean and PersonForm needs no further changes, run Phase 4 in this chunk. If anything blocks, defer Phase 4 to its own chunk that migrates PersonForm + DealerForm + BookingForm together. Either way, don't migrate DealerForm alone.

4. **Filters on Dealers — what facets matter?**
   - PersonForm has Coach/Admin/Customer-side pills because role membership is a real query. Dealers are just companies — the facets candidates are `has-customer-contact` (any linked person whose link role is `customer`?), `has-staff-contact`, etc.
   - **Working assumption:** ship Phase 2 with search-only (no faceted pills). Add facets only if a concrete need surfaces during the smoke pass.

5. **Pagination?** PersonForm's table has it but the dataset (~26 dealers) doesn't need it. Keep pagination *enabled* (cheap, consistent with People) or drop it for this small list.
   - **Working assumption:** enable pagination at 50 rows/page — invisible at 26 rows, visible if/when the list grows.

## Phase Checklist

### Phase 1: Rename + chrome simplify

Goal: kill the dead chrome the screenshot called out. Visible win without touching data.

- [x] `src/app/(app)/dealerships/page.tsx`: drop the `<h1>Manage Lists</h1>` + the four-sentence subtitle linking to `/admin/people`.
- [x] `src/app/(app)/dealerships/page.tsx`: drop the `ListCard` wrapper + the `🏢 Dealerships 26` header — the page *is* the dealers page; the section header is redundant.
- [x] `src/app/(app)/dealerships/page.tsx`: rename the page header to a plain `<h1 className="font-display text-3xl text-navy">Dealers</h1>` (matches `/admin/people`'s style on `admin/people/page.tsx:17`).
- [x] Delete the `ListCard` + `EmptyState` helper components from the file (only used by this page).
- [x] `src/components/app/app-nav.tsx:11`: change `label: 'Manage Lists'` → `label: 'Dealers'`. Leave `href: '/lists'` (Open Question 2).
- [x] Update the inline comment at the top of the page — the "Sales Coaches retired in 0020" preamble can shrink to a one-liner pointing at the new structure.
- [x] `pnpm tsc --noEmit && pnpm lint` clean.

### Phase 2: TanStack DataTable foundation on Dealers + route move to `/dealerships`

Goal: replace the bare `<ul>`-of-`<li>` with the same DataTable that `/admin/people` uses, and move the route from `/lists` to `/dealerships` while the page is being rewritten anyway.

- [x] Create `src/features/dealers/dealers-columns.tsx` — anchor on `src/features/people/people-columns.tsx:54`. Columns: `name` (sortable), `contact` (composed `firstName + lastName`), `email` (sortable), `phone`, `address`, `actions`.
- [x] Create `src/features/dealers/dealers-admin.tsx` — anchor on `src/features/people/people-admin.tsx:108`. Owns: `globalFilter` state, `archive(dealer)` server-action wiring, `Dialog.Root` for Add/Edit, `<DataTable>` invocation with `initialSorting=[{id:'name',desc:false}]`.
- [x] Toolbar: `<input type="search">` (placeholder "Search by name, contact, or email…") + `+ Add Dealer` button on the right. Mirror `people-admin.tsx:183`.
- [x] Cross-column global filter fn in `dealers-admin.tsx` matching the `peopleGlobalFilterFn` shape (`people-admin.tsx:24`).
- [x] `git mv src/app/(app)/lists src/app/(app)/dealerships` — folder rename keeps `dealer-form.tsx` + `list-actions.tsx` co-located until Phase 3 reshapes them.
- [x] `src/app/(app)/dealerships/page.tsx` becomes a thin server component: `loadDealers()`, render `<DealersAdmin dealers={...} />`. Layout-level `(app)/layout.tsx` gate already covers staff-only access.
- [x] `src/components/app/app-nav.tsx:11`: change `href: '/lists'` → `href: '/dealerships'`. Label stays `'Dealers'`.
- [x] Update four `revalidatePath('/lists')` call sites: `src/features/schedule/actions.ts:129,254,286` + `src/features/people/actions.ts:97` → `/dealerships`.
- [x] Update `src/lib/supabase/middleware.test.ts:19` assertion: `isAdminPath('/lists')` → `isAdminPath('/dealerships')`.
- [x] Empty state with `Clear filters` action when filtered → no rows; otherwise plain "No dealers yet."
- [x] `pnpm tsc --noEmit && pnpm lint && pnpm test --run` clean.

### Phase 3: Radix Dialog + DealerForm rewrite

Goal: replace the current `app/(app)/dealerships/dealer-form.tsx` (custom `Field` helper + bare buttons; moved here in Phase 2) with a PersonForm-shaped form that uses the shared `Dialog` wrapper, the shared input class, and the shared toast wiring.

- [x] Create `src/features/dealers/dealer-form.tsx` — anchor on `PersonForm` at `src/features/people/people-admin.tsx:324`. Same `useActionState<State, FormData>` shape, same `useEffect` toast/router-refresh wiring, same `Cancel` + submit footer. Replaces the existing `src/app/(app)/dealerships/dealer-form.tsx` (moved in Phase 2).
- [x] Use the same `inputClass` constant pattern from `people-admin.tsx:58` (or factor into a `src/components/ui/form-classes.ts` if it starts to repeat — defer that decision until Phase 4).
- [x] Drop the bespoke `Field({label, htmlFor, required})` helper in favor of the People-style inline `<label className="flex flex-col gap-1 text-xs font-medium text-stone-600">…</label>` shape (matches `people-admin.tsx:449`).
- [x] Wire Add/Edit dialog from `dealers-admin.tsx` — `Dialog.Root` + `Dialog.Backdrop` + `Dialog.Panel` (anchor: `people-admin.tsx:254`). *(Already wired in Phase 2; this phase only swapped the import path.)*
- [x] Delete `src/app/(app)/dealerships/list-actions.tsx` (its `AddDealerButton` + `DealerRowActions` move into `dealers-admin.tsx` as inline behavior, just like `/admin/people`).
- [x] Update `archiveDealer`'s confirm message via the `buildArchiveConfirmMessage`-style facet composer (anchor: `people-admin.tsx:287`). Counts are not on `Dealer` today, so the message uses a static facet phrase (campaigns keep refs; contact links stay readable) with a comment pointing at the future enhancement when `loadDealers` denormalises them.
- [x] `pnpm tsc --noEmit && pnpm lint && pnpm test --run` clean.

### Phase 4: Radix Form adoption — decision-driven

**Decision gate before starting:** Re-read Open Question 3. If Phases 1–3 shipped clean and there's no concurrent work on PersonForm/booking intake, proceed. Otherwise mark this phase **Skipped** and file a carry-forward to migrate PersonForm + DealerForm + BookingForm together.

- [x] ~~If skipping~~ — Phase 4 ran (user said "do it" 2026-05-07).
- [x] Installed `@radix-ui/react-form@0.1.8`. Wrapped DealerForm fields in `<Form.Field>` with `<Form.Label>` + `<Form.Control asChild>` + `<Form.Message match="valueMissing">` on `name`. Added `<Form.Message match="typeMismatch">` on email.
- [x] Form still posts to `createDealer` / `updateDealer` Server Actions — `<Form.Root action={formAction}>` passes through to native form submission. Wire-format unchanged (`name`, `contactFirst`, `contactLast`, `contactEmail`, `contactPhone`, `address`, `id`).
- [x] In the same pass, retrofited `PersonForm`'s standard text fields (firstName, lastName, email, phone) to use `<Form.Field>` + `<Form.Message>`. Custom controls (Radix Checkbox roles fieldset, Combobox + Select dealer picker) stay outside Radix Form — they don't have `valueMissing` semantics that Radix Form's match clauses operate on. Native + Radix Form coexist inside the same `<Form.Root>`.
- [x] `pnpm tsc --noEmit && pnpm lint && pnpm test --run` clean.

### Phase 5: Tests + smoke verification

- [x] `pnpm test --run` — full suite (150/150 across all four phase evals).
- [x] `pnpm tsc --noEmit && pnpm lint` clean (all four evals).
- [x] Smoke (web-test): h1 "Dealers" + search input + "+ Add Dealer" + column headers (Phase 1 + 2 evals).
- [x] Smoke (web-test): Add Dealer dialog full field set + Cancel/Add Dealer (Phase 2 + 3 + 4 evals).
- [x] ~~Edit row dialog~~ — strict-mode collision (26 ambiguous `Edit` buttons). Source-traced in Phase 3 eval; structurally identical to PersonForm's Edit path which ships fine.
- [x] Smoke (web-test): search "honda" narrows rows (Phase 2 eval).
- [x] Smoke (web-test): Name sort flip (Phase 2 eval).
- [x] Visual smoke screenshots: `/tmp/web-test-lists-0027-phase1.png`, `/tmp/web-test-dealerships-0027-phase2.png`, `/tmp/web-test-dealerships-0027-phase3-add-dialog.png`, `/tmp/web-test-person-add-0027-phase4.png`, `/tmp/web-test-dealer-blur-required.png`.
- [x] "Manage Lists" gone, "Dealers" present in nav (Phase 1 + 2 evals).
