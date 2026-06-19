# Dealer pipeline — rep commitments + activity log — Plan

**Intent:** [`intent.md`](intent.md)
**Started:** _reframed + split 2026-06-19. This chunk = the rep operational layer + the shared data model; the management dashboard is [`0088-dealer-pipeline-dashboard`](../0088-dealer-pipeline-dashboard/plan.md). Ready to build pending the owner's go + the Phase-1 calls._

> **Status note:** **not active** — `CURRENT.md` Plan is `_None_`. Owns the schema (stages,
> commitment fields, `dealer_activities`) so 0088 needs no migration. 0086 sequencing
> resolved (prospects backfilled to `new`). Un-park by setting active + `/build`.

## Progress Tracker

| Phase | Status | Commit |
|-------|--------|--------|
| 1: Decision gate — stage list, owner source, activity kinds, notes-append | Pending | - |
| 2: Schema — pipeline/commitment fields on `dealers` + `dealer_activities` table | Pending | - |
| 3: Server actions + query projections (set pipeline/stage, log activity, won) | Pending | - |
| 4: Dealer-detail panel — stage + commitment + log-activity + recent-activity list | Pending | - |
| 5: Dealer-list commitment queue (columns + overdue/due/idle filters + sort) | Pending | - |
| 6: Tests + smoke | Pending | - |

The rep-facing prospecting layer: a per-dealer **next-action + due-date + owner + stage +
priority**, a **`dealer_activities` touch-log** (call/email/meeting/note → recent-activity
list + `last_contacted_at`), and an **overdue/due/idle commitment queue** on `/dealerships`
("don't drop the ball"). Won = `convertProspectToActive`. This chunk **owns the data model**
the [0088 dashboard](../0088-dealer-pipeline-dashboard/plan.md) reads (incl. `stage_changed_at`
for its stalled-blocker). v1 excludes the dashboard, a Kanban board, the rich timeline UI,
auto-stage, consent modeling, and outbound send (all later).

## Code Anchors

| New code | Anchor (`path:line`) | Why this anchor |
|----------|---------------------|-----------------|
| `pipeline_stage` + `priority` pgEnums; `owner_id` (uuid→`auth.users`), `next_action` (text), `next_action_at` (date), `last_contacted_at` + `stage_changed_at` (tstz) on `dealers` — all nullable | `src/lib/db/schema/dealers.ts` (`dealerStatus` pgEnum + the 0086 nullable cols; `actors` mixin = `auth.users` FK + `ON DELETE SET NULL` for `owner_id`) | Same enum + nullable-col + actor-FK patterns already in the file |
| `dealer_activities` table (`dealer_id` FK cascade, `kind` enum, `note` text, `occurred_at` tstz, `actors`+`timestamps`) | `src/lib/db/schema/dealer-contacts.ts` (a `dealers`-FK child table w/ `actors`/`timestamps`) + `src/lib/db/schema/quote-attachments.ts` (cascade row shape) | Mirror an existing dealer-child table; `created_by_id` = who logged it (0088 counts by it) |
| Migration `00NN_*` (cols + enums + table + indexes) | `drizzle/0041_strong_slyde.sql` + `drizzle/0038_daily_azazel.sql` (new-table migration) + **`db-conventions` skill** | Index `(pipeline_stage)`, `(owner_id)`, `(next_action_at)`, `dealer_activities(dealer_id)`, `(created_by_id, occurred_at)`; verify journal `when` ([[project_drizzle_journal_when_gotcha]]) |
| `setDealerPipeline` / `logDealerActivity` Server Actions + won→`convertProspectToActive` | `src/features/schedule/actions.ts` (`convertProspectToActive` + `updateDealer`; `capabilityClient('dealer:edit')`) | Match the dealer Server Action shape; reuse `dealer:edit` |
| `loadDealers`/`loadDealer` += pipeline fields + owner name | `src/features/schedule/queries.ts` (`loadDealer`/`loadDealers`; `loadCoaches` for owner names) | Extend the existing projections |
| Dealer-detail panel (stage + commitment + log-activity + recent list) | `src/features/quotes/dealer-quotes-panel.tsx` + `src/features/msa/msa-send-button.tsx` | Same per-dealer `<Section>` panel shape |
| List commitment columns + queue filters/sort | `src/features/dealers/dealers-columns.tsx` + `src/features/dealers/dealers-admin.tsx:74-82` | The list already has columns + URL-driven filter state |
| Stage `<Badge>` + overdue indicator | `src/components/app/status-badge.tsx` (`DealerStatusBadge`) | Mirror for `PipelineStageBadge` + overdue styling |
| Gate-matrix rows | `docs/wiki/auth.md` | Every new gated action gets a row |

