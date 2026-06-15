# Button Consolidation & Primary-Color Standardization — Plan

**Intent:** [`intent.md`](intent.md)
**Started:** 2026-06-15

## Progress Tracker

| Phase | Status | Commit |
|-------|--------|--------|
| 1: Green → brand primary swaps (pure) | Done | c69c11f |
| 2: Component foundation + collapse class-constants onto `Button` | Done | 5d20fc8 |
| 3: Migrate one-off inline raw buttons (calendar + forms) | Pending | - |
| 4: Resolve destructive + compact-scale decisions, apply | Pending | - |
| 5: Smoke verification (web-test) | Pending | - |

This chunk makes the shared Catalyst `Button`
(`src/components/catalyst/button.tsx`) the one way standard buttons are rendered,
and **brand blue (`color="brand"`) the one primary-action color**. "Done" =
green retired from primary, the duplicated `submitClass`/`buttonClass`-style
constants removed, raw standard `<button className>` reduced to the
intentional-exceptions list, `tsc`+tests green / 0 new lint, and a browser smoke
confirming primary buttons are brand blue on the key routes.

**Follow-up (out of scope, owner decision 2026-06-15):** a shared danger/warning
**Callout** component (pink box + red icon badge + heading + subtext + action
slot) and the unification of the ~8 ad-hoc red error panels are deferred to a
future chunk (≈0082). This chunk adopts only the soft-red destructive *button*
style from the inspiration image.

## Code Anchors

This is a refactor onto an existing component — the anchor is the component's API
plus an existing good consumer to match call-site shape.

| New code | Anchor (`path:line`) | Why this anchor |
|----------|---------------------|-----------------|
| All migrated call sites | `src/components/catalyst/button.tsx:165` (ButtonProps) | The variant contract: `color` (solid) XOR `outline` XOR `plain`; `href` makes it an `<a>` |
| Solid primary `<Button color="brand">` | `src/features/quotes/quote-composer.tsx:1172` (existing `<Button color=…>`) | Existing solid-color consumer — match prop + children shape |
| Secondary `<Button outline>` | `src/app/(app)/calendar/calendar-view.tsx:454` (`<Button outline onClick>`) | Existing outline consumer in the same area being migrated |
| Link-as-button `<Button outline href=…>` | `src/components/catalyst/button.tsx:184` (href branch) | Confirms `<Button href>` renders the Catalyst `Link` (event-detail "Create Quote" is an `<a>`) |

**Conventions referenced:**
- `docs/wiki/index.md` → catalog; check for a components/UI page to ingest the
  "Button is the one primitive; brand blue is primary" rule on close.
- [[project_design_chroma_north_star]] (memory) — brand is logo-derived; brand
  blue as primary aligns with the north-star.

**Overall Progress:** 40% (2/5 phases complete)

**Note:**
- This is a visual/refactor chunk: "tests" = `tsc` + existing suite stay green +
  0 new lint; behavioral verification is the web-test browser smoke in Phase 5.
- Phases 1–3 are low-risk mechanical migrations; Phase 4 is the one that may
  touch `button.tsx` itself (pending the two decisions).

### Phase Checklist

#### Phase 1: Green → brand primary swaps (pure, low-risk)
- [x] `src/app/(app)/calendar/calendar-view.tsx:459` — `color="green"` → `color="brand"` ("+ Book Event")
- [x] `src/features/msa/msa-send-button.tsx:36` — `color="green"` → `color="brand"`
- [x] `src/features/msa/msa-create-dialog.tsx:140` — `color="green"` → `color="brand"`
- [x] `src/features/quotes/quote-composer.tsx:1172` — `color="green"` → `color="brand"`
- [x] `src/features/quickbooks/quickbooks-admin.tsx:80/168/240` — `color="green"` → `color="brand"` (3 sites)
- [x] Leave `src/components/app/status-badge.tsx:50` `<Badge color="green">Live</Badge>` — semantic status, not a button (verified: only remaining `color="green"`)
- [x] `tsc` + tests green

#### Phase 2: Component foundation + collapse duplicated class-constants onto `Button`
**Foundation (`src/components/catalyst/button.tsx`)** — both Phase-4 decisions are locked, so the affordances they need are built here first:
- [x] Add `compact` size (split sizing into `styles.sizes.{default,compact}`; compact ≈ `text-xs px-2.5 py-1`) — Decision 2
- [x] Add soft-red `destructive` variant (`bg-red-50 border-red-300 text-zinc-950 data-hover:bg-red-100`) + `destructive: true` in the prop union — Decision 1

Primary constant `submitClass` (`bg-brand-600 … text-white`) → `<Button color="brand" compact>`:
- [x] `src/features/schedule/availability-admin.tsx` (taller form submit → `color="brand"` default size)
- [x] `src/features/msa/send-test-msa-form.tsx`
- [x] `src/features/people/orphan-auth-users.tsx`
- [x] `src/features/email/send-test-email-form.tsx`
- [x] `src/features/dealers/dealer-form.tsx`

