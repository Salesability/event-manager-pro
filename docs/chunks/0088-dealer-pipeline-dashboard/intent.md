# Dealer pipeline — management dashboard — Intent

**Created:** 2026-06-19 (split out of [`0087-dealer-pipeline`](../closed/0087-dealer-pipeline/plan.md) — the rep operational layer). **Depends on 0087** (reads its schema; **no migration of its own**).

## Problem

[0087](../closed/0087-dealer-pipeline/plan.md) gives **reps** the tools to work prospects (stage,
commitment/next-action, owner, and a `dealer_activities` touch-log) — but **management** has
no view over it. They want to **see progress *and* understand why it stalls** — exactly what
the BD-tracker spreadsheet's Dashboard tab gave them, now over live app data:

- *Where is everything?* — the funnel (how many prospects in each stage).
- *Who's carrying what?* — pipeline + workload by owner.
- *How much work is happening?* — activity counts (calls/emails/meetings logged).
- *Why isn't a number moving?* — **blockers**: prospects stuck in a stage, gone stale, or
  with overdue commitments.

Without this, the effort + progress is invisible to management and reporting falls back to a
spreadsheet, disconnected from the live pipeline.

## Desired outcome

A **read-only management dashboard** over 0087's data (no new schema):

- **N-by-stage** — the funnel coverage (`new … negotiation`, `on_hold`, `lost`; plus a
  converted/`won` count from `status='active'`).
- **By-owner** — stage breakdown + workload per rep (and unassigned).
- **Activity counts** — from `dealer_activities`: touches logged by **owner**, **period**
  (this week / last 30 days), and **kind** (call/email/meeting/note).
- **Blockers** — the "why no progress" view:
  - **Stalled in stage** — `stage_changed_at` older than a threshold (long time in one stage).
  - **Stale** — no touch (`last_contacted_at`) in N days.
  - **Overdue commitments** — `next_action_at` past due, by owner.
- **Drill-through** — a count links to the 0087 `/dealerships` queue, pre-filtered (e.g.
  "12 overdue for Jane" → the filtered list).

Observable end state: management opens the dashboard and sees the funnel by stage + owner,
this week's activity, and the stalled/stale/overdue prospects that explain the numbers —
then clicks through to the exact list to act.

## Non-goals (v1 scope guard)

- **No schema changes** — purely reads 0087's `dealers` pipeline fields + `dealer_activities`.
- **No rich charts/BI** — count cards + simple bars/strips via the app's layout primitives;
  no charting library, no pivot builder.
- **No CSV/PDF export** — v2 if wanted.
- **No custom date-range picker** — fixed windows (this week / last 30 days); custom ranges v2.
- **No Kanban board / drag-drop** — that's a separate view (v2).
- **No write actions** — the dashboard is read-only; edits happen in 0087's panel/queue.

## Success criteria

- A dashboard surface (page or `/dealerships` section — Phase-1 call) renders, for
  non-archived dealers:
  - N-by-stage and a by-owner breakdown,
  - activity counts by owner / period / kind (from `dealer_activities`),
  - blocker lists: stalled-in-stage, stale, overdue (with the thresholds from Phase 1).
- Each count drills through to the pre-filtered 0087 list.
- Aggregation queries are unit-tested (given fixture rows → expected counts); a web-test smoke
  renders the dashboard.
- Static gate green. **No migration.**

## Open questions (Phase-1 decision gate)

- **Surface** — dedicated page (`/dealerships/pipeline` or `/admin/pipeline`) vs a section on
  `/dealerships`. Lean: dedicated page.
- **Capability** — who sees it? Reuse a read capability (e.g. `dealer:read`/the dealer-list
  gate) vs an admin/manager-only gate. Lean: same gate as the dealer list (managers + coaches
  see it; coaches' "mine" filter narrows it).
- **Thresholds** — stale = N days without a touch (lean: 14); stalled = N days in stage (lean:
  21, or per-stage later). Confirm defaults; constants vs config.
- **Facet depth** — also by province / manufacturer (cheap; the fields exist) in v1, or just
  stage/owner/activity/blockers? Lean: stage/owner/activity/blockers in v1; province/mfr later.

## Why now

0087 will be producing live stage + activity data as reps work the 188 prospects; the point of
capturing it is for management to see progress + act on blockers. Build this once 0087 has
shipped and there's data to show.
