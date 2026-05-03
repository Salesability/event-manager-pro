# Calendar grid clamp — 2026-05-01

The calendar's slot-packing drops any campaign whose `startDate` or `endDate` falls outside the visible 42-cell grid (legacy `renderCalendar` port at `src/app/(app)/calendar/calendar-view.tsx:204` and the `drawRibbons` overlay at `:300`). Result: a campaign that began before the leading days of the visible month, or that ends after the trailing days, **does not render at all** for the months its visible portion would span. Flagged as Codex medium #1 by `eval-smoke` on 2026-05-01 and explicitly deferred at the time. Done = a campaign whose range overlaps the visible grid renders its visible portion (clamped to the first/last cell), with the slot-packing arithmetic still correct for that clamped range; campaigns entirely outside the grid still skip.

## Progress Tracker

| Phase | Status | Commit |
|-------|--------|--------|
| 1: Clamp helper + grid bounds extraction | Pending | - |
| 2: Apply clamp in `slotAssignment` slot packer | Pending | - |
| 3: Apply clamp in `drawRibbons` overlay positioning | Pending | - |
| 4: Unit tests for the clamp helper + dev-server visual smoke | Pending | - |

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

**Overall Progress:** 0% (0/4 phases complete)

**Note:**
- Pure rendering bug; no schema, no migration, no server-action change.
- The existing `verbatim port of legacy renderCalendar` comments at lines 194 and 280 will need a short update — clamping is a deliberate departure from the legacy behavior (legacy *also* dropped these events, see `deprecated/index.html` slot-packing). Keep the comments honest.
- Test-data gap: current seed data has no campaigns spanning month boundaries. Phase 4's visual smoke will need a one-off fixture (a single inserted campaign starting in the prior month, or a temporary seed script) to actually exercise the rendering. Don't ship a test-data hack; tear it down after the smoke.

### Phase Checklist

#### Phase 1: Clamp helper + grid bounds extraction
- [ ] Task 1
- [ ] Task 2

#### Phase 2: Apply clamp in `slotAssignment` slot packer
- [ ] Task 1
- [ ] Task 2
- [ ] Task 3

#### Phase 3: Apply clamp in `drawRibbons` overlay positioning
- [ ] Task 1
- [ ] Task 2

#### Phase 4: Unit tests for the clamp helper + dev-server visual smoke
- [ ] Test: range entirely before grid → returns null (skip)
- [ ] Test: range entirely after grid → returns null (skip)
- [ ] Test: range starts before grid, ends inside → clamped to `[0, ei]`
- [ ] Test: range starts inside, ends after grid → clamped to `[si, 41]`
- [ ] Test: range fully encloses grid → clamped to `[0, 41]`
- [ ] Test: single-cell event inside grid → unchanged
- [ ] Test: zero-day event (start == end) at boundary → unchanged
- [ ] Visual smoke: insert a fixture campaign spanning the prior-month leading days into May 2026; verify ribbon renders on the visible portion only
- [ ] Visual smoke: same fixture spanning trailing days of May 2026 into June 2026
- [ ] Tear down the fixture
