# Dealer pipeline (prospecting CRM-lite) — Intent

**Created:** 2026-06-19

## Problem

The app tracks a **deal/contract** funnel (Quote → MSA → accepted → active dealer
→ campaign → invoice — see [`commercial-spine.md`](../../wiki/commercial-spine.md))
but has **no prospecting funnel**. Dealer status is a binary `prospect | active`
(`dealers.status`); there's no stage, owner, priority, next-action, or activity
trail for working a cold prospect through outreach. With the Atlantic Canada BD
list (0086) bringing **281 prospects** into the app, the team needs somewhere to
track *where each prospect is* and *who's working it* — otherwise that lives in a
spreadsheet, disconnected from the dealer record, quotes, and QuickBooks.

The BD tracker's `Pipeline Stage / Priority / Owner / Last Contact / Next Action`
columns (dropped from the 0086 import because the schema has no home for them) are
exactly the gap this chunk fills.

## Desired outcome

A **CRM-lite pipeline on the dealer** — enough to run a real outreach effort from
inside the app, without building a full CRM:

- A **pipeline stage** on each dealer (top-of-funnel outreach stages that dovetail
  with the existing `prospect → active` status; "won" = the dealer converting to
  active via quote-accept, not a duplicate state).
- An **owner** (the coach/staff member working the prospect), a **priority**, a
  **next action + date**, and a **last-contacted** timestamp at the dealer level.
- A **per-dealer pipeline panel** on `/dealerships/[id]` to set stage/owner/priority/
  next-action and **log a touch** (one click → stamps last-contacted).
- **Stage / owner / priority columns + filters** on the `/dealerships` list so the
  team can work the board ("show me my Negotiation prospects").
- **Won wiring:** moving a prospect to "won" reuses `convertProspectToActive` (which
  already flips status + triggers the QBO push, 0084) — so the pipeline and the
  commercial spine stay one system, not two.

Observable end state: a coach opens `/dealerships`, filters to their prospects by
stage, opens one, advances its stage / logs a call / sets the next action — and
when it converts, marks it won (→ active → QBO), all without leaving the app.

## Non-goals (v1 scope guard)

- **No full activity-timeline table.** v1 uses dealer-level `last_contacted_at` +
  the `dealers.notes` field (0086). A dedicated `dealer_activities` table
  (timestamped call/email/meeting rows with actor + body) is a **v2** extension.
- **No Kanban/drag-drop board.** v1 is a **filterable list** + a detail panel; a
  visual board view is v2.
- **No automated stage transitions.** Stages are set manually; auto-syncing stage
  from quote/MSA events (e.g. `quote.sent` → "proposal sent") is v2.
- **No outbound send (email/SMS/calls) from the pipeline.** Logging a touch records
  that it happened; it doesn't send anything.
- **No lead inbox / round-robin / multi-tenant assignment.** Single-tenant,
  coach-owned (consistent with the app's model). Owner is a manual assignment.
- **No reporting/analytics beyond simple stage counts** (and even those are a
  decision-gate option, not committed).

## Success criteria

- A dealer carries a settable `pipeline_stage`, `owner`, `priority`,
  `next_action` (+ date), and `last_contacted_at`; all nullable, all editable from
  the dealer detail panel via capability-gated Server Actions.
- The `/dealerships` list shows stage/owner/priority and filters on them.
- "Mark won" on a prospect reuses `convertProspectToActive` (status → active, QBO
  push fires per 0084) — no parallel state.
- Static gate green (tsc + tests + 0 new lint); the new actions have unit tests +
  a web-test smoke driving the panel + list filter.
- Plays with 0086: imported prospects land at the initial stage (see Open
  questions — seed-vs-backfill depending on sequencing).

## Open questions (the Phase-1 decision gate resolves these)

- **Stage set + status relationship.** Draft from the BD tracker:
  `new → researching → contacted → follow_up → meeting_booked → proposal_sent →
  negotiation → on_hold → lost`. "Won" is *not* a stage — it's `status='active'`
  (via convert). Confirm the list, whether `lost`/`on_hold` are stages vs flags,
  and whether `lost` also archives the dealer or just parks it.
- **Owner FK target.** `auth.users` uuid (reuse the actor/`createdById` pattern;
  coaches have auth users) vs a `contacts` FK. Lean: `auth.users` uuid.
- **Fields-on-dealer vs an activity table.** v1 = columns on `dealers` (cheapest,
  gets the board working). Confirm we defer `dealer_activities` to v2.
- **Stage-count dashboard?** A small "N by stage" strip on `/dealerships` (the BD
  tracker had a dashboard) — in v1 or deferred?
- **Default stage + 0086 sequencing.** If this ships **before** 0086's prod load,
  the importer seeds `pipeline_stage` (+ owner/priority from the sheet — we'd
  *un-drop* those columns). If **after**, backfill imported prospects to the
  initial stage (`new`). Decide the order with the owner.
- **Does the stage apply to active dealers too?** Lean: stage is a prospect concern;
  once `active`, the pipeline is "won" and the panel hides/locks the stage. Confirm.

## Why now

0086 is about to put 281 cold prospects into the app. Without a pipeline they're an
undifferentiated pool and the real outreach tracking stays in a spreadsheet —
defeating the point of importing them. Building the pipeline now (and deciding
whether it precedes 0086's prod load so the import can seed stages) keeps the
prospecting effort inside the app, connected to quotes/MSA/QuickBooks.
