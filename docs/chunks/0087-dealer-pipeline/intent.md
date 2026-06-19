# Dealer commitment tracker ("don't drop the ball") — Intent

**Created:** 2026-06-19 · **Reframed:** 2026-06-19 (after 0086 shipped + an owner reframe — this is a *promised-follow-up* tracker, not a stage funnel). Folder slug kept as `0087-dealer-pipeline` (serial = identity); the scope is the commitment tracker described here.

## Problem

The app tracks the **deal/contract** funnel (Quote → MSA → accepted → active → campaign →
invoice — see [`commercial-spine.md`](../../wiki/commercial-spine.md)) but has nothing to
help a salesperson **keep the small promises that win trust** — *"I'll call you back
Tuesday"*, *"I'll send pricing by Friday."* With 0086 putting **188 cold Atlantic
prospects** into the app, those commitments otherwise live in someone's head or a
spreadsheet, and a single dropped callback quietly erodes the relationship. Dealer status
is a binary `prospect | active` with no notion of *what did I commit to do next, and when.*

**This is NOT a CRM stage funnel.** An earlier sketch modeled a 9-stage pipeline
(`researching → contacted → negotiation …`). The owner's reframe: **the value is
reliability, not stage-reporting.** What matters is the *next promised action + its due
date*, surfaced so it never slips. How a rep manages **permission to contact** is their
own judgment and style — explicitly **out of scope to model** (a free-text note at most).

## Desired outcome

A **commitment tracker on the dealer** — the lightest thing that keeps promises from
slipping:

- A single **current next action** per dealer (**free text**, the rep's own words —
  "call back re: spring event", "send pricing"), with a **due date** and an **owner**.
- A **commitments queue**: **overdue** (loud — about to break a promise), **due
  today/soon**, and prospects with **no next action set** (idle — need a first step) —
  filtered to "mine."
- **Log a touch:** one click stamps **last-contacted** (and optionally appends a dated
  note), then the rep sets the next promised action.
- **Won** reuses `convertProspectToActive` (status → active + QBO push, 0084) — the
  prospecting effort and the commercial spine stay one system.

**States without an enum** (the reframe's elegance):
- **On hold** = just a **future-dated** next action ("revisit in Sept") → drops off
  today's queue, reappears when due.
- **Lost / dead** = **archive** the dealer (existing `archivedAt`) → off the queue.
- **Won** = `status='active'` via `convertProspectToActive`.

Observable end state: a coach opens their follow-ups, sees who they owe a callback today
(and what they're overdue on), opens a dealer, logs the call, sets the next promise — and
nothing they committed to quietly disappears.

## Non-goals (v1 scope guard)

- **No stage funnel / Kanban.** The next-action + date *is* the state.
- **No permission/consent modeling.** The rep's style — a free-text note at most.
- **No activity-history table** (`dealer_activities`). A single *current* action in v1;
  a timestamped call/email/meeting timeline is **v2**.
- **No outbound send** (email/SMS/calls). Logging a touch records that it happened; it
  doesn't send anything.
- **No priority field in v1.** The **due date is the priority**.
- **No automated next-action** from quote/MSA events (e.g. `quote.sent` → "follow up") —
  manual in v1; auto is v2.
- **No lead inbox / round-robin / multi-tenant.** Single-tenant; owner is a manual
  assignment (consistent with [[project_coach_owned_business]]).

## Success criteria

- A dealer carries settable `next_action` (text) + `next_action_at` (date) + `owner_id`
  + `last_contacted_at`; all nullable, editable from the dealer panel via
  capability-gated (`dealer:edit`) Server Actions.
- `/dealerships` surfaces the **commitment queue**: sort/filter by due (overdue / today /
  soon) + owner + "no next action" (idle); overdue is visually loud.
- **Log a touch** stamps `last_contacted_at` (+ optional note) and lets the rep set the
  next action.
- **Mark won** reuses `convertProspectToActive` — no parallel status path.
- Static gate green (tsc + tests + 0 new lint); new actions have unit tests + a web-test
  smoke driving the panel + the queue.
- Imported 0086 prospects appear as **"idle / no next action"** (the correct initial
  state — they need a first commitment); **no backfill required** (null = idle).

## Open questions (light — most settled in the reframe conversation)

- **Owner picklist source.** Coaches only (`loadCoaches`) vs **all staff** (coaches +
  admins) who can own a prospect. Lean: all staff.
- **Queue surface.** Integrated into `/dealerships` (commitment columns + due/owner/idle
  filters + sort + a small "overdue / due-today" strip) vs a dedicated "My follow-ups"
  page. Lean: **list-integrated for v1**; a dedicated page is a fast-follow if wanted.
- **Log-a-touch note.** Append to `dealers.notes` (0086) vs nothing in v1. Lean: optional
  append (a light trail without an activity table).

## Why now

0086 just put 188 cold prospects in the app. The point of importing them is to *work*
them — and what makes outreach work (and builds trust) is keeping the promises you make.
A lightweight commitment tracker turns the imported pool into a worked follow-up queue
without building a CRM.
