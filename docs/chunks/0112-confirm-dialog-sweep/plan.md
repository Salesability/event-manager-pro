# Confirm-dialog sweep — retire window.confirm() — Plan

**Intent:** [`intent.md`](intent.md)
**Started:** 2026-07-16

## Progress Tracker

| Phase | Status | Commit |
|-------|--------|--------|
| 1: [Shared ConfirmDialog + useConfirm hook] | Pending | - |
| 2: [Demo-visible surfaces: sms-panel + event-detail] | Pending | - |
| 3: [Admin surfaces: availability, lookup, people, dealers] | Pending | - |
| 4: Tests + smoke verification | Pending | - |

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

**Conventions referenced:**
- Button design-system rules (0081): shared Catalyst Button only; brand blue primary; destructive = soft/tonal red — never solid red.
- `.claude/skills/web-test/SKILL.md` — smoke checks open dialogs and Cancel out; never submit destructive confirms on gated surfaces.

**Overall Progress:** 0% (0/4 phases complete)

**Note:**
- Each phase includes both implementation and tests
- No DB surface — Phase 4 is typecheck/unit/web-test only (no integration tests needed)

### Phase Checklist

#### Phase 1: [Shared ConfirmDialog + useConfirm hook]
- [ ] Task 1
- [ ] Task 2

#### Phase 2: [Demo-visible surfaces: sms-panel + event-detail]
- [ ] Task 1
- [ ] Task 2

#### Phase 3: [Admin surfaces: availability, lookup, people, dealers]
- [ ] Task 1
- [ ] Task 2

#### Phase 4: Tests + smoke verification
- [ ] `grep -rn "confirm(" src/ --include="*.tsx"` → zero native call sites
- [ ] Smoke (web-test): `goto /calendar/<demo-campaign-id>/sms`; click `Launch send`; in-app dialog with recipient + exclusion counts and `Cancel` / confirm buttons; click `Cancel` → dialog closes, nothing sent
- [ ] Smoke (web-test): `goto /calendar?event=<demo-campaign-id>`; open event detail; click `Cancel Campaign`; dialog shows soft-red destructive confirm; click `Cancel` → campaign untouched
- [ ] Smoke (web-test): one admin surface (e.g. `/dealerships`): click a row `✕`; dialog opens; `Cancel` → row intact
