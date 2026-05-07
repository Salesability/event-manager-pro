# Availability admin — 2026-04-30

Stub for sub-plan 5.4 of `docs/designs/0004-port-migration/plan.md`. The legacy `🚫 Block Date` button (`deprecated/index.html:279`) opens the `blockDateModal` (lines 579–599) where the user adds and removes blocked-date ranges. Today's calendar already renders these visually (port-views Phase 4 wired `loadAvailabilityBlocks` and the `blocked` cell marker), but no UI exists to create or remove them. Done = signed-in users can add, edit, and remove rows in `availability_blocks` via a dedicated UI; the calendar reflects changes immediately; the three legacy block kinds (statutory holiday, company closure, coach unavailable) are all selectable.

## Progress Tracker

| Phase | Status | Commit |
|-------|--------|--------|
| 1: Server actions + single-row queries | Done | - |
| 2: Block-out admin UI (list + add form) | Done | - |
| 3: Wire toolbar trigger on calendar | Done | - |
| 4: Verification (tsc + vitest + dev smoke) | Done | - |

## Code Anchors

| New code | Anchor (`path:line`) | Why this anchor |
|----------|---------------------|-----------------|
| `src/features/schedule/actions.ts` | availability actions near `// ---------- Availability blocks (5.4) ----------` | Server Actions for add/edit/archive on `availability_blocks`. |
| `src/features/schedule/availability-admin.tsx` | `AvailabilityAdmin` | Client UI for grouped list, add form, inline edit, and archive. |
| `src/app/(app)/calendar/calendar-view.tsx` | calendar toolbar / availability dialog | Opens the block-out admin from the master calendar. |

**Conventions referenced:**
- `docs/wiki/conventions.md` / `CLAUDE.md` — Server Actions for mutations.
- `docs/wiki/data-model.md` — `availability_blocks` covers three sources via a `kind` enum (`statutory_holiday | company_closure | coach_unavailable`); `coach_id` nullable for per-coach scoping; `start_date`/`end_date` inclusive range. Carries `actors` + `archivable`.

**Overall Progress:** 100% (4/4 phases complete)

**Note:**
- Depends on 5.1 (Toaster/Dialog primitives).
- Statutory holiday seeding is a separate concern (see open Q #18 in `docs/wiki/data-model.md`); this chunk handles manual entries only.
- Per-coach blocks (`kind='coach_unavailable'`) need a coach selector; otherwise the form is the same shape as a campaign date-range block.

### Phase Checklist

#### Phase 1: Server actions
- [x] Add `createAvailabilityBlock` / `updateAvailabilityBlock` / `archiveAvailabilityBlock` to `src/features/schedule/actions.ts`.
- [x] Validate `end_date >= start_date`; require `coach_id` only when `kind='coach_unavailable'`.

#### Phase 2: Admin UI
- [x] Build a list view grouped by month with inline add (date range, kind select, optional coach select for coach-unavailable, optional reason text) and ✕ to archive.

#### Phase 3: Wire calendar toolbar
- [x] Add 🚫 Block Date button to the calendar toolbar; opens the admin Dialog.

#### Phase 4: Verification
- [x] `pnpm tsc --noEmit` clean.
- [x] `pnpm test` clean.
- [x] `pnpm dev` smoke: add a stat-holiday range, a coach-unavailable range, a company-closure range; confirm each renders on the calendar with the right styling; archive one and confirm it disappears.
  - Signed-in smoke passed via `inject-supabase` as `david.hogan@networknode.ca`; temporary blocks were archived after verification.
