# 0087 — Phase-1 decision gate

**Resolved 2026-06-22** (owner answered via `/build` decision-gate prompt). These calls close
the [intent](intent.md) "Open questions" and fix the data model the rest of the chunk (and the
[0088 dashboard](../../0088-dealer-pipeline-dashboard/plan.md)) builds on.

## D1 — `pipeline_stage` enum → **full 9-stage list**

`new · researching · contacted · follow_up · meeting_booked · proposal_sent · negotiation ·
on_hold · lost`

- **Won is not a stage.** "Mark won" routes through `convertProspectToActive` (status→`active`
  + the 0084 QBO push). Pipeline and the commercial spine stay one system.
- `on_hold` and `lost` **are** stages (so the 0088 dashboard counts them).
- `lost` does **not** auto-archive — a lost dealer keeps its row + history; archiving stays the
  independent `archivable.archivedAt` action.
- pgEnum (stable set) per `db-conventions`. Order in the enum = funnel order (drives default
  sort / dashboard column order later).

## D2 — Owner picklist source → **coaches only**

`owner_id` is populated from the **coaches** list (`loadCoaches`), not all staff. (The plan's
lean was "all staff"; the owner chose coaches-only — the rep prospecting work is coach-owned,
[[project_coach_owned_business]].) The column is still a plain `uuid → auth.users` FK with
`ON DELETE SET NULL`; "coaches only" is enforced at the **picklist / Server Action** layer, not
the schema (a coach is an `auth.users` row, so the FK is unchanged and a future widening to all
staff needs no migration).

## D3 — Activity `kind` set → **call · email · meeting · note · other**

Five kinds incl. an `other` catch-all. pgEnum `dealer_activity_kind`.

## D4 — Log-an-activity → **does NOT append to `dealers.notes`**

The `dealer_activities` log **is** the trail now. `dealers.notes` stays for free-form context
(and the 0086 import block). Logging an activity inserts a `dealer_activities` row + stamps
`dealers.last_contacted_at`; it never mutates `notes`.

## D5 — 0086 backfill → **default the 188 imported prospects to `pipeline_stage='new'`**

Backfilled in the Phase-2 migration (constant `UPDATE … WHERE pipeline_stage IS NULL`, or the
column default does it). The cols are **nullable** (existing/active dealers don't need a stage),
but the 188 cold prospects start at `new` and otherwise idle (no owner / next action) so they
surface in the commitment queue's **idle** bucket immediately.

## Schema shape that follows (Phase 2)

- `dealers` (+ nullable): `pipeline_stage` (enum), `priority` (enum high/medium/low),
  `owner_id` (uuid→auth.users, set null), `next_action` (text), `next_action_at` (date),
  `last_contacted_at` (tstz), `stage_changed_at` (tstz). Indexes `(pipeline_stage)`,
  `(owner_id)`, `(next_action_at)`.
- `dealer_activities`: `id`, `dealer_id` (FK cascade), `kind` (enum), `note` (text null),
  `occurred_at` (tstz default now), `actors` + `timestamps`. Indexes `(dealer_id)`,
  `(created_by_id, occurred_at)`.

`stage_changed_at` is written here (on stage change) and **read by 0088** (stalled-in-stage
blocker) — added now so 0088 stays migration-free.
