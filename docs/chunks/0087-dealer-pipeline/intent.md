# Dealer pipeline — commitments + progress dashboard — Intent

**Created:** 2026-06-19 · **Reframed twice (2026-06-19):** first from a pure stage funnel → a commitment tracker; then back to **both** — a rep commitment layer **and** a management progress/blocker dashboard backed by a real activity log. Folder slug kept (`0087-dealer-pipeline`); serial = identity.

## Problem

The app has a **deal/contract** spine (Quote → MSA → active → campaign → invoice) but **no
prospecting visibility**, and two distinct audiences need it once 0086's **188 cold
Atlantic prospects** are in the app:

- **Reps need to not drop the ball.** The thing that wins trust in outreach is *keeping the
  small promises* — "I'll call you Tuesday", "I'll send pricing Friday." Today those live
  in someone's head or a spreadsheet, and a dropped callback quietly kills the deal.
- **Management needs to see progress — and *why* it stalls.** Where is each prospect in the
  funnel? Who's carrying what? How much activity is happening? And critically, **where are
  prospects stuck** (blockers) so they can act on it. (This is what the team's BD-tracker
  spreadsheet Dashboard gave them; we're bringing it into the app.)

Dealer status is a binary `prospect | active` — no stage, owner, next-action, or activity
history to serve either need.

**Permission-to-contact is explicitly NOT modeled** — that's the rep's own judgment and
style (a free-text note at most). The system's job is reliability + visibility, not consent
enforcement.

## Desired outcome

A prospecting **pipeline on the dealer** with two lenses over one dataset:

**Rep lens — commitment tracker ("don't drop the ball"):**
- A current **next action** (free text — the rep's words) + **due date** + **owner**.
- **Log an activity** (call / email / meeting / note) — records what happened, stamps
  last-contacted, and the rep sets the next promise.
- A **commitment queue**: overdue (loud) / due-soon / idle (no next action), filtered to
  "mine."

**Management lens — progress + blocker dashboard:**
- **N-by-stage** (the funnel) and **by-owner** (pipeline + workload per rep).
- **Activity numbers** — true counts from the activity log ("23 calls / 5 emails this week
  by owner"), plus idle/never-touched counts.
- **Blockers** — where prospects are stuck: **stalled in a stage** (too long since the
  stage changed), **stale** (no touch in N days), **overdue commitments** (by owner).

**Shared model:**
- `pipeline_stage` (funnel position) — `new · researching · contacted · follow_up ·
  meeting_booked · proposal_sent · negotiation · on_hold · lost`. **Won is not a stage** —
  it's `status='active'` via `convertProspectToActive` (+ QBO push, 0084), so the pipeline
  and the commercial spine stay one system.
- `priority` (high/medium/low) — management's "high-priority targets."
- A **`dealer_activities` touch-log** (call/email/meeting/note + who + when + note) — the
  source of truth for activity counts and the per-dealer recent-activity list (a lite
  timeline; the rich timeline UI is v2).

Observable end state: a rep opens their follow-ups, sees who they owe a callback today,
logs the call, sets the next promise; management opens the pipeline dashboard and sees the
funnel by stage + owner, this week's activity, and the stalled/stale/overdue prospects that
explain why a number isn't moving.

## Non-goals (v1 scope guard)

- **No rich activity-timeline UI / Kanban board.** v1 logs activities + shows recent ones
  as a list + counts them; a drag-drop board and a full timeline view are **v2**.
- **No permission/consent modeling.** Rep's style — free-text note at most.
- **No outbound send** (email/SMS/calls). Logging records that a touch happened.
- **No automated stage transitions** from quote/MSA events (`quote.sent` → proposal_sent) —
  manual in v1; auto is v2.
- **No lead inbox / round-robin / multi-tenant.** Single-tenant; owner is a manual
  assignment ([[project_coach_owned_business]]).

## Success criteria

- A dealer carries settable `pipeline_stage`, `priority`, `owner_id`, `next_action`,
  `next_action_at`, `last_contacted_at`, `stage_changed_at` (all nullable), editable from
  the dealer panel via `dealer:edit`-gated Server Actions.
- A `dealer_activities` log captures each touch (kind + note + actor + timestamp); "log an
  activity" inserts a row and updates `last_contacted_at`.
- **Rep queue** on `/dealerships`: overdue / due-soon / idle, filterable to "mine."
- **Management dashboard**: N-by-stage, by-owner, activity counts (by owner / period /
  kind), and the blocker views (stalled / stale / overdue).
- **Mark won** reuses `convertProspectToActive` — no parallel status.
- Static gate green; new actions + the dashboard aggregations have unit tests + a web-test
  smoke driving the panel, the queue, and the dashboard.
- 0086's imported prospects appear as `new` / idle (the correct starting state); no
  backfill beyond defaulting stage (see Open questions).

## Open questions (Phase-1 decision gate)

- **Owner picklist source** — coaches only (`loadCoaches`) vs all staff (coaches + admins).
  Lean: all staff who can own a prospect.
- **Dashboard surface** — a dedicated page (`/dealerships/pipeline` or `/admin/pipeline`)
  vs a section on `/dealerships`. Lean: **dedicated page** (management "love this stuff" —
  give it room).
- **Activity `kind` set** — `call · email · meeting · note · other`? Confirm the list.
- **Stage defaulting / 0086** — default imported + new prospects to `new` (backfill the 188
  to `new`, or leave null = treated-as-new in the dashboard)? Lean: backfill `new` so the
  dashboard funnel reads cleanly.
- **Stage list + `on_hold`/`lost`** — confirm the enum; `on_hold`/`lost` are stages (so the
  dashboard counts them); `lost` does **not** auto-archive (stays countable). Confirm.
- **Split?** v1 is sizeable (commitment + activity log + dashboard). Option to ship the
  operational layer (stages + commitment + activity + panel + queue) first and the
  **dashboard as a fast-follow chunk** — decide at the gate.

## Why now

0086 put 188 cold prospects in the app. Reps need to work them without dropping promises,
and management needs to see the effort + progress + blockers — otherwise the outreach (and
its reporting) falls back to a disconnected spreadsheet, defeating the import.
