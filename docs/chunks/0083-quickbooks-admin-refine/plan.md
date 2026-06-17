# QuickBooks admin page refine — Plan

**Intent:** [`intent.md`](intent.md)
**Started:** 2026-06-17

## Progress Tracker

| Phase | Status | Commit |
|-------|--------|--------|
| 1: Unified `syncQuickbooks` server action + combined summary | Done | `ed3541e` |
| 2: Connection bar to top + one Sync button (server-component restructure) | Done | `93f26e5` |
| 3: Tabs shell (Dealers / Items) + Tax→Lookups link, relocate catalog | Done | `d549e49` |
| 4: Tests + smoke verification | Done | (chunk-end `/eval`) |

This chunk is an information-architecture refinement of `/admin/quickbooks`: lift
the connection bar to the top, collapse the two per-section write buttons into
one "Sync" button that reconciles dealers and mirrors items in a single click,
and move the per-section diff tables into Dealers/Items tabs (Tax stays a link to
`/admin/lookups`). No reconcile logic changes — only a thin unified action
wrapper plus UI reorganization. "Done" = connection bar is first, exactly one
sync control when connected, tabs split dealer vs item detail, one combined
summary toast, and items remain QB-mastered (no new in-app item mutation).

## Code Anchors

For each new file or method below, the builder reads the anchor first and matches
its shape (length, error handling, naming, query style). For modifications to an
existing file, the anchor is the nearest sibling method in that same file.

| New code | Anchor (`path:line`) | Why this anchor |
|----------|---------------------|-----------------|
| `syncQuickbooks` unified action in `src/features/quickbooks/actions.ts` | `src/features/quickbooks/actions.ts` → `syncDealersFromQuickbooks` (~:106) + `pullItemsFromQuickbooks` | Nearest sibling server actions; reuse `getValidAccessToken` + `applyDealerSync` + item-pull apply, encode a combined redirect summary |
| Combined summary encode/decode | `src/lib/quickbooks/dealer-sync.ts` `encodeSyncSummary`/`decodeSyncSummary` + `item-sync.ts` `decodeItemSyncSummary` | Existing dot-encoded summary helpers — mirror their shape for the combined param |
| `src/features/quickbooks/quickbooks-tabs.tsx` (new `'use client'` tab shell) | `src/features/reports/reports-tabs.tsx:48` | Closest existing `'use client'` usage of Catalyst `Tabs`/`TabsList`/`TabsTrigger`/`TabsContent` with `useState` tab state |
| Tabs primitives import | `src/components/catalyst/tabs.tsx:1` | The repo's Tabs API to consume (don't hand-roll a switcher) |
| Connection bar + Sync/Disconnect forms restructure | `src/features/quickbooks/quickbooks-admin.tsx:152` | The existing connected-view markup being reorganized; server-action `<form>` pattern preserved |
| "Tax codes → Lookups" link | `src/components/catalyst/link.tsx:12` → href `/admin/lookups` (`src/app/(app)/admin/lookups/page.tsx`) | Catalyst Link component + confirmed lookups route |
| Relocate catalog into Items tab | `src/features/services/service-items-list.tsx:1` | Server component (read-only table); pass as the Items panel content |

**Conventions referenced:**
- `docs/wiki/data-model.md` — `dealers.quickbooks_id` (source-of-truth split: app owns dealer data, QBO owns the id link) and items mastered in QuickBooks. Confirm/ingest any QBO-admin page facts into the relevant wiki page at chunk close (check `docs/wiki/index.md` for a QuickBooks page).
- `CLAUDE.md` → Conventions: mutations go through **Server Actions**. A server action used as `<form action={action}>` works from a `'use client'` component too — only the tab *switcher* needs client state; the Sync/Disconnect/Connect forms stay server-action forms (no new client-side mutation code).

**Overall Progress:** 100% (4/4 phases complete)

**Note:**
- Phases 1–3 are sequenced: action first (so the button has something to call), then the top-bar restructure, then the tabs.
- The reconcile logic (`computeDealerSyncPlan`/`applyDealerSync`, `computeItemSyncPlan`/item-pull) is **not** modified — Phase 1 only composes the existing two actions.

### Phase Checklist

