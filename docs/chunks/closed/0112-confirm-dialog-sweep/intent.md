# Confirm-dialog sweep — retire window.confirm() — Intent

**Created:** 2026-07-16

## Problem

Every confirmation in the app is a native `window.confirm()` — 10 call sites across 7 files (SMS launch/import, campaign cancel, two email confirms, and the archive/remove actions on the availability, lookup, people, and dealers admin surfaces). The native dialog is unstyled, shows the raw Cloud Run hostname ("…run.app says"), can't reflect the design system, blocks the whole tab, and freezes browser automation (Playwright smokes and the Chrome extension both hang on native modals). Owner flagged it as dated UX during the 2026-07-16 stage review of the SMS panel.

## Desired outcome

- One shared, styled confirm dialog (Catalyst Alert under the hood — currently zero consumers) with the design-system button treatments: brand-blue primary for affirmative actions, soft/tonal red for destructive ones.
- All 10 `confirm()` call sites replaced; no `window.confirm` remains in `src/`.
- Confirmations are await-able in the existing handler flows (a `useConfirm()` hook returning a promise, or equivalent), so call sites stay as simple as the `if (!confirm(...)) return` they replace.
- Browser smokes can open and cancel any confirmation without special handling.

## Non-goals

- No redesign of the underlying actions (what gets sent/cancelled/archived is untouched).
- No new confirmation *policies* — the same actions confirm as before, none added or removed.
- No sweep of other native primitives (`alert()`, `prompt()`) — none are known to exist in app code; if one surfaces, note it, don't chase it.
- No changes to the Catalyst primitives themselves.

## Success criteria

- `grep -rn "confirm(" src/ --include="*.tsx"` returns zero native-confirm call sites.
- Launch send on the SMS panel shows an in-app dialog with the recipient/exclusion counts, Cancel + confirm actions; Cancel is a no-op, confirm launches.
- Cancel Campaign in event-detail shows the destructive (soft-red) treatment.
- Each admin surface's archive/remove opens the dialog and Cancel leaves the row intact.
- Chunk-end web-test smoke can click into and cancel out of the dialogs (impossible with native confirm).

## Open questions

- Hook vs component-per-surface: leaning `useConfirm()` (promise-based, one dialog instance per page via context or local state) — resolve in Phase 1 by whichever matches Catalyst Alert's controlled `open` prop with the least ceremony.

## Why now

Owner reviewed the SMS surface on stage (2026-07-16, first business-review cycle) and the native dialog was the first thing flagged. The SMS line is headed to a business demo — the launch confirm is the most-seen dialog in that flow.
