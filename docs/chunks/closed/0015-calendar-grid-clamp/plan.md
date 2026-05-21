# Calendar grid clamp — 2026-05-01

The calendar's slot-packing drops any campaign whose `startDate` or `endDate` falls outside the visible 42-cell grid (legacy `renderCalendar` port at `src/app/(app)/calendar/calendar-view.tsx:204` and the `drawRibbons` overlay at `:300`). Result: a campaign that began before the leading days of the visible month, or that ends after the trailing days, **does not render at all** for the months its visible portion would span. Flagged as Codex medium #1 by `eval-smoke` on 2026-05-01 and explicitly deferred at the time. Done = a campaign whose range overlaps the visible grid renders its visible portion (clamped to the first/last cell), with the slot-packing arithmetic still correct for that clamped range; campaigns entirely outside the grid still skip.

## Progress Tracker

| Phase | Status | Commit |
|-------|--------|--------|
| 1: Clamp helper + grid bounds extraction | Done | - |
| 2: Apply clamp in `slotAssignment` slot packer | Done | - |
| 3: Apply clamp in `drawRibbons` overlay positioning | Done | - |
| 4: Unit tests for the clamp helper + dev-server visual smoke | Done | - |

## Code Anchors

For each new file or method below, the builder reads the anchor first and matches its shape (length, error handling, naming, query style). For modifications to an existing file, the anchor is the nearest sibling method in that same file.

| New code | Anchor (`path:line`) | Why this anchor |
|----------|---------------------|-----------------|
| `clampToGrid(startDate, endDate, cellIndexMap)` helper colocated in `calendar-view.tsx` (or extracted to `calendar-utils.ts` if a second use site appears) | `src/app/(app)/calendar/calendar-view.tsx:217` (`rowStart` / `rowEnd` row-clamp inside the slot packer) | Same pattern, one level up: per-event clamp instead of per-row. Keep the `Math.max(si, gridStart)` / `Math.min(ei, gridEnd)` shape. |
| Modified `slotAssignment` `useMemo` block | `src/app/(app)/calendar/calendar-view.tsx:195` (current `slotAssignment`) | In-place edit; preserve the legacy slot-packing order and the per-row overlap test. The change is replacing the `if (si === undefined \|\| ei === undefined) continue;` early-out (line 206) with a clamped `[si, ei]` and a "skip iff the clamped range is empty" guard. |
| Modified `drawRibbons` `useCallback` | `src/app/(app)/calendar/calendar-view.tsx:281` (current `drawRibbons`) | Same edit as Phase 2 but in the overlay-positioning pass. The two passes must agree on the clamped indices or ribbons end up offset from the slot they were assigned. |
| Vitest tests for `clampToGrid` | `src/features/schedule/validators.test.ts:206` (`parseCampaignInput` describe block) | Same shape — pure-function tests, `describe` per function, table-driven cases for the boundary conditions. Lives in a sibling `*.test.ts` next to whichever file ends up holding the helper. |

**Conventions referenced:**
- `docs/wiki/architecture.md` — calendar uses a 42-cell grid (6 weeks × 7 days) regardless of month length; leading days come from the prior month, trailing from the next. The clamp is what lets that decision survive multi-week events.
- `CLAUDE.md` — "Don't add features beyond what the task requires." Scope here is the clamp only; do not refactor the slot packer, do not extract `calendar-utils.ts` unless a second use site materializes.

**Overall Progress:** 100% (4/4 phases complete)

### Implementation notes (2026-05-03)

- Helper extracted to `src/app/(app)/calendar/calendar-grid.ts` (`clampToGrid(startDate, endDate, grid)` + `GRID_LAST_INDEX = 41`). Sibling test `calendar-grid.test.ts` covers the seven boundary cases from the checklist below.
- `calendar-view.tsx` derives a `grid = { firstDate, lastDate, indexOf }` once from `cells` + `cellIndexMap`, runs `clampToGrid` once per visible event up front, and stashes the clamped `_si`/`_ei` on each slotted record. Both the slot packer and `drawRibbons` then read the precomputed indices, which guarantees the two passes agree on the clamped range.
- Updated the legacy-port comments at the slot-packer and `drawRibbons` blocks to call out the deliberate departure (legacy dropped these events; we render the visible slice).
- `pnpm tsc --noEmit` clean. `pnpm test` 42/42 (35 prior + 7 new).

**Note:**
- Pure rendering bug; no schema, no migration, no server-action change.
- The existing `verbatim port of legacy renderCalendar` comments at lines 194 and 280 will need a short update — clamping is a deliberate departure from the legacy behavior (legacy *also* dropped these events, see `deprecated/index.html` slot-packing). Keep the comments honest.
- Test-data gap: current seed data has no campaigns spanning month boundaries. Phase 4's visual smoke will need a one-off fixture (a single inserted campaign starting in the prior month, or a temporary seed script) to actually exercise the rendering. Don't ship a test-data hack; tear it down after the smoke.

### Phase Checklist

#### Phase 1: Clamp helper + grid bounds extraction
- [x] Add `calendar-grid.ts` with `clampToGrid` + `GRID_LAST_INDEX`
- [x] Derive `grid = { firstDate, lastDate, indexOf }` in `calendar-view.tsx`

#### Phase 2: Apply clamp in `slotAssignment` slot packer
- [x] Replace the early-out at the entry pass with a clamped record
- [x] Use the precomputed `_si`/`_ei` in the per-row slot search and `rowMaxSlots` pass
- [x] Update the legacy-port comment to call out the deliberate departure

#### Phase 3: Apply clamp in `drawRibbons` overlay positioning
- [x] Read `_si`/`_ei` from slotted records instead of looking up `cellIndexMap`
- [x] Update the legacy-port comment

#### Phase 4: Unit tests for the clamp helper + dev-server visual smoke
- [x] Test: range entirely before grid → returns null (skip)
- [x] Test: range entirely after grid → returns null (skip)
- [x] Test: range starts before grid, ends inside → clamped to `[0, ei]`
- [x] Test: range starts inside, ends after grid → clamped to `[si, 41]`
- [x] Test: range fully encloses grid → clamped to `[0, 41]`
- [x] Test: single-cell event inside grid → unchanged
- [x] Test: zero-day event (start == end) at boundary → unchanged
- [x] Test: range overlaps only the prior-month leading strip → clamped to `[0, n]` (added 2026-05-04 per Codex Low from `eval-2026-05-04-0804.md`)
- [x] Test: range overlaps only the next-month trailing strip → clamped to `[n, 41]` (added 2026-05-04)
- [x] Visual smoke: leading-clamp fixture (Apr 15 → May 4) renders correctly across April + May 2026 grids (4 ribbon segments per view); trailing-clamp fixture (May 28 → Jun 25) renders correctly across May + June 2026 grids (4 ribbon segments per view). No console / network errors during month-stepping.
- [x] Tear down the fixture (throwaway smoke script — `scripts/calendar-clamp-smoke.ts` — deleted with this chunk).
