# Dealer pipeline — management dashboard — Plan

**Intent:** [`intent.md`](intent.md)
**Started:** _scaffolded 2026-06-19 as the fast-follow to [`0087-dealer-pipeline`](../closed/0087-dealer-pipeline/plan.md). **Blocked on 0087** (reads its schema). No migration of its own._

> **Status note:** **not active** + **depends on 0087** — don't build until 0087 has shipped
> the `dealers` pipeline fields + the `dealer_activities` table. Read-only/UI-only chunk.

## Progress Tracker

| Phase | Status | Commit |
|-------|--------|--------|
| 1: Decision gate — surface, capability, thresholds, facet depth | Done | - |
| 2: Aggregation queries (by-stage, by-owner, activity counts, blocker lists) | Done | `a7bd70a` |
| 3: Dashboard UI (count cards/strips + drill-through to the 0087 queue) | Done | `c6f59b5` |
| 4: Tests + smoke | Done | (verify) |

A **read-only management dashboard** over 0087's data: N-by-stage (funnel), by-owner
(workload), activity counts (from `dealer_activities`, by owner/period/kind), and **blocker**
views (stalled-in-stage via `stage_changed_at`, stale via `last_contacted_at`, overdue via
`next_action_at`). Counts drill through to the pre-filtered 0087 `/dealerships` queue. **No
schema** (0087 owns it). v1 excludes charts/BI, CSV/PDF export, custom date ranges, and a
Kanban board (all later).

## Code Anchors

| New code | Anchor (`path:line`) | Why this anchor |
|----------|---------------------|-----------------|
| Pure aggregators (funnel / by-owner / activity / blockers) | **`src/features/dealers/dashboard.ts`** (new) + `dashboard.test.ts` | Counting lives in a **pure, fixture-testable module** (no DB); the loader below feeds it. Chose this over raw SQL groupBy so Phase-2 tests are plain unit tests, not DB-gated (prospect set is small — ~333 rows) |
| Dashboard loader (thin I/O) | **`src/features/schedule/queries.ts`** → `loadDealerPipelineDashboard()` (new) | Composes `loadDealers()` (non-archived, carries pipeline fields + resolved owner names) + a 30-day `dealer_activities` window, then delegates to `dashboard.ts` |
| Threshold predicates + constants | **`src/features/dealers/pipeline.ts`** → `isStalled`/`isStale` + `STALLED_DAYS`(21)/`STALE_DAYS`(14) | Next to the existing client-safe `isOverdue`/`isIdle` queue helpers; keeps the decision.md D3 cutoffs in one place |
| Dashboard page route | an existing page under `src/app/(app)/admin/` (e.g. `admin/quickbooks/page.tsx`) — server component composing sections | Match the admin server-page shape (+ capability gate in the segment) |
| Count cards / strips + bars | `docs/wiki/layout.md` (`<Section>`/`<KeyValueStrip>`/`<ListToolbar>`) + `src/components/app/status-badge.tsx` (stage badge from 0087) | Compose count cards from the layout primitives; reuse `PipelineStageBadge` |
| Drill-through links → 0087 queue | `src/features/dealers/dealers-admin.tsx` (the URL-driven filter params 0087 Phase 5 defines) | Build hrefs to the pre-filtered list (owner / due-bucket / stage) |
| Capability gate on the dashboard route/action | `docs/wiki/auth.md` (capability matrix) | Reuse the dealer-list read gate (Phase-1 call); add a matrix row if a new action |

**Conventions referenced:** `docs/wiki/data-model.md` (the 0087 pipeline fields + `dealer_activities`), `layout.md` (dashboard primitives), `auth.md` (gating), `commercial-spine.md` (won = `status='active'`, counted as converted).

**Overall Progress:** 100% (4/4 phases complete) — chunk-end `/eval` pending

