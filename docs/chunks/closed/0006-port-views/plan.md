# Port the three views — 2026-04-30

Phase 4 of the legacy → Next.js migration tracked in `docs/chunks/0004-port-migration/plan.md`. The legacy single-file app exposes three tabs — Calendar, Production, Lists — over Google Sheets data; this chunk reproduces them on top of the new Postgres schema while the data still imports cleanly. Done = the three views are reachable from a tabbed shell at `/calendar`, `/production`, `/lists`, the calendar's slot-packing / ribbon-overlay algorithm matches legacy behavior pixel-for-pixel, and `?coach=<id>` works as a read-only public share URL (legacy parity).

Mutations are out of scope for this phase. Add/Edit/Delete on dealers, contacts, campaigns, blocked dates and the booking modal are read-only stubs (or hidden) — they land in Phase 5 of the migration tracker (feature-parity gap-close). The table shows what's in Postgres and the calendar shows what's been imported; that's the bar.

## Code Anchors

For each new file or method below, the builder reads the anchor first and matches its shape (length, error handling, naming, query style). For modifications to an existing file, the anchor is the nearest sibling method in that same file.

| New code | Anchor (`path:line`) | Why this anchor |
|----------|---------------------|-----------------|
| `src/app/(app)/layout.tsx` (route-group layout: header + tab nav, gates to logged-in user) | `src/app/layout.tsx:21` | Same shape: a layout that wraps children with shared chrome (currently `<SessionBanner/>`); we extend with header + tabs nav. |
| `src/app/(app)/page.tsx` (redirect `/` → `/calendar`) | `src/app/login/page.tsx:10` | Same shape: a server page that calls `getUser()` then `redirect()` on a condition. |
| `src/app/(app)/calendar/page.tsx` (server: fetch coaches + campaigns + availability blocks; render `<CalendarView/>`) | `src/app/page.tsx:4` | Same shape: async server component that calls `getUser()` then renders a feature component. Add Drizzle `db.select(...)` queries before the return. |
| `src/app/(app)/calendar/calendar-view.tsx` (client: month state, slot-packing, ribbon overlay) | `src/features/ping/ping.tsx:1` | Only existing `'use client'` component in the repo. Same shape: client component receiving server-fetched data, holding small piece of UI state. The ribbon-packing block ports verbatim from legacy `deprecated/index.html` `renderCalendar` (≈line 1496) and `drawRibbons` (≈line 1631); only the data shape changes (events → campaigns, clients → dealers, coaches → contacts-with-coach-role). |
| `src/app/(app)/production/page.tsx` (server: campaigns table + filter via search params) | `src/app/page.tsx:4` | Same shape: async server component fetching via Drizzle and rendering JSX. Filter input is a small `'use client'` form component co-located. |
| `src/app/(app)/production/production-filters.tsx` (client: search + status `<select/>` that submit on change) | `src/features/ping/ping.tsx:1` | Only existing client component; same `'use client'` + `useTransition` pattern, but here the action is `router.replace(?...)` rather than a server action. |
| `src/app/(app)/lists/page.tsx` (server: dealers + coaches two-column read-only view) | `src/app/page.tsx:4` | Same shape: async server component fetching via Drizzle. |
| `src/app/share/coach/[id]/page.tsx` (public read-only calendar filtered to one coach) | `src/app/(app)/calendar/page.tsx:1` | Same fetch shape minus `getUser()`, dynamic-route param for coach id. Reuses `<CalendarView/>` in a "no nav, no admin actions" mode. |
| `src/features/schedule/queries.ts` (shared Drizzle queries: `loadCoaches`, `loadDealers`, `loadCampaigns`, `loadAvailabilityBlocks`) | `scripts/import-from-sheets.ts:1` | The only existing call site that uses Drizzle with `inArray` / `eq` / `and` against the new schema; same import style and result-shaping idiom. |
| Modify `src/lib/supabase/middleware.ts` `PUBLIC_PATHS` (allowlist `/share/coach/...`) | `src/lib/supabase/middleware.ts:4` | The constant and the `isPublicPath` predicate already enforce this exact pattern; just append `/share/coach`. |

