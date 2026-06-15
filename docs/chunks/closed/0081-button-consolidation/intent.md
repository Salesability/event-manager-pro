# Button Consolidation & Primary-Color Standardization — Intent

**Created:** 2026-06-15

## Problem

The app has a solid shared button primitive — the Catalyst `Button`
(`src/components/catalyst/button.tsx`, from chunk 0049) — but it's widely
bypassed. Only **8 files** import it; **~25 files** still hand-roll buttons as
raw `<button className="…">` or via duplicated local class-constants
(`submitClass`, `buttonClass`, `cancelClass`, `rowEditClass`, `headerAddClass`).
Those constants are verbatim copies of each other across features, so the same
three logical buttons (primary / secondary / destructive) exist in several
slightly-incompatible forms — drifting on padding (`py-1.5` vs `py-2`), text
size (`text-xs` vs `text-sm`), and font weight (`font-medium` vs `font-semibold`),
and missing the focus ring, 44×44 touch target, and dark-mode handling the
shared component gives for free.

On top of that, the **primary-action color is ambiguous**: the brand ramp is
blue (`brand-600`, the logo color), but several primary CTAs use
`color="green"` (create event, send MSA, send quote, connect QuickBooks) while
the hand-rolled primaries use `bg-brand-600`. Two colors both read as "the main
action" depending on the screen.

## Desired outcome

- One canonical primary-action color across the whole app: **brand blue**
  (`color="brand"`). Green is retired from primary use (semantic status
  `<Badge color="green">` stays).
- Every standard text button renders through the shared Catalyst `Button` with
  the right variant: solid `color="brand"` = primary, `outline` =
  secondary/cancel, `plain` = minimal/link. No more raw `<button className>` for
  standard buttons, no more duplicated `submitClass`/`buttonClass` constants.
- Visual consistency: identical padding, radius, focus ring, hover, and
  disabled treatment everywhere; primary buttons are uniformly brand blue.

## Non-goals

- Not adding a split/dropdown button primitive (the "Add user ▾" pattern in the
  reference image) — deferred.
- Not building the danger-callout panel (pink box + red icon badge + heading +
  subtext) from the inspiration image, and not unifying the ~8 ad-hoc red
  error/warning panels — deferred to a follow-up chunk. **This chunk adopts only
  the soft-red destructive *button* style from that image.**
- Not adding a dedicated `IconButton` helper — icon-only buttons
  (`row-overflow-menu`, calendar refresh) stay as-is this pass.
- Not restyling toward the reference screenshot's softer-mint-green-with-dark-text
  look — we chose brand blue, not Supabase green.
- Not touching component primitives or generic renderers: the `Pill`
  coach-filter chips (dynamic per-coach colors), `components/catalyst/tabs.tsx`,
  `components/app/row-actions.tsx` + `row-identity-cell.tsx`, and
  `components/ui/data-table.tsx` pagination.
- Not introducing `cva`/shadcn — keep the existing clsx + Tailwind + CSS-var
  pattern.

## Success criteria

- `grep` for `color="green"` on a `<Button>` returns **0** primary CTAs (only
  the semantic `<Badge color="green">` remains).
- The duplicated `submitClass` / `buttonClass` / `cancelClass` /
  `rowEditClass` / `headerAddClass` constants are gone (or reduced to the shared
  `Button`).
- Raw `<button className="…">` count for *standard* buttons drops to the
  intentional-exceptions list only.
- `tsc` + test suite green; lint shows **0 new** issues vs base.
- Browser smoke (web-test) confirms primary buttons render brand blue and admin
  surfaces still render their action buttons, on the key routes.

## Open questions

1. **Destructive treatment.** Catalyst ships only solid `color="red"`; today's
   destructive buttons are *subtle* (white bg + red border/text — "Cancel
   Campaign", lookup archive "x", dealer delete). Accept solid red, or add a
   subtle/outline-red treatment to `button.tsx`? (Resolve in Phase 4.)
2. **Compact scale.** Admin tables use dense `text-xs` buttons; Catalyst
   `Button` is `text-sm/6` with its own padding and no `size` prop. Accept the
   size bump, or add a `compact`/size affordance to the component? (Resolve in
   Phase 4.)

## Why now

A button-styling review with the owner (2026-06-15, prompted by a reference
screenshot) surfaced the inconsistency and forced the green-vs-blue decision.
The shared Catalyst component already exists, so this is a consolidation pass,
not a rebuild — cheap to do now while the decision is fresh, and it removes a
recurring source of visual drift for every future feature.