**Note:**
- **No migration** — 0087 owns the schema (incl. `stage_changed_at` for the stalled-blocker).
- **Depends on 0087** — sequence after it ships.
- Thresholds (stale/stalled days) are constants in v1 (Phase-1 decides defaults); config is later.

### Phase Checklist

#### Phase 1: Decision gate — see [`decision.md`](decision.md)
- [x] **Surface** — dedicated page **`/dealerships/pipeline`** (D1; static segment beats sibling `[id]`, inherits the `/dealerships` edge admin gate).
- [x] **Capability** — reuse the dealer-list gate = **`admin:access`** (D2; admin-only, no new matrix row — the "coaches see mine" wording was inaccurate, clarified in decision.md).
- [x] **Thresholds** — stalled **21d** (`stage_changed_at`) · stale **14d or null** (`last_contacted_at`) · overdue = `next_action_at < today`; constants in v1 (D3).
- [x] **Facet depth** — stage / owner / activity / blockers in v1; province/manufacturer/charts/export/date-ranges/Kanban deferred (D4).

#### Phase 2: Aggregation queries
> **Design:** the counting is **pure functions** in [`dashboard.ts`](../../../src/features/dealers/dashboard.ts) (fixture-testable, no DB), with a thin `loadDealerPipelineDashboard()` loader in `schedule/queries.ts` that fetches `loadDealers()` + a 30-day activity window and delegates. Threshold predicates (`isStalled`/`isStale` + `STALLED_DAYS`/`STALE_DAYS`) live in the client-safe `pipeline.ts` next to `isOverdue`/`isIdle`.
- [x] `pipelineByStage()` — non-archived prospects grouped by `pipeline_stage` (all 9 stages, zeros incl.) + `totalProspects` + a `won` count from `status='active'`.
- [x] `pipelineByOwner()` — per-owner stage breakdown + total, null owner → 'Unassigned'; sorted total-desc.
- [x] `activityCounts()` — `dealer_activities` grouped by actor + kind over rolling last-7 / last-30-day windows.
- [x] `blockers()` — stalled (`stage_changed_at` > 21d), stale (`last_contacted_at` > 14d **or null**), overdue (`next_action_at` < today), each a worst-first list.
- [x] Unit tests on each aggregation + the threshold predicates (fixture rows → expected counts/buckets) — `dashboard.test.ts` + `pipeline.test.ts` (41 tests).

#### Phase 3: Dashboard UI
- [x] Dashboard page + view: funnel stat cards, by-owner table (+ stage breakdown), activity table (rep × this-week/last-30 + kind breakdown), blocker columns (stalled/stale/overdue, top-5 + "+N more"). New route `src/app/(app)/dealerships/pipeline/page.tsx` + server view `src/features/dealers/pipeline-dashboard.tsx`.
- [x] Drill-through: funnel → `?status=prospect&stage=`, stale → `&idle=1`, overdue → `&due=overdue`, blocker rows → `/dealerships/[id]`; per the decision.md drill-through contract. Added a "Pipeline dashboard →" entry point in the `/dealerships` header.
- [x] `assertCan('admin:access')` server-component gate (D2); reads `loadDealerPipelineDashboard()`. No client JS (all links) — no new gated action → no gate-matrix row.

#### Phase 4: Tests + smoke
- [x] Aggregation unit tests green (Phase 2) — 41 tests in `dashboard.test.ts` + `pipeline.test.ts`, full unit suite 1207 pass / 2 skip.
- [x] Drill-through filters match the 0087 queue's URL params (no dead links) — statically cross-checked: the dashboard emits `status=prospect` + `stage` / `due=overdue` / `idle=1` (all in the queue's `QUEUE_PARAMS`, always paired with `status=prospect` so the Prospect-only params take effect) + `/dealerships/[id]` blocker rows + bare `/dealerships` (won).
- [x] Smoke (web-test): runs at the chunk-end `/eval` (which folds in the browser smoke) — dashboard renders the funnel/owner/activity/blocker sections; a drill-through link lands on the pre-filtered queue. Read-only.
