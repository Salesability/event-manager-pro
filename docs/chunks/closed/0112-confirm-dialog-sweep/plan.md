# Confirm-dialog sweep — retire window.confirm() — Plan

**Intent:** [`intent.md`](intent.md)
**Started:** 2026-07-16

## Progress Tracker

| Phase | Status | Commit |
|-------|--------|--------|
| 1: [Shared ConfirmDialog + useConfirm hook] | Done | e143e3c |
| 2: [Demo-visible surfaces: sms-panel + event-detail] | Done | 2dde68f |
| 3: [Admin surfaces: availability, lookup, people, dealers] | Done | 37635cf |
| 4: Tests + smoke verification | Done | cf7a1d7 |

Replace all 10 native `window.confirm()` call sites (7 files) with a shared, styled confirm dialog built on the so-far-unused Catalyst Alert, keeping call sites as simple as the `if (!confirm(...)) return` they replace via a promise-based `useConfirm()`. Done = zero native confirms in `src/`, design-system button treatments (brand primary / soft-red destructive), and browser smokes that can open + cancel every dialog.

## Code Anchors

For each new file or method below, the builder reads the anchor first and matches its shape (length, error handling, naming, query style). For modifications to an existing file, the anchor is the nearest sibling method in that same file.

| New code | Anchor (`path:line`) | Why this anchor |
|----------|---------------------|-----------------|
| `src/components/app/confirm-dialog.tsx` (ConfirmDialog + `useConfirm`) | `src/components/catalyst/alert.tsx` (the primitive) + `src/features/msa/msa-create-dialog.tsx` (controlled-open dialog wiring, action row, pending state) | Alert is the purpose-built confirm primitive (zero consumers today); msa-create-dialog is the repo's canonical controlled-dialog consumer shape |
| Button treatments inside the dialog | `src/components/catalyst/button.tsx` + design-system rules (brand blue = the one primary; destructive = soft/tonal red, pale fill + red border + dark text, chunk 0081) | The dialog's two variants must match the app-wide button doctrine |
| `sms-panel.tsx` call-site rewrite | `src/features/sms/sms-panel.tsx:79` + `:107` (`onImport` / `onLaunch`) | Modify-in-place; nearest sibling is the handler itself |
| `event-detail.tsx` call-site rewrite (3 confirms; Cancel Campaign is the destructive variant) | `src/app/(app)/calendar/event-detail.tsx:32,71,87` | Same |
| Admin call-site rewrites | `src/features/schedule/availability-admin.tsx:133`, `src/features/schedule/lookup-admin.tsx:210`, `src/features/people/people-admin.tsx:145,389`, `src/features/dealers/dealers-admin.tsx:196` | Same |
| Hook unit test | `src/components/app/row-actions.test.tsx` | Nearest component test in the same directory |
| `alert.tsx` z-layer fix (added in Phase 4) | `src/components/catalyst/dialog.tsx:33,36` (z-40 backdrop / z-50 panel) | Alert must match Dialog's z-layer so a nested confirm paints above its host dialog |

**Conventions referenced:**
- Button design-system rules (0081): shared Catalyst Button only; brand blue primary; destructive = soft/tonal red — never solid red.
- `.claude/skills/web-test/SKILL.md` — smoke checks open dialogs and Cancel out; never submit destructive confirms on gated surfaces.

**Overall Progress:** 100% (4/4 phases complete)

**Note:**
- Each phase includes both implementation and tests
- No DB surface — Phase 4 is typecheck/unit/web-test only (no integration tests needed)

### Phase Checklist

#### Phase 1: [Shared ConfirmDialog + useConfirm hook]
- [x] `src/components/app/confirm-dialog.tsx`: `ConfirmDialog` component on Catalyst Alert — title, optional message, Cancel (outline) + confirm action (brand-blue primary; soft-red `destructive` variant per 0081 doctrine)
- [x] `useConfirm()` promise-based hook in the same file — `confirm(options): Promise<boolean>`, single pending request, resolves `false` on cancel/backdrop close; returns `{ confirm, confirmDialog }` for callers to render
- [x] Unit test `src/components/app/confirm-dialog.test.tsx` — direct-invocation tree-walk style (per `row-actions.test.tsx`): title/message/labels render, destructive flag flips the confirm button variant, cancel + confirm wiring resolve correctly

#### Phase 2: [Demo-visible surfaces: sms-panel + event-detail]
- [x] `sms-panel.tsx`: `onImport` (replace-list warning) + `onLaunch` (recipient/exclusion counts) → `useConfirm`; render `confirmDialog`; both stay brand-primary confirms
- [x] `event-detail.tsx`: `onCancel` → destructive confirm ("Cancel campaign" soft-red); `onEmailClient` + `onEmailCoach` → brand-primary confirms; render `confirmDialog`

#### Phase 3: [Admin surfaces: availability, lookup, people, dealers]
- [x] `availability-admin.tsx` `AvailabilityRow.archive` → destructive confirm ("Remove")
- [x] `lookup-admin.tsx` row `archive` → destructive confirm ("Archive")
- [x] `people-admin.tsx` `PeopleAdmin.archive` → destructive confirm titled `Archive <name>?`; `buildArchiveConfirmMessage` reworked to return body-only copy (no "Continue?")
- [x] `people-admin.tsx` `PersonForm` end-app-access guard (inside the `useActionState` action) → awaited destructive confirm
- [x] `dealers-admin.tsx` `DealersAdmin.archive` → destructive confirm titled `Archive <name>?`; builder body-only

#### Phase 4: Tests + smoke verification
- [x] `grep -rn "confirm(" src/ --include="*.tsx"` → zero native call sites
- [x] Smoke (web-test): `goto /calendar/4175/sms` (0111 demo seed); click `Launch send`; in-app dialog with recipient + exclusion counts and `Cancel` / confirm buttons; click `Cancel` → dialog closes, nothing sent (`/tmp/web-test-0112-sms-launch-confirm.png`)
- [x] Smoke (web-test): `goto /calendar?event=4175`; click `Cancel Campaign`; soft-red destructive confirm; `Keep campaign` → campaign untouched (`/tmp/web-test-0112-cancel-campaign-confirm.png`). **Found + fixed in-phase:** `alert.tsx` had no z-index while `dialog.tsx` layers at z-40/z-50, so a confirm nested inside the event dialog rendered *behind* it (behavior worked, visually hidden). Added `z-50` to Alert's backdrop + panel container — a 2-class deviation from the intent's "no Catalyst changes" non-goal, required by this chunk's own success criteria (Alert was unusable nested without it).
- [x] Smoke (web-test): `/dealerships` → Demo Motors row actions → `Archive`; dialog opens with soft-red `Archive`; `Cancel` → row intact (`/tmp/web-test-0112-dealer-archive-confirm.png`)