**Conventions referenced:**
- `docs/wiki/architecture.md` — feature folders, route handlers vs server actions (this phase has no mutations, so no Server Actions land yet — but the `(app)` route group reflects the "feature folders + shared chrome" pattern).
- `docs/wiki/data-model.md` — coaches are `contacts` rows that have a `team_member_roles(role='coach')` row. Querying coaches always joins through that junction. Primary email/phone come from `contact_identifiers WHERE is_primary AND archived_at IS NULL`.
- `docs/wiki/auth.md` — middleware-level route gating; `(app)` group sits behind it, `share/coach/[id]` opts out via the `PUBLIC_PATHS` allowlist.
- `docs/wiki/conventions.md` — Drizzle for server SQL; supabase-js for auth/session reads.

## Progress Tracker

| Phase | Status | Commit |
|-------|--------|--------|
| 1: Shell + tab nav (route group, redirects, header) | Done | `68ef580` |
| 2: Lists view (dealers + coaches, read-only) | Done | `68ef580` |
| 3: Production view (campaigns table + filters) | Done | `68ef580` |
| 4: Calendar view (slot-packing + ribbon overlay) | Done | `68ef580` |
| 5: `?coach=<id>` public share route | Done | `68ef580` — implemented as `/share/coach/[id]` |
| 6: Verification (tsc + vitest + manual dev-server smoke test) | Done | `68ef580` |

**Overall Progress:** 100% (6/6 phases complete)

**Note:**
- This phase ships read-only views over already-imported data. No mutations land here; any "Edit"/"Delete"/"+ Add" buttons in the legacy UI become hidden or disabled stubs.
- The calendar's slot-packing algorithm ports verbatim from legacy `renderCalendar` / `drawRibbons` (only data shape differs). Pixel constants (`MAX_RIBBONS=10`, `RIBBON_H=22`, `RIBBON_GAP=3`, `TOP_PAD=26`) carry over unchanged.
- The legacy app uses a navy/cream theme with custom CSS variables; the new app uses Tailwind with the default zinc palette. Visual fidelity is "structural parity" — same layout, same affordances — not pixel-perfect color matching.

### Phase Checklist

#### Phase 1: Shell + tab nav
- [ ] Create `src/app/(app)/layout.tsx` — header (app name + sign-out) + tabs nav (Calendar / Production / Lists) + `getUser()` gate.
- [ ] Create `src/app/(app)/page.tsx` — redirect to `/calendar`.
- [ ] Move root layout's `<SessionBanner/>` out so it doesn't double-render under `(app)/layout.tsx`. Keep it on `/login` and other public routes if it makes sense, otherwise drop.
- [ ] Delete the legacy `Ping` placeholder (`src/features/ping/`) and remove its import from `src/app/page.tsx`. Replace `src/app/page.tsx` with a redirect to `/calendar` (or delete and let `(app)/page.tsx` cover `/`).
- [ ] Verify `pnpm tsc --noEmit` passes.

#### Phase 2: Lists view
- [ ] Create `src/features/schedule/queries.ts` with `loadDealers()` and `loadCoaches()` returning shape: `{ id, name/firstName+lastName, primaryEmail, primaryPhone, address?, specialty? }`.
- [ ] Coach query: inner-join `team_member_roles` on `role='coach' AND archived_at IS NULL`, left-join one primary identifier per kind via subquery (or fetch identifiers for all coach contact ids and merge in JS — simpler, fine at this scale).
- [ ] Create `src/app/(app)/lists/page.tsx` — two-column grid (dealers / coaches), card per list with header + body, list rows showing name + primary identifier(s) + address/specialty.
- [ ] Empty-state placeholders matching legacy ("No clients yet" / "No coaches yet").
- [ ] Hide Edit/Delete/+Add controls (or render disabled with a note that mutations land in a later phase).

