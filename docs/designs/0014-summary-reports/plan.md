# Booking summary & reports — 2026-04-30

Stub for sub-plan 5.7 of `docs/designs/0004-port-migration/plan.md`. Legacy `📊 Summary` button (`deprecated/index.html:278`) opens `summaryModal` (lines 552–574) — a four-tab analytics surface (`By Client`, `By Coach`, `By Month`, `Full Production Report`) with per-tab Print and Export CSV. Done = signed-in users see equivalent breakdowns rendered from the same Postgres data; each tab can be printed and CSV-exported.

Tabs (legacy semantics):
- **By Client** — campaigns grouped by dealer, count + total qty/SMS/letters per dealer.
- **By Coach** — campaigns grouped by coach, same totals.
- **By Month** — campaigns grouped by start-date month, same totals.
- **Full Production Report** — flat table identical to Production view, but in modal/print-friendly form.

## Progress Tracker

| Phase | Status | Commit |
|-------|--------|--------|
| 1: Aggregation queries (4 reports) | Pending | - |
| 2: Reports UI page (tabs + tables) | Pending | - |
| 3: Per-report Print + CSV export | Pending | - |
| 4: Verification (tsc + vitest + dev smoke) | Pending | - |

## Code Anchors

| New code | Anchor (`path:line`) | Why this anchor |
|----------|---------------------|-----------------|
| TBD when chunk is picked up | TBD | Server fetches model on `src/app/(app)/production/page.tsx`; tab UI on Base UI's `Tabs` primitive (introduced for the first time here — add a thin wrapper in `src/components/ui/tabs.tsx`). |

**Conventions referenced:**
- `docs/wiki/conventions.md` — Drizzle aggregations (`groupBy`, `count`, `sum`) instead of fetching campaigns and grouping in JS, where the row count justifies it.
- `docs/wiki/architecture.md` — A standalone route (`/reports`) is appropriate; this surface is large enough to deserve its own page rather than a modal in the new app.

**Overall Progress:** 0% (0/4 phases complete)

**Note:**
- Depends on 5.6 (CSV export pattern) and 5.1 (UI primitives — adds Tabs wrapper).
- New surface: render at `/reports` rather than as a modal. Modals are for inline edits; reports are a destination.
- `qty_records`/`sms_email`/`letters` are integers, all nullable — sums must coalesce nulls to 0.

### Phase Checklist

#### Phase 1: Aggregation queries
- [ ] Add `loadCampaignsByDealer`, `loadCampaignsByCoach`, `loadCampaignsByMonth` to `src/features/schedule/queries.ts`.
- [ ] Each returns `{ groupKey, groupLabel, count, totalQty, totalSms, totalLetters }`.

#### Phase 2: Reports UI
- [ ] New route `/reports` rendered as a server component fetching all four datasets in parallel.
- [ ] Tab switcher across the four reports; render each as a sortable table.

#### Phase 3: Print + CSV export
- [ ] Reuse the print stylesheet from 5.6.
- [ ] One CSV-export route per tab (`/reports/export?tab=client|coach|month|full`).

#### Phase 4: Verification
- [ ] `pnpm tsc --noEmit` clean.
- [ ] `pnpm test` clean.
- [ ] `pnpm dev` smoke: each tab renders correct totals against the imported corpus; CSVs match on-screen rows; print preview is clean.
