# Production List: Date column (replace Status) — Intent

**Created:** 2026-07-06

## Problem

The Production List (`/production`, a table of campaigns) shows a **Status** column
(a derived `live` / `upcoming` / `past` / `cancelled` badge) but has **no dedicated,
sortable date column**. The campaign's date range only appears as a small sublabel
under the Campaign name, so an admin can't sort the list chronologically to see
"what's coming next" at a glance. The Status column's sort key is the derived
status *string*, which is not a useful ordering.

Separately, the Status column does double duty: it is the target of the toolbar's
time-window dropdown (`Upcoming` / `Past` / `Next 1–2–3 months`) **and** the
"Show cancelled" checkbox. The time-window dropdown is largely redundant with a
proper date sort, and its forward-window (`1m`/`2m`/`3m`) feature is niche.

## Desired outcome

The Production List has a **Date** column showing each campaign's **start date**,
sortable ascending/descending, and the list defaults to date-ascending order.
The former Status column is gone from the visible table. The **"Show cancelled"**
default-hide behavior is preserved (cancelled campaigns stay hidden until the box
is checked). The now-superseded time-window dropdown is removed. The CSV export
stays consistent (it already carries a Date Range column; no dead time-window
params left behind).

## Non-goals

- No database or query change — `Campaign` rows already carry `startDate`/`endDate`.
- No change to the CSV export's *output columns* (it keeps its Date Range + Status
  columns; a report can carry both). Only its now-unused time-window *filter*
  predicate is trimmed.
- Not touching the `status` *stored field* or its meaning (`draft`/`booked`/
  `cancelled`/`completed`) — only the derived Status *column* and the time-window UI.
- No change to search, the "Show cancelled" toggle behavior, or row-click-to-edit.

## Success criteria

- `/production` renders a **Date** column (start date) instead of **Status**; clicking
  the header sorts the list by date, and the list loads date-ascending by default.
- Cancelled campaigns remain hidden by default; checking "Show cancelled" reveals them.
- The time-window dropdown is gone from the toolbar.
- `tsc` clean, no new lint, unit tests updated/green, browser smoke of `/production`.

## Open questions

- **Which date — start or end?** Decided: **start date** (matches the DB's existing
  `order by startDate` and is the natural "when does it begin" sort). Change to end
  date only if the owner prefers "when does it wrap up."
- Should the Date column show just the start date, or the `start → end` range? Leaning
  **start date only** (the range is already in the Campaign-name sublabel); revisit if
  the standalone start-only reads as losing information.

## Why now

Owner asked to make the Production List sortable by date, replacing the Status column.
The exploration for this chunk found the Status column is coupled to the toolbar
filter, so "replace Status with Date" also means re-homing the "Show cancelled"
filter and retiring the time-window dropdown a date sort supersedes.
