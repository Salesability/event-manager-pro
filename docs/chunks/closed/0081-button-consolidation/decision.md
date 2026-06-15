# 0081 — Button consolidation decisions

**Date:** 2026-06-15

Two open questions from `plan.md` Phase 4, both resolved with the owner during the build.

## Decision 1 — Destructive button treatment: soft/tonal red (not solid)

**Choice:** A new `destructive` variant on the Catalyst `Button`, styled **soft/tonal red** — pale fill, soft red border, **dark near-black text** — rather than Catalyst's loud solid `color="red"` (white-on-red).

**Source:** Owner inspiration image (the Supabase "Delete project" button) — a low-emphasis destructive: you have to mean it, but it doesn't scream.

**Implementation** (`src/components/catalyst/button.tsx`): a flat variant alongside `outline`/`plain` (no solid-button pseudo-layering):
```
destructive: border-red-300 bg-red-50 text-zinc-950 data-hover:bg-red-100 data-active:bg-red-100
             (+ dark-mode + red icon var)
```
plus `destructive: true` added to the `ButtonProps` discriminated union (mutually exclusive with `color`/`outline`/`plain`).

**Applied to:** lookup archive "✕" (`lookup-admin`), availability delete "✕" (`availability-admin`), Cancel Campaign (`event-detail`). These were previously hand-rolled `border-red-300 bg-white text-red-700`-style buttons.

**Out of scope:** the danger-callout *panel* (pink box + red icon badge) and unifying the ~8 ad-hoc red error panels → deferred to a follow-up chunk (≈0082, parked in `CURRENT.md`).

## Decision 2 — Compact scale: add a `compact` size

**Choice:** Add a `compact` affordance to the `Button` rather than forcing every dense admin-table button up to Catalyst's standard `text-sm/6`.

**Why:** admin tables (lookups, availability, dealers, people) use dense `text-xs` row buttons; the standard size would visibly bloat those rows. A `compact` size preserves density while still consolidating onto the shared component.

**Implementation:** the sizing classes were split out of `styles.base` into `styles.sizes.{default,compact}` (`compact ≈ text-xs px-2.5 py-1`); a `compact?: boolean` prop (orthogonal to variant) selects it.

**Applied to:** dense admin/table/row buttons and tight inline actions. **Default size kept** for standalone form-action rows and main page CTAs (e.g. booking-form Cancel/Book-Event, availability "Add Block", calendar month-nav).

## Cross-cutting principle — preserve emphasis

Migration preserved each button's *existing emphasis*: solid → `color="brand"` solid, outline/white → `outline`, red → `destructive`. We did **not** promote outline buttons to solid (e.g. "+ Add Dealer" stays an outline button). The pre-existing solid-vs-outline mix for "add/create" actions is out of this chunk's scope; this chunk only unifies the *mechanism* + the *primary color* + the *destructive look* + *scale*.

## Sequencing note

Because both decisions were locked before Phase 2, the `button.tsx` foundation (both variants) was built at the start of Phase 2, and the destructive treatment was applied in-pass as each file was touched (Phases 2–3). Phase 4 therefore carried no further code — it is the decision record + lint/verification gate.