Secondary constant `buttonClass` (`border-zinc-200 bg-white … text-zinc-900`) → `<Button outline compact>`:
- [x] `src/features/schedule/lookup-admin.tsx` (Save / Cancel / Rename) + inline Add → `color="brand" compact`
- [x] `src/features/schedule/availability-admin.tsx` (Edit / Cancel)
- [x] `src/features/tax-rates/tax-rate-mapping.tsx` (Refresh rates)

Small-secondary / header constants → `<Button outline compact>` (emphasis preserved — outline stays outline):
- [x] `cancelClass` / `rowEditClass` (dealer-form, orphan-auth-users)
- [x] `headerAddClass` (`dealers-admin.tsx`) + Clear-filters; **left the `pillClass` filter toggles (195/203/211) as intentional exceptions** (rounded-full segmented filter, like the coach `Pill`)
- [x] **Destructive buttons in these files converted in-pass** (lookup archive "x" `lookup-admin`, availability delete `availability-admin`) → `<Button destructive compact>`
- [x] Delete the now-unused constant declarations (verified: 0 leftover refs to `submitClass`/`buttonClass`/`cancelClass`/`rowEditClass`/`headerAddClass`)
- [x] `tsc` clean + 1136/1136 tests green (serial)

#### Phase 3: Migrate one-off inline raw buttons (calendar + forms)
`src/app/(app)/calendar/event-detail.tsx`:
- [ ] 135 Email Client, 144 Email Coach → `<Button outline>`
- [ ] 157 Create Quote (an `<a>`) → `<Button outline href=…>`
- [ ] 167 Cancel Campaign → destructive (see Phase 4 decision)
- [ ] 179 Re-sync → `<Button outline>`
- [ ] 191 Edit → `<Button color="brand">`

`src/app/(app)/calendar/booking-form.tsx`:
- [ ] 254 "+ Add" dealership action → `<Button plain>` (or keep as a text link if plain reads wrong)
- [ ] 459 Cancel → `<Button outline>`
- [ ] 466 Book Event / Save (submit) → `<Button color="brand" type="submit">`
- [ ] 325 / 352 / 420 — audit and migrate the remaining inline buttons

Other surfaces (audit each, migrate standard buttons):
- [ ] `src/features/people/people-admin.tsx` (202/212/222/249)
- [ ] `src/features/dealers/dealers-admin.tsx` (195/203/211/244)
- [ ] `src/features/quotes/quotes-admin.tsx` (126/151), `quote-composer.tsx` (894/1134)
- [ ] `src/app/(app)/quotes/[id]/page.tsx:276`, `dealerships/[id]/page.tsx:133`
- [ ] `src/app/(app)/production/production-page-actions.tsx:23`, `reports/reports-tabs.tsx:148`
- [ ] `src/app/login/page.tsx` (43/74), `src/app/auth/auth-error/page.tsx:59` — audit (some may be password-toggles / non-standard)
- [ ] **Do NOT touch** the intentional exceptions (see intent Non-goals): `Pill` (calendar-view:667), `tabs.tsx`, `row-actions.tsx`, `row-identity-cell.tsx`, `data-table.tsx` pagination, `<Badge>`
- [ ] `tsc` + tests green

#### Phase 4: Resolve destructive + compact-scale decisions, apply
- [x] **Decision 1 — destructive: LOCKED → soft/tonal red** (owner inspiration 2026-06-15, the Supabase "Delete project" button). NOT solid `color="red"`. Spec: pale red fill (`bg-red-50`), soft red border (`border-red-200`/`-300`), **dark near-black text** (`text-zinc-950`, not red text), `rounded-lg`, hover `bg-red-100`. Low-emphasis destructive. Implementation TBD in build (likely a new variant/preset on `button.tsx` since Catalyst's solid/outline/plain don't produce a tinted-fill-dark-text treatment) — record the exact mechanism in `decision.md`.
- [ ] Apply the soft-red destructive treatment to: Cancel Campaign (event-detail:167), lookup archive "x" (lookup-admin:273/278), availability delete (availability-admin:196), dealer delete, any other red buttons surfaced in Phase 3
- [ ] **Decision 2 — compact scale.** Pick: (a) accept Catalyst's `text-sm/6` size everywhere, or (b) add a `compact`/size affordance to `button.tsx` for dense admin tables. Record in `decision.md`.
- [ ] Apply the scale decision consistently across the migrated admin-table buttons
- [ ] `tsc` + tests green; lint shows 0 new vs base

#### Phase 5: Smoke verification (web-test)
- [ ] `goto /calendar` — header renders "+ Book Event" as a **brand-blue** primary; "Block Date" outline; month nav `‹`/`›` present
- [ ] `goto /admin/lookups` — lookup admin renders "Add" (brand) + secondary actions; no visual regression
- [ ] `goto /admin/quickbooks` — Connect / submit buttons render brand blue (no green)
- [ ] `goto /quotes/[id]` — quote actions render; primary is brand blue
- [ ] `goto /dealerships` and a dealer detail — add/edit/cancel buttons render via the shared component
- [ ] Read-only discipline: do NOT click Email Client/Coach, Cancel Campaign, deletes, or any send/submit (real-side-effects on the auth-injected user)
- [ ] Capture a screenshot of `/calendar` header for the visual record
- [ ] On close: ingest the "Button is the one primitive; brand blue = primary; green is status-only" rule into `docs/wiki/` and log it