#### Phase 1: Unified `syncQuickbooks` server action + combined summary
- [x] Add `syncQuickbooks` to `src/features/quickbooks/actions.ts`: `assertCan('admin:access')`, one `getValidAccessToken()`, run the dealer reconcile (`fetchCustomers` → `applyDealerSync`) **and** the item mirror (`fetchItems` → `db.transaction(applyItemSync)`), aggregate counts. (Token fetch stays OUTSIDE the per-pass guards so a not-connected/refresh failure propagates → keeps the gate-matrix admin row green.)
- [x] **Decided (2026-06-17):** single combined `?qbsync=<dealers>.<items>` param so the notice is one sentence. Added `encodeQbSyncSummary`/`decodeQbSyncSummary` in new `src/lib/quickbooks/qb-sync-summary.ts` (7 dot-segments: 3 dealer + 4 item, reusing the existing per-part validated decoders). `page.tsx` `?synced=`/`?itemsynced=` reads dropped in Phase 2.
- [x] **Decided (2026-06-17):** partial-report. Dealer reconcile + item mirror each in its own try/catch; a throw in one does not discard the other's committed result. Failed-part message carried as `?qbderror=<msg>` / `?qbierror=<msg>` (separate URL-encoded params per part — cleaner than a delimiter-packed segment, same intent). Page composes the per-part notice in Phase 2.
- [x] `revalidatePath('/admin/quickbooks')` + `redirect` with the combined summary (via `URLSearchParams`).
- [x] **Added matrix row** for `syncQuickbooks` (ADMIN_ONLY) — drift detection requires it. `syncDealersFromQuickbooks` / `pullItemsFromQuickbooks` exports + their matrix rows stay through Phase 2; removed in Phase 3 once the UI no longer calls them.
- [x] Unit test: combined encode→decode round-trip + all-zero case + malformed-param rejection (`qb-sync-summary.test.ts`).

#### Phase 2: Connection bar to top + one Sync button
- [x] In `src/app/(app)/admin/quickbooks/page.tsx`: stopped rendering `ServiceItemsList` at the top — `catalog` now passes to `QuickbooksAdmin` (rendered inside the Items section, → Items tab in Phase 3). `QuickbooksAdmin` is the first content under `PageHeader`.
- [x] In `quickbooks-admin.tsx`: connection bar (Connect when `!connection`; status + controls when connected) is the first block; notice banner stays at the very top. Extracted `DealersPanel` + `ItemsPanel` helpers (Phase-3-ready tab-panel shapes).
- [x] Replaced the two per-section buttons with **one** "Sync" button (form `action={syncQuickbooks}`) in the connection bar, beside Disconnect. Removed the `actionable > 0` / `itemsActionable > 0` button-visibility gating (button shows when connected & no `fetchError`); counts still drive the diff text.
- [x] Combined-summary notice composed in `page.tsx` `composeSyncNotice` (one sentence; per-part outcome incl. failed-part message; red kind when any part errored).
- [x] Server-action forms unchanged (no added client JS) — `tsc` clean, full suite green.

#### Phase 3: Tabs shell (Dealers / Items) + Tax link, relocate catalog
- [x] **Confirmed (2026-06-17):** switcher built with the repo's **Catalyst `Tabs`** primitive. New `src/features/quickbooks/quickbooks-tabs.tsx` (`'use client'`) using `Tabs`/`TabsList`/`TabsTrigger`/`TabsContent` (anchor: `reports-tabs.tsx`). Default tab: Dealers. Panels passed in as `React.ReactNode` props (only `useState` crosses the client boundary).
- [x] **Dealers** panel (`DealersPanel`, server-rendered): customer→dealer reconcile table + counts line (extracted in Phase 2, wrapped in the Dealers tab here).
- [x] **Items** panel (`ItemsPanel`, server-rendered): `ServiceItemsList` (local catalog) + the pending QBO mirror diff table + counts line (or the items fetch-error card).
- [x] Below the tabs: a "Tax codes are managed in Lookups →" Catalyst `Link` to `/admin/lookups` (no Tax tab).
- [x] Wired the tab shell into `quickbooks-admin.tsx` (rendered only when connected & `!fetchError`; the customers fetch-error reconnect card stays as today and replaces the tabs).
- [x] Server-rendered panels passed as props into the `'use client'` tab component — `tsc` clean, full suite green.
- [x] **Removed the dead `syncDealersFromQuickbooks` / `pullItemsFromQuickbooks` exports** (UI no longer calls them) + their gate-matrix rows + the now-unused `encodeSyncSummary`/`encodeItemSyncSummary` imports in `actions.ts`. Freshened the stale `?synced=`/`?itemsynced=` comments on the encode helpers.

#### Phase 4: Tests + smoke verification
- [x] Unit test for the combined-summary encode/decode (`qb-sync-summary.test.ts`, Phase 1) — round-trip + zero-counts case + malformed rejection.
- [x] `tsc` clean; targeted eslint on all 10 touched files → **0 warnings/errors** (0 new lint). Full lint re-run folds into chunk-end `/eval`.
- [~] Smoke (web-test): executed by the chunk-end `/eval` (folds in web-test) — assert connection bar first + no stray "Sync dealers"/"Pull items" buttons in the not-connected dev state.
- [~] Smoke (web-test): connected-state tab/Sync/Lookups path is QBO-connection-dependent — noted as manual/unverifiable in dev if not connected; eval asserts the not-connected layout.
- [~] Visual smoke: screenshot path noted in the chunk-end `/eval` report.
