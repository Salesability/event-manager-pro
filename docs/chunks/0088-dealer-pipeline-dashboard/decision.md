# 0088 Dealer pipeline dashboard — Decisions

**Phase 1 decision gate.** Owner calls made 2026-07-06 (via `/build`). All four landed
on the plan's leans; one clarification recorded (D2). No schema — reads
[0087](../closed/0087-dealer-pipeline/plan.md)'s `dealers` pipeline fields + `dealer_activities`.

## D1 — Surface: dedicated page at `/dealerships/pipeline`

A **dedicated route**, not a section folded into the `/dealerships` queue. Keeps the
rep-facing queue focused on *working* prospects; management gets its own overview page.

- **Path:** `src/app/(app)/dealerships/pipeline/page.tsx` → `/dealerships/pipeline`.
  Chosen over `/admin/pipeline` so the dashboard sits **adjacent to the queue it drills
  through to** (`/dealerships?status=prospect&…`).
- **Safe against the `[id]` route.** Next.js App Router resolves the **static** `pipeline`
  segment before the sibling dynamic `[id]` segment, so `/dealerships/pipeline` always hits
  the dashboard (never `[id]` with `id="pipeline"`). Dealer ids are never the literal string
  `pipeline` regardless.
- **Edge gate inherited.** `ADMIN_PATHS` includes `/dealerships` (prefix match — see
  [auth.md](../../wiki/auth.md) §Route gating), so `/dealerships/pipeline` inherits the edge
  admin gate automatically — same as the queue.

## D2 — Capability: `admin:access` (reuse the dealer-list gate, no new matrix row)

Reuse the **exact gate the `/dealerships` list already uses** — `assertCan('admin:access')`
at the top of the page. **No new capability, no new gate-matrix row.**

> **Clarification vs the Phase-1 question wording.** The option was framed as "coaches see
> it too, narrowed to *mine*." That framing was inaccurate for this repo: `admin:access` is
> **admin-only** (`can(coachProfile, 'admin:access') === false` —
> [capabilities.test.ts](../../../src/lib/auth/capabilities.test.ts)), and the whole
> `/dealerships` surface is already admin-gated. So the dashboard is **admin-only**, exactly
> like the queue it summarizes — which is the substance of the choice ("same as the dealer
> list"). The **by-owner** facet still breaks workload down per rep *for the admin viewer*;
> there is simply no coach-facing "mine" view because coaches can't reach `/dealerships` at
> all today. If coach read-access to the pipeline is wanted later, that's a separate
> capability chunk (a `pipeline:view` cap + edge/nav changes), out of 0088 scope.

## D3 — Blocker thresholds (hard-coded constants in v1)

Defined as module constants (config UI is a later chunk):

| Blocker | Rule | Threshold |
|---------|------|-----------|
| **Stalled** | `stage_changed_at` older than N days (long time in one stage) | **21 days** |
| **Stale** | `last_contacted_at` older than N days **or null** (never touched) | **14 days** |
| **Overdue** | `next_action_at` earlier than today (past-due commitment) | today (no window) |

- Non-archived, `status='prospect'` dealers only (active dealers have converted → not a
  pipeline blocker). Matches the queue's scope.
- **"Today" is the server-timezone (UTC) date** at request time — the dashboard is a
  server component with no viewer timezone available (the queue computes viewer-local
  `localTodayIso()` *client-side*, which a server render can't replicate). During Atlantic
  business hours the UTC date equals the local date; only in the late evening (after the UTC
  midnight rollover) can the dashboard's overdue *count* run one day ahead of a viewer's local
  reckoning. That's acceptable because the **queue stays the authoritative per-viewer view**;
  the dashboard is a management overview. (Reconciled after Codex 0088 Medium flagged the
  earlier "agrees with the queue" claim as contradicting the UTC implementation.)

## D4 — Facet depth (v1)

Four facets, matching the intent:

1. **N-by-stage** — non-archived prospects grouped by `pipeline_stage`, plus a converted
   count (`status='active'`, non-archived) shown as `won`.
2. **By-owner** — stage × owner counts + workload per owner, plus an **unassigned** bucket
   (`owner_id IS NULL`).
3. **Activity counts** — from `dealer_activities`, grouped by `created_by_id` + `kind`
   (call/email/meeting/note/other) over **this week** and **last 30 days**.
4. **Blockers** — the D3 stalled / stale / overdue lists (count + a short drill list each).

**Deferred to a later chunk (v1 excludes):** province / manufacturer breakdowns, charts/BI,
CSV/PDF export, custom date ranges, and a Kanban board.

## Drill-through contract (Phase 3 will build hrefs to these)

Every count links to the pre-filtered `/dealerships` queue via its existing URL params
(confirmed in [dealers-admin.tsx](../../../src/features/dealers/dealers-admin.tsx) —
`QUEUE_PARAMS = ['due','mine','idle','stage','priority']`, all Prospect-view-only):

| Dashboard count | Href |
|-----------------|------|
| A stage's funnel count | `/dealerships?status=prospect&stage=<stage>` |
| An owner's workload | `/dealerships?status=prospect&mine=1` (own) — cross-owner deep-links need a per-owner param 0087 doesn't expose yet; v1 links owner rows to the unfiltered prospect queue |
| Overdue blocker | `/dealerships?status=prospect&due=overdue` |
| Stale blocker | `/dealerships?status=prospect` — the queue has **no touch-based (stale) filter**; its `idle=1` means *no commitment* (`isIdle(nextAction)`), a **different set**, so linking there would mislead (Codex 0088 Medium). Card header → unfiltered prospect queue; blocker rows deep-link the exact dealer. |
| Stalled blocker | no dedicated queue param today → card header links to `?status=prospect` |

> **Open note for Phase 2/3:** the queue has no *by-specific-owner* param (only `mine=1`
> = current user) and no *stalled* param. Where an exact pre-filter doesn't exist, link to
> the nearest available filter rather than inventing a queue param this chunk (adding queue
> params is 0087's surface, not 0088's). Revisit if the owner wants exact drill-through.
