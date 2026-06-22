# Dealer pipeline — management dashboard — Plan

**Intent:** [`intent.md`](intent.md)
**Started:** _scaffolded 2026-06-19 as the fast-follow to [`0087-dealer-pipeline`](../closed/0087-dealer-pipeline/plan.md). **Blocked on 0087** (reads its schema). No migration of its own._

> **Status note:** **not active** + **depends on 0087** — don't build until 0087 has shipped
> the `dealers` pipeline fields + the `dealer_activities` table. Read-only/UI-only chunk.

## Progress Tracker

| Phase | Status | Commit |
|-------|--------|--------|
| 1: Decision gate — surface, capability, thresholds, facet depth | Pending | - |
| 2: Aggregation queries (by-stage, by-owner, activity counts, blocker lists) | Pending | - |
| 3: Dashboard UI (count cards/strips + drill-through to the 0087 queue) | Pending | - |
| 4: Tests + smoke | Pending | - |

A **read-only management dashboard** over 0087's data: N-by-stage (funnel), by-owner
(workload), activity counts (from `dealer_activities`, by owner/period/kind), and **blocker**
views (stalled-in-stage via `stage_changed_at`, stale via `last_contacted_at`, overdue via
`next_action_at`). Counts drill through to the pre-filtered 0087 `/dealerships` queue. **No
schema** (0087 owns it). v1 excludes charts/BI, CSV/PDF export, custom date ranges, and a
Kanban board (all later).

## Code Anchors

| New code | Anchor (`path:line`) | Why this anchor |
|----------|---------------------|-----------------|
| Aggregation queries (group-by counts; blocker lists) | `src/features/schedule/queries.ts` (existing `db.select(...).groupBy(...)` projections; 0087's pipeline projections) | Same query module + Drizzle aggregate/groupBy style; read 0087's fields |
| Dashboard page route | an existing page under `src/app/(app)/admin/` (e.g. `admin/quickbooks/page.tsx`) — server component composing sections | Match the admin server-page shape (+ capability gate in the segment) |
| Count cards / strips + bars | `docs/wiki/layout.md` (`<Section>`/`<KeyValueStrip>`/`<ListToolbar>`) + `src/components/app/status-badge.tsx` (stage badge from 0087) | Compose count cards from the layout primitives; reuse `PipelineStageBadge` |
| Drill-through links → 0087 queue | `src/features/dealers/dealers-admin.tsx` (the URL-driven filter params 0087 Phase 5 defines) | Build hrefs to the pre-filtered list (owner / due-bucket / stage) |
| Capability gate on the dashboard route/action | `docs/wiki/auth.md` (capability matrix) | Reuse the dealer-list read gate (Phase-1 call); add a matrix row if a new action |

**Conventions referenced:** `docs/wiki/data-model.md` (the 0087 pipeline fields + `dealer_activities`), `layout.md` (dashboard primitives), `auth.md` (gating), `commercial-spine.md` (won = `status='active'`, counted as converted).

**Overall Progress:** 0% (0/4 phases complete)

**Note:**
- **No migration** — 0087 owns the schema (incl. `stage_changed_at` for the stalled-blocker).
- **Depends on 0087** — sequence after it ships.
- Thresholds (stale/stalled days) are constants in v1 (Phase-1 decides defaults); config is later.

### Phase Checklist

#### Phase 1: Decision gate
- [ ] **Surface** — dedicated page (`/dealerships/pipeline` or `/admin/pipeline`) vs `/dealerships` section. Lean: dedicated page. Write `decision.md`.
- [ ] **Capability** — reuse the dealer-list read gate vs manager-only. Lean: same as the dealer list (coaches' "mine" narrows it).
- [ ] **Thresholds** — stale = N days (lean 14); stalled = N days in stage (lean 21). Confirm; constants vs config.
- [ ] **Facet depth** — stage/owner/activity/blockers in v1; province/manufacturer later? Confirm.

#### Phase 2: Aggregation queries
- [ ] `pipelineByStage()` — count non-archived dealers grouped by `pipeline_stage` (+ a converted/`won` count from `status='active'`).
- [ ] `pipelineByOwner()` — stage × owner counts + unassigned; workload per owner.
- [ ] `activityCounts({window})` — `dealer_activities` grouped by `created_by_id` + `kind` over this-week / last-30-days.
- [ ] `blockers()` — stalled (`stage_changed_at` < now - stalledDays), stale (`last_contacted_at` < now - staleDays or null), overdue (`next_action_at` < today), each as a count + a small list.
- [ ] Unit tests on each aggregation (fixture rows → expected counts/buckets).

#### Phase 3: Dashboard UI
- [ ] Dashboard page/section: stage funnel cards, by-owner table, activity-count strip (by owner/kind/period), blocker cards (stalled/stale/overdue).
- [ ] Each count is a link to the 0087 `/dealerships` queue, pre-filtered (owner / due-bucket / stage) via its URL params.
- [ ] Capability-gated per Phase 1; server component reading the Phase-2 queries.

#### Phase 4: Tests + smoke
- [ ] Aggregation unit tests green (Phase 2).
- [ ] Smoke (web-test): dashboard renders the stage/owner/activity/blocker cards; a count link navigates to the pre-filtered list. Read-only.
- [ ] Confirm drill-through filters match the 0087 queue's URL params (no dead links).