**Conventions referenced:** `docs/wiki/data-model.md` (dealers shape; `dealer_contacts.lastContactedAt` precedent), `commercial-spine.md` (won = `convertProspectToActive`), `layout.md` (panel + list primitives), `auth.md` (gating + matrix), **`db-conventions` skill**.

**Overall Progress:** 0% (0/6 phases complete)

**Note:**
- **Migration expected** (Phase 2: 2 enums + ~7 nullable cols on `dealers` + the `dealer_activities` table + indexes). This chunk owns it; **0088 adds no migration**.
- `stage_changed_at` is written here (on stage change) but **read by 0088** (stalled-in-stage blocker) — added now to keep 0088 read-only.
- 0086 backfill: default the 188 imported prospects to `pipeline_stage='new'`.

### Phase Checklist

#### Phase 1: Decision gate
- [ ] **Stage enum** — confirm `new / researching / contacted / follow_up / meeting_booked / proposal_sent / negotiation / on_hold / lost`; won = `active` (not a stage); `on_hold`/`lost` are stages; `lost` does **not** auto-archive. Write `decision.md`.
- [ ] **Owner source** — coaches only vs all staff. Lean: all staff.
- [ ] **Activity `kind`** — `call / email / meeting / note / other`? Confirm.
- [ ] **Notes-append** — does log-activity also append to `dealers.notes`? Lean: no (the log is the trail).
- [ ] **0086 backfill** — default the 188 to `pipeline_stage='new'`.

#### Phase 2: Schema — fields + activity table
- [ ] Invoke the **`db-conventions`** skill first.
- [ ] `dealers` (+ nullable): `pipeline_stage` (new enum), `priority` (new enum), `owner_id` (uuid→`auth.users`, set null), `next_action` (text), `next_action_at` (date), `last_contacted_at` (tstz), `stage_changed_at` (tstz). Indexes `(pipeline_stage)`, `(owner_id)`, `(next_action_at)`.
- [ ] `dealer_activities`: `id`, `dealer_id` (FK cascade), `kind` (enum), `note` (text null), `occurred_at` (tstz, default now), `actors` + `timestamps`. Indexes `(dealer_id)`, `(created_by_id, occurred_at)`.
- [ ] `drizzle-kit generate`; verify journal `when`; apply **sandbox**; verify. Backfill 0086 prospects → `pipeline_stage='new'`.
- [ ] Update `docs/wiki/data-model.md` (dealers pipeline fields + the new table + enums).

#### Phase 3: Server actions + query projections
- [ ] `setDealerPipeline` (`dealer:edit`; patches stage/priority/owner/next_action/next_action_at; stamps `stage_changed_at` on stage change; omit-when-absent patch like `updateDealer`).
- [ ] `logDealerActivity` (`dealer:edit`; inserts a `dealer_activities` row (kind+note+occurred_at+actor); updates `dealers.last_contacted_at`; optionally sets the next action in the same call).
- [ ] **Won:** "Mark won" routes through `convertProspectToActive` (status→active + QBO push) — no new status logic.
- [ ] Extend `loadDealers`/`loadDealer` projections (pipeline fields + owner name); load recent activities for the panel.
- [ ] Gate-matrix rows (`docs/wiki/auth.md`). Unit tests (patch semantics, activity insert + last-contacted stamp, `stage_changed_at` on transition, won→convert reuse, capability deny).

#### Phase 4: Dealer-detail panel
- [ ] `DealerPipelinePanel` in a `<Section>` on `/dealerships/[id]`: stage dropdown (`PipelineStageBadge`), priority, owner select, next-action + due-date, last-contacted (relative); **Log activity** (kind + note); **recent-activity list** (last N); **Mark won** (prospect-only).
- [ ] RHF + zod + `<Field>`; shared Catalyst `Button`. Stage/commitment locked once `active`.

#### Phase 5: Dealer-list commitment queue
- [ ] Columns: stage / next-action / due-date / owner / priority; overdue rendered loud.
- [ ] URL-driven filters: owner ("mine"), due bucket (overdue/today/this-week), idle (no next action), stage, priority. Default sort by `next_action_at` (overdue first).

#### Phase 6: Tests + smoke
- [ ] Integration (real DB): set stage/commitment, log activities (counts + last-contacted), `stage_changed_at` on transition, won→active (push gated/mocked).
- [ ] Smoke (web-test): `/dealerships` queue filter; dealer panel renders (stage, commitment, log-activity, recent list, mark-won). Read-only — no submits on the shared auth user.
- [ ] Confirm "Mark won" reuses `convertProspectToActive` + **no QB write while a dealer is still a prospect**.
