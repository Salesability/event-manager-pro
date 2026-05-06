# PersonForm — migrate dialog + form primitives to Radix

**Started:** 2026-05-06

## Progress Tracker

| Phase | Status | Commit |
|-------|--------|--------|
| 1: Dependency + dialog wrapper swap (Headless UI → Radix Dialog) | Pending | - |
| 2: PersonForm Roles fieldset → Radix Checkbox (or RadioGroup) | Pending | - |
| 3: PersonForm Dealers section → Combobox (`cmdk`) + Radix Select for role | Pending | - |
| 4: Form-level field validation via Radix Form (or stay with toast — decide in plan) | Pending | - |
| 5: Tests + smoke verification | Pending | - |

The codebase is already on a headless component lib — `@headlessui/react` (Tailwind Labs' Headless UI), wired through `src/components/ui/dialog.tsx`. This chunk swaps that dependency for Radix Primitives and uses the swap as a pilot for richer form widgets (Combobox via `cmdk`, Radix Select, Radix Checkbox/RadioGroup, optional Radix Form). Pilot surface is the PersonForm dialog at `src/features/people/people-admin.tsx:294-523`. The win: a typeable/filterable dealer picker (Combobox) and consistent keyboard/a11y semantics across compound widgets, with a Radix-everywhere story for future forms (Production, Lookups, Booking intake) to follow. The cost: bundle shift from one headless lib to another (~similar size), one round of API change inside the existing `Dialog` wrapper, and a decision about whether the React 19 `useActionState` server-action pattern stays or yields to a form-state library.

## Code Anchors

For each new file or method below, the builder reads the anchor first and matches its shape (length, error handling, naming, query style). For modifications to an existing file, the anchor is the nearest sibling method in that same file.

| New code | Anchor (`path:line`) | Why this anchor |
|----------|---------------------|-----------------|
| Replace `src/components/ui/dialog.tsx` (Headless UI → Radix Dialog) | same file (in place) | Keep the public API surface — `Dialog.Root`, `Dialog.Backdrop`, `Dialog.Panel`, `Dialog.Title`, `Dialog.Description`, `Dialog.Close` — so call sites in `people-admin.tsx`, etc. don't change. Radix Dialog has a different tree (`Dialog.Root`, `Dialog.Trigger`, `Dialog.Portal`, `Dialog.Overlay`, `Dialog.Content`, `Dialog.Title`, `Dialog.Description`, `Dialog.Close`); the wrapper bridges the rename |
| Roles fieldset Checkbox (Phase 2) at `src/features/people/people-admin.tsx:437-456` | same file, the existing native `<input type="checkbox">` markup at lines 437-456 | One-to-one swap; preserves `name="roles"` form-data wiring (Radix Checkbox renders a hidden native input). Keep the existing label structure and Tailwind classes |
| Dealer Combobox (Phase 3) wrapper at `src/components/ui/combobox.tsx` (new file) | `src/components/ui/dialog.tsx` | Same wrapper pattern: third-party headless primitive + project Tailwind classes consolidated behind a stable API. Use `cmdk` (the Radix-adjacent command/combobox library) since Radix doesn't ship one |
| Dealer-link `role` Select (Phase 3) at `src/features/people/people-admin.tsx:484-496` | same file, the existing native `<select>` markup at lines 484-496 | Mirrors the Combobox swap; Radix Select renders a hidden native select for forms |
| Optional: form-field validation wrapper (Phase 4) at `src/components/ui/form.tsx` (new file) | `src/components/ui/dialog.tsx` | Same wrapper pattern around `@radix-ui/react-form`. Defer: see Phase 4 + Open Questions |

**Conventions referenced:**
- `docs/wiki/architecture.md` — UI primitive convention (re-exported wrappers in `src/components/ui/` rather than direct primitive imports in feature code). Keep the convention; both Headless UI and Radix sit behind the same wrapper layer.
- `docs/wiki/auth.md` — relevant only insofar as PersonForm's `useActionState` pipeline calls Server Actions; the migration must not regress the action invocation contract.

**Overall Progress:** 0% (0/5 phases complete)

**Note:**
- Each phase includes both implementation and verification (visual + a11y parity check)
- Smoke verification comes last, after all primitive swaps land (full keyboard/screen-reader walkthrough on `/admin/people`)
- This chunk is **orthogonal to 0023-people-dealer-role**. Ordering: ship 0023 first (it adds a Dealer checkbox to the Roles fieldset; this chunk then migrates *all* role checkboxes to Radix in one pass, including Dealer). Reverse ordering forces 0024 to migrate Admin+Coach today and Dealer tomorrow.

### Phase Checklist

#### Phase 1: Dependency + dialog wrapper swap (Headless UI → Radix Dialog)
- [ ] `pnpm add @radix-ui/react-dialog`
- [ ] Decide: keep `@headlessui/react` for the duration of the migration (incremental swap) OR rip it out at the end of this chunk (single-lib commitment). Working assumption: rip it out in Phase 5; it's only used by `dialog.tsx`
- [ ] Rewrite `src/components/ui/dialog.tsx` against Radix primitives — preserve the exported API surface (`Dialog.Root`, `Dialog.Backdrop`, `Dialog.Panel`, `Dialog.Title`, `Dialog.Description`, `Dialog.Close`)
- [ ] Map Radix's `Overlay`/`Content` to Headless UI's `Backdrop`/`Panel` shape; preserve the existing `data-closed` transition Tailwind classes (Radix uses `data-state="open|closed"` — class names need updating)
- [ ] Verify the existing transition (fade + scale) still plays — Radix uses `data-state` attributes rather than `data-closed`; rewrite the Tailwind selectors accordingly
- [ ] Visual parity check on `/admin/people` Add/Edit dialogs and any other dialog call site (Block Date dialog at `/calendar`, etc.)
- [ ] Tsc + lint clean

#### Phase 2: PersonForm Roles fieldset → Radix Checkbox
- [ ] Decide: Checkbox-with-multi-select OR RadioGroup-with-mutual-exclusion. Tied to 0023's "mutual exclusion of dealer with admin/coach" open question — defer until 0023 lands or pull that decision forward into this chunk
- [ ] If Checkbox: `pnpm add @radix-ui/react-checkbox`; rewrite the Admin/Coach checkboxes (and post-0023 Dealer checkbox) to use it
- [ ] If RadioGroup: `pnpm add @radix-ui/react-radio-group`; restructure the fieldset — single radio group with three options
- [ ] Either way: preserve `name="roles"` form-data wiring (Radix Checkbox renders a hidden `<input>`; RadioGroup renders one)
- [ ] Keep Tailwind classes consistent with the rest of the form
- [ ] Verify keyboard nav (Tab to fieldset, Space to toggle, arrow keys for RadioGroup)
- [ ] Test: ticking/unticking each role still serializes correctly into FormData

#### Phase 3: PersonForm Dealers section → Combobox (`cmdk`) + Radix Select for role
- [ ] `pnpm add cmdk @radix-ui/react-select @radix-ui/react-popover`
- [ ] Build `src/components/ui/combobox.tsx` wrapping `cmdk` + Radix Popover (anchored on `dialog.tsx` shape). Public API: `<Combobox options={…} value={…} onChange={…} placeholder="…" />`
- [ ] Replace the dealer dropdown at `src/features/people/people-admin.tsx:471-483` with `<Combobox options={dealers}>` — typeable, filterable; on a 50+ dealer list this is the largest UX win in the chunk
- [ ] Replace the dealer-link role `<select>` at `src/features/people/people-admin.tsx:484-496` with Radix Select
- [ ] Preserve hidden-input form-data wiring at `src/features/people/people-admin.tsx:377-386` (already serializes `dealerLinks=<id>:<role>`; no change needed if both new controls write to local state)
- [ ] Verify: typeahead picks the right dealer, role select keyboard works, removing a row works
- [ ] Test: add a dealer link via Combobox → submit → server action receives `dealerLinks=42:staff` exactly as before

#### Phase 4: Form-level field validation via Radix Form (decide: adopt or defer)
- [ ] **Decision phase first** — Radix Form gives you `<Form.Field>` + `<Form.Message match="…">` for inline-rendered field errors. Trade-off: more structural rewrite of the form vs. continuing to surface validation via toast on submit. Pick a path before writing code
- [ ] If adopt: `pnpm add @radix-ui/react-form`; build `src/components/ui/form.tsx` wrapper; migrate the existing client-side checks (firstName/lastName required, email regex) from `useActionState` reducer + toast to inline `<Form.Message>` rendering
- [ ] If defer: skip Phase 4 entirely; mark this row as N/A in the tracker. The form continues to use the existing `useActionState` + toast pattern (adopted in commit `4a4afbd`)
- [ ] Either way: server-side validation in the Server Action stays untouched — Radix Form is presentation only

#### Phase 5: Tests + smoke verification
- [ ] Remove `@headlessui/react` from `package.json` if Phase 1 went the rip-out route; verify nothing else imports it (`grep -r '@headlessui' src/`)
- [ ] Service-level test (carry-forward from existing test files): create + update person via the Server Action — assert FormData payload structure unchanged
- [ ] Smoke (web-test): `goto /admin/people`; click "Add Person"; dialog opens with heading "Add Person" and the Radix-themed close button still visible top-right
- [ ] Smoke (web-test): tab through the Roles fieldset → keyboard parity confirmed (Space toggles each)
- [ ] Smoke (web-test): focus the dealer Combobox → type "cap" → Capital Ford appears in the popover; arrow-down + Enter selects it; the role Select then accepts a value via keyboard
- [ ] Smoke (web-test): click Cancel → dialog closes; click outside → dialog closes; Esc → dialog closes (verify all three Radix-default behaviors fire)
- [ ] Smoke (web-test): on `/calendar`, "Block Date" dialog still opens correctly (Phase 1 wrapper change must not regress other dialog call sites)
- [ ] Bundle-size check: `pnpm build` and compare PersonForm route bundle size before/after; expect a small net change (Headless UI swap is roughly even; cmdk + Combobox add ~5–10 KB)

## Open questions (resolve as the chunk progresses)

- **Headless UI rip-out vs. coexistence?** The wrapper at `src/components/ui/dialog.tsx` is the *only* current consumer of `@headlessui/react`. Coexistence buys nothing here unless future chunks intend to keep using HUI primitives. Working assumption: rip it out at the end of Phase 5. Verify before merging Phase 1.
- **Mutual exclusion (Checkbox vs. RadioGroup)?** Tied to 0023's same open question. If we resolve 0023 to "enforced exclusion via radio group," Phase 2 of this chunk is RadioGroup; otherwise Checkbox. Pull that decision in before Phase 2 starts.
- **Radix Form (Phase 4) — adopt or defer?** Defer is cheaper but leaves field-level validation as a separate future migration. Adopt is more structural but unifies the form story. Lean: defer for now (preserves the recently-shipped React 19 `useActionState` pattern from commit `4a4afbd`); revisit when a second form needs the same treatment.
- **Pilot vs. app-wide migration?** This plan covers PersonForm only. If approved, follow-up chunks would migrate the Block Date dialog, Lookup admin forms, etc. Out of scope for 0024 — note as a forward link.
- **Sequencing with 0023?** Strong preference: 0023 ships first (adds the Dealer role + form checkbox), THEN 0024 migrates the whole Roles fieldset to Radix in one pass. Reverse ordering means migrating Admin+Coach today and Dealer in a follow-up — wasted churn. Confirm before either chunk picks up.
- **Form-state library?** `react-hook-form`, `conform`, or stay with native + `useActionState`? Out of scope for this chunk's primitive migration but worth a separate decision once Radix is in. Lean: stay with `useActionState` (matches the React 19 direction the codebase just adopted).
