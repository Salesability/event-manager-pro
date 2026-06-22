# Dealer pipeline — rep commitments + activity log — Intent

**Created:** 2026-06-19 · **Reframed (2026-06-19):** stage funnel → commitment tracker → two-lens pipeline → **split**. This chunk (0087) is the **rep operational layer + the shared data model**; the **management progress/blocker dashboard is split to [`0088-dealer-pipeline-dashboard`](../../0088-dealer-pipeline-dashboard/plan.md)** (a read-only fast-follow over this chunk's data). Folder slug kept; serial = identity.

## Problem

The app has a **deal/contract** spine (Quote → MSA → active → campaign → invoice) but **no
prospecting layer**, and with 0086's **188 cold Atlantic prospects** now in the app, reps
have nowhere to **keep the small promises that win trust** — *"I'll call you Tuesday"*,
*"I'll send pricing Friday."* Today those live in someone's head or a spreadsheet, and a
single dropped callback quietly kills the deal. Dealer status is a binary `prospect | active`
— no stage, owner, next-action, or activity history.

**Permission-to-contact is explicitly NOT modeled** — that's the rep's own judgment/style
(a free-text note at most). The system's job is reliability + a clean record of work done.

> **Why this is its own chunk:** the full pipeline (rep tools **+** a management dashboard
> over the same data) is sizeable. Shipping the **operational layer first** gets reps working
> the 188 prospects immediately; the **management dashboard ([0088](../../0088-dealer-pipeline-dashboard/plan.md))**
> follows once a week or two of activity has accrued to show. This chunk **owns the schema**
> (stages, commitment fields, the activity log) so 0088 is pure read/UI with no migration.

## Desired outcome

A prospecting **pipeline on the dealer**, rep-facing:

- A current **next action** (free text — the rep's words) + **due date** + **owner**.
- A **`pipeline_stage`** (funnel position: `new · researching · contacted · follow_up ·
  meeting_booked · proposal_sent · negotiation · on_hold · lost`) + **priority**
  (high/med/low). **Won is not a stage** — it's `status='active'` via
  `convertProspectToActive` (+ QBO push, 0084), so pipeline and the commercial spine stay
  one system.
- A **`dealer_activities` touch-log** — **log an activity** (call / email / meeting / note):
  records what happened (who + when + note), stamps `last_contacted_at`, and the rep sets the
  next promise. The panel shows the **recent activity** (a lite per-dealer timeline; the rich
  timeline UI is v2).
- A **commitment queue** on `/dealerships`: **overdue** (loud — about to break a promise) /
  **due-soon** / **idle** (no next action), filtered to "mine."

**States without extra machinery:** `on_hold`/`lost` are stages (so the future dashboard
counts them); `lost` does **not** auto-archive; won = `active`. `stage_changed_at` is stamped
on every stage change (written here; **consumed by the 0088 dashboard's "stalled in stage"
blocker** — added now so 0088 needs no migration).

Observable end state: a rep opens their follow-ups on `/dealerships`, sees who they owe a
callback today (and what's overdue), opens a dealer, logs the call, sets the next promise —
and nothing they committed to disappears.

## Non-goals (v1 scope guard)

- **No management dashboard here** — that's [0088](../../0088-dealer-pipeline-dashboard/plan.md)
  (N-by-stage / by-owner / activity counts / blocker views). This chunk only adds the data +
  rep tools the dashboard will read.
- **No rich timeline UI / Kanban.** v1 logs activities + shows a recent list; a board + full
  timeline are v2.
- **No permission/consent modeling.** Rep's style — free-text note at most.
- **No outbound send** (email/SMS/calls). Logging records that a touch happened.
- **No automated stage transitions** from quote/MSA events — manual; auto is v2.
- **No lead inbox / round-robin / multi-tenant** — single-tenant; owner is a manual
  assignment ([[project_coach_owned_business]]).

## Success criteria

- A dealer carries settable `pipeline_stage`, `priority`, `owner_id`, `next_action`,
  `next_action_at`, `last_contacted_at`, `stage_changed_at` (all nullable) via `dealer:edit`-
  gated Server Actions from the dealer panel.
- A `dealer_activities` log captures each touch (kind + note + actor + timestamp); "log an
  activity" inserts a row + updates `last_contacted_at`.
- **Rep queue** on `/dealerships`: overdue / due-soon / idle, filterable to "mine"; overdue
  is visually loud.
- **Mark won** reuses `convertProspectToActive` — no parallel status.
- Static gate green; new actions have unit tests + a web-test smoke driving the panel + queue.
- 0086's imported prospects backfilled to `pipeline_stage='new'` (and otherwise idle).

## Open questions (Phase-1 decision gate)

- **Owner picklist source** — coaches only (`loadCoaches`) vs all staff. Lean: all staff.
- **Activity `kind` set** — `call · email · meeting · note · other`? Confirm.
- **Stage list + `on_hold`/`lost`** — confirm the enum; `lost` does not auto-archive. Confirm.
- **Log-an-activity ⇒ also append to `dealers.notes`?** Lean: no — the activity log *is* the
  trail now (notes stays for free-form context).

## Why now

0086 put 188 cold prospects in the app; reps need to work them without dropping promises.
Ship the operational layer now; the management dashboard ([0088](../../0088-dealer-pipeline-dashboard/plan.md))
fast-follows once there's activity to report on.