#### Phase 3: Production view
- [ ] Add `loadCampaigns()` to `src/features/schedule/queries.ts` returning campaign rows joined to dealer name + coach name + style label.
- [ ] Create `src/app/(app)/production/page.tsx` — fetch campaigns; read `?q=` and `?status=upcoming|past` from `searchParams`; filter in JS or in SQL.
- [ ] Create `src/app/(app)/production/production-filters.tsx` (`'use client'`) — search input + status select; uses `useRouter().replace(...)` with debounced search and immediate select changes.
- [ ] Render the production table: Date range, Dealer, Contact (campaign.contact / phone / email inline), Format, Data Source, Qty Records, SMS/Email, Letters, BDC, Coach, Notes. Status badge (Upcoming / Live / Past) computed from now vs start/end.
- [ ] Empty state when filtered result is zero.
- [ ] No Refresh / Export CSV / Print / Sync Sheet buttons in this phase (they're legacy-Sheets-bound or land later).

#### Phase 4: Calendar view
- [ ] Add `loadAvailabilityBlocks(monthStart, monthEnd)` to queries.
- [ ] Create `src/app/(app)/calendar/page.tsx` — server fetch of coaches, campaigns (whole month +/- 6 weeks for ribbon overflow), availability blocks (same range). Pass to `<CalendarView/>`.
- [ ] Create `src/app/(app)/calendar/calendar-view.tsx` (`'use client'`):
  - [ ] Month-and-year local state, prev/next month buttons, month label.
  - [ ] 7-column grid of 6 weeks of `cal-day` cells (with `other-month`, `today`, `blocked`, `selected-range` markers).
  - [ ] Coach filter pills (legacy `renderCoachFilter`), driven by which coaches have campaigns in the visible month.
  - [ ] Slot-packing: per-row independent assignment, lowest-available slot, `MAX_RIBBONS=10`, `_rowSlotAssigned[row]` map. (Verbatim port from legacy lines ~1542–1593.)
  - [ ] Ribbon overlay: absolutely positioned bars sized via `getBoundingClientRect()` + offsets, recomputed on resize. (Verbatim port from legacy `drawRibbons` ~lines 1631–1670.)
  - [ ] Stats row (This Month, Total, Active Coaches, Active Clients) — server-rendered counts passed in as props.
  - [ ] Click on a ribbon → drawer/modal showing campaign detail; click on a day → no-op for now (booking modal lands in chunk 5.2 of the migration tracker).
- [ ] Resize listener that recomputes ribbon positions.
- [ ] Verify a representative imported month renders without overlapping ribbons (pre-cutover the imported corpus is enough to exercise overlapping bookings).

#### Phase 5: `?coach=<id>` public share route
- [ ] Create `src/app/share/coach/[id]/page.tsx` — accepts `id` as a contact bigint; resolves the coach (must have `team_member_roles(role='coach')`), 404 otherwise. Fetches campaigns/availability filtered to that coach. Renders `<CalendarView/>` in `share` mode (no nav, no add/edit affordances, no stats row).
- [ ] Add `/share/coach` to `PUBLIC_PATHS` in `src/lib/supabase/middleware.ts`.
- [ ] Add `mode?: 'app' | 'share'` prop to `<CalendarView/>` to suppress filter pills, click-to-book, and any admin chrome in share mode.
- [ ] Smoke-test: open `/share/coach/<id>` in an incognito window — should render without redirecting to `/login`.

#### Phase 6: Verification
- [ ] `pnpm tsc --noEmit` clean.
- [ ] `pnpm test` clean (existing `safeNextPath` redirect tests still pass; no new tests required for read-only views — write a small unit test only if the slot-packing algorithm gets factored into a pure function worth covering separately).
- [ ] `pnpm dev` smoke test:
  - [ ] `/` → redirects to `/calendar`.
  - [ ] `/calendar` renders, prev/next month navigates, ribbons appear over imported campaigns, coach filter pills toggle.
  - [ ] `/production` renders the table, search filters, status select filters.
  - [ ] `/lists` shows dealers + coaches with primary contact info.
  - [ ] `/share/coach/<imported-coach-id>` renders without auth, no nav.
- [ ] Update `docs/chunks/0004-port-migration/plan.md` Phase 4 row → Done with this commit's SHA, recompute Overall Progress to 57% (4/7).
- [ ] Update `docs/wiki/log.md` with one-line entry; create or amend a wiki page if the slot-packing algorithm warrants its own concept page (`docs/wiki/calendar-algorithm.md`, listed as a candidate in `docs/wiki/index.md`).
