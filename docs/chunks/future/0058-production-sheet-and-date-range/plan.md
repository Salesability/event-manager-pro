# Production List: Shareable Google Sheet + Date-Range View — Plan

**Intent:** [`intent.md`](intent.md)
**Started:** _Phase 1 shipped 2026-05-22; Phases 2–4 deferred._

> **⏸ DEFERRED to `future/` 2026-05-22 (owner: "park 0058").** Phase 1 (the 1/2/3-month forward date-range filter) **shipped to `main` at `9b15e29`** — that code is live and stays merged; only the chunk *tracking* moved here. Phases 2–4 (the shareable Google Sheet) are deferred because they need (a) an owner decision on Google auth (service account vs user OAuth) and (b) Google Cloud setup only the owner can do (enable the Sheets/Drive API + provision credentials). **Un-defer trigger:** owner is ready to set up Google Cloud and has chosen the auth approach. When un-deferred, `mv` back to top level and resume at Phase 2.

> Two loosely-coupled deliverables in one chunk: the **date-range filter** (small, Phase 1 — DONE) and the **Google Sheet link** (larger — new Sheets API integration, Phases 2–3 — deferred). Split into two chunks if the Sheets auth work balloons.

## Progress Tracker

| Phase | Status | Commit |
|-------|--------|--------|
| 1: 1/2/3-month date-range option in the production filter | Done | `9b15e29` |
| 2: Google Sheets client + auth wiring (new) | Pending | - |
| 3: Export-to-Sheet action + shareable link on the production page | Pending | - |
| 4: Tests + smoke verification | Pending | - |

This chunk adds a near-horizon date-range scope to the production list and a path to view/share the list as a Google Sheet. "Done" looks like: the filter dropdown offers 1/2/3-month windows that correctly scope rows, and the production page exposes a shareable Sheet link whose columns match the existing export.

## Code Anchors

| New code | Anchor (`path:line`) | Why this anchor |
|----------|---------------------|-----------------|
| Date-range option in the filter dropdown | `src/app/(app)/production/production-admin.tsx:128-139` (status `<select>`) | Same control; extend with range choices + URL param |
| Date-range query scope | `src/features/schedule/queries.ts` (`loadFullProductionReport` / production load) | Where the campaign date filter applies server-side |
| Google Sheets client (new `src/lib/google/sheets.ts`) | `scripts/import-from-sheets.ts` (legacy `googleapis` usage) + `src/lib/storage/gcs.ts` (Google service-credential pattern) | Closest existing Google-API + service-credential shapes |
| Export-to-Sheet action | `src/app/(app)/production/export/route.ts` (CSV export — column shape) | Reuse the column set; mutation goes through a Server Action, not this route |
| Link surface on the page | `src/app/(app)/production/production-page-actions.tsx` (existing export/print actions) | Same action bar — add the "Open Sheet" affordance here |

**Conventions referenced:**
- `CLAUDE.md` → **Conventions** — the export-to-Sheet trigger is our own UI → **Server Action**, not a route handler.
- `db-conventions` — only if a `production_sheet_url` / sync-metadata column is added (decide in Phase 2).
- `docs/wiki/runbook.md` — document the Google service-account secret + API enablement once wired.

**Overall Progress:** 25% (1/4 phases complete)

**Note:**
- Phase 1 ships value on its own and has no external dependency — do it first. **✅ Shipped 2026-05-22.**
- Phases 2–3 need a Google Cloud decision (service account vs user OAuth) + Sheets/Drive API enablement; resolve the intent Open Questions with the owner before Phase 2. **⏸ PAUSED here — awaiting owner input (see Decisions needed).**

**Phase 1 decisions (2026-05-22):**
- **Client-side filter, not server-side** (deviates from the original checklist). The existing upcoming/past filter is client-side (TanStack `filterFn` closing over `todayIso`, mirrored in the CSV export route). `loadCampaigns()` already loads every row; adding a server-side scope for just the range would create a split filtering model. Matched the established pattern instead — extended the client `filterFn` + the export-route mirror, sharing only the date-window math (`rangeWindowEndIso` in `filter.ts`).
- **Reused the `?status=` URL param** (not a new `?range=`). `1m`/`2m`/`3m` join `''`/`upcoming`/`past` in the single Time-window dropdown, so one param drives one control. The intent's lean — *forward window from today, replacing the upcoming/past selection* — is exactly a single mutually-exclusive dropdown.
- **Forward-window semantics:** in-window = live/upcoming (`endDate >= today`) AND begins on or before the window closes (`startDate <= today + N months`). Month overflow rolls forward per `Date.setMonth` (documented + tested).

### Phase Checklist

#### Phase 1: Date-range filter ✅
- [x] Add 1/2/3-month options to the production filter dropdown — joined the existing `?status=` param (`1m|2m|3m`) in the single Time-window `<select>` (`production-admin.tsx`)
- [x] ~~server-side scope~~ **Client-side** `filterFn` (`production-columns.tsx`) + mirrored in the CSV export route (`export/route.ts`) — matches the established upcoming/past pattern; only `rangeWindowEndIso` date-math is shared (`filter.ts`)
- [x] Decide interaction with upcoming/past (replace vs combine) — **replace** (single dropdown, forward-window per intent lean)
- [x] Unit test: range scoping returns only in-window rows (`filter.test.ts`, 11 cases)

#### Phase 2: Google Sheets client + auth
- [ ] Decide service-account vs user-OAuth (intent Open Questions) with the owner
- [ ] Enable Sheets/Drive API; wire the credential as a secret (document in runbook)
- [ ] Add `src/lib/google/sheets.ts` — create-sheet + write-rows + set-permissions helpers
- [ ] Unit test: client builds the expected rows from production data (mock the API)

#### Phase 3: Export-to-Sheet + link
- [ ] Server Action: build production rows (reuse export column shape), create/refresh the Sheet, set sharing, return the link
- [ ] Surface "Open Sheet" / shareable link on the production page action bar
- [ ] Persist the Sheet URL if a canonical-sheet model is chosen (schema add via db-conventions)

#### Phase 4: Tests + smoke verification
- [ ] Smoke (web-test): `goto /production`; filter dropdown shows 1/2/3-month options + upcoming/past
- [ ] Smoke (web-test): selecting a range narrows the visible rows
- [ ] Integration: export-to-Sheet action builds correct rows (mocked Google API)
- [ ] Verify generated Sheet columns match the CSV export columns
