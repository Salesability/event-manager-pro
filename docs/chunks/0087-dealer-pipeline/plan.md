# Dealer pipeline — rep commitments + activity log — Plan

**Intent:** [`intent.md`](intent.md)
**Started:** _reframed + split 2026-06-19. This chunk = the rep operational layer + the shared data model; the management dashboard is [`0088-dealer-pipeline-dashboard`](../0088-dealer-pipeline-dashboard/plan.md). Ready to build pending the owner's go + the Phase-1 calls._

> **Status note:** **not active** — `CURRENT.md` Plan is `_None_`. Owns the schema (stages,
> commitment fields, `dealer_activities`) so 0088 needs no migration. 0086 sequencing
> resolved (prospects backfilled to `new`). Un-park by setting active + `/build`.

## Progress Tracker

| Phase | Status | Commit |
|-------|--------|--------|
| 1: Decision gate — stage list, owner source, activity kinds, notes-append | Done | (doc) |
| 2: Schema — pipeline/commitment fields on `dealers` + `dealer_activities` table | Done | `2c8a80c` |
| 3: Server actions + query projections (set pipeline/stage, log activity, won) | Done | `1041793` |
| 4: Dealer-detail panel — stage + commitment + log-activity + recent-activity list | Done | - |
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

**Overall Progress:** 67% (4/6 phases complete)

**Note:**
- **Migration expected** (Phase 2: 2 enums + ~7 nullable cols on `dealers` + the `dealer_activities` table + indexes). This chunk owns it; **0088 adds no migration**.
- `stage_changed_at` is written here (on stage change) but **read by 0088** (stalled-in-stage blocker) — added now to keep 0088 read-only.
- 0086 backfill: default the 188 imported prospects to `pipeline_stage='new'`.

### Phase Checklist

#### Phase 1: Decision gate — ✅ resolved 2026-06-22 ([decision.md](decision.md))
- [x] **Stage enum** — **full 9-stage list** confirmed: `new / researching / contacted / follow_up / meeting_booked / proposal_sent / negotiation / on_hold / lost`; won = `active` (not a stage); `on_hold`/`lost` are stages; `lost` does **not** auto-archive. (D1)
- [x] **Owner source** — **coaches only** (owner overrode the "all staff" lean → `loadCoaches`; column stays uuid→auth.users so a future widen needs no migration). (D2)
- [x] **Activity `kind`** — **`call / email / meeting / note / other`** confirmed. (D3)
- [x] **Notes-append** — **no** — log-activity does not touch `dealers.notes`; the activity log is the trail. (D4)
- [x] **0086 backfill** — default the 188 to `pipeline_stage='new'`. (D5)

#### Phase 2: Schema — fields + activity table ✅
- [x] Invoke the **`db-conventions`** skill first.
- [x] `dealers` (+ nullable): `pipeline_stage` (new enum), `priority` (new enum), `owner_id` (uuid→`auth.users`, set null), `next_action` (text), `next_action_at` (date), `last_contacted_at` (tstz), `stage_changed_at` (tstz). Indexes `(pipeline_stage)`, `(owner_id)`, `(next_action_at)`. → `src/lib/db/schema/dealers.ts`
- [x] `dealer_activities`: `id`, `dealer_id` (FK cascade), `kind` (enum), `note` (text null), `occurred_at` (tstz, default now), `actors` + `timestamps`. Indexes `(dealer_id)`, `(created_by_id, occurred_at)`, `(updated_by_id)`. → `src/lib/db/schema/dealer-activities.ts` (+ `index.ts` export)
- [x] `drizzle-kit generate` → `drizzle/0042_low_slipstream.sql` (3 enums + table + 7 cols + indexes; hand-appended the RLS block + the backfill); journal `when` verified monotonic; applied **sandbox** + verified (7 cols, table+RLS, **188/188 prospects→`new`**, 0 active w/ stage).
- [x] Update `docs/wiki/data-model.md` (dealers pipeline fields + the new table + enums + ER diagram).

#### Phase 3: Server actions + query projections ✅
- [x] `setDealerPipeline` (`dealer:edit`; patches stage/priority/owner/next_action/next_action_at; stamps `stage_changed_at` on transition; omit-when-absent patch; **locked once `active`**). → `schedule/actions.ts`
- [x] `logDealerActivity` (`dealer:edit`; inserts a `dealer_activities` row (kind+note+occurred_at+actor); stamps `dealers.last_contacted_at`; optionally sets the next action). → `schedule/actions.ts`
- [x] **Won:** "Mark won" routes through `convertProspectToActive` (no new status logic — panel will call the existing action in Phase 4).
- [x] Extend `loadDealers`/`loadDealer` projections (pipeline fields + resolved `ownerName`); `loadDealerActivities(dealerId)` for the recent list; `loadCoaches`/`loadCoach` now carry `userId` (owner picklist source). New `fetchOwnerNames` resolver. → `schedule/queries.ts`
- [x] Shared value/label module `src/features/dealers/pipeline.ts` + zod `src/features/dealers/pipeline-schema.ts`.
- [x] Gate-matrix rows: executable twin (`action-gate-matrix.ts`, 2 rows) + `auth.md` narrative. Unit tests (patch semantics, owner set/clear + non-uuid reject, `stage_changed_at` on transition only, active-lock, activity insert + last-contacted stamp + backdate + next-promise, invalid-kind reject, not-found) + a pipeline⇄DB-enum drift guard (`pipeline.test.ts`). **34 new tests, all green.**

#### Phase 4: Dealer-detail panel ✅
- [x] `DealerPipelinePanel` (`src/features/dealers/dealer-pipeline-panel.tsx`) in a `<Section title="Pipeline">` on `/dealerships/[id]` (non-archived only): commitment summary (stage `PipelineStageBadge` + priority `PriorityBadge` + owner + last-contacted relative), next-action banner, stage/priority/owner/next-action+due editor, **Log activity** (kind + when + note + optional next-promise), **recent-activity list** (last 20 via `loadDealerActivities`), **Mark won** (`convertProspectToActive`). Added `PipelineStageBadge`/`PriorityBadge` to `status-badge.tsx`.
- [x] RHF + zod (`dealerPipelineSchema`/`logActivitySchema`) + `<Field>`; shared Catalyst `Button`; native `<select>` per dealer-form precedent. **Locked once `active`** — panel renders read-only history (no editors, no Mark-won). Page loads `loadCoaches()` (owner picklist) + `loadDealerActivities()`.

#### Phase 5: Dealer-list commitment queue
- [ ] Columns: stage / next-action / due-date / owner / priority; overdue rendered loud.
- [ ] URL-driven filters: owner ("mine"), due bucket (overdue/today/this-week), idle (no next action), stage, priority. Default sort by `next_action_at` (overdue first).

#### Phase 6: Tests + smoke
- [ ] Integration (real DB): set stage/commitment, log activities (counts + last-contacted), `stage_changed_at` on transition, won→active (push gated/mocked).
- [ ] Smoke (web-test): `/dealerships` queue filter; dealer panel renders (stage, commitment, log-activity, recent list, mark-won). Read-only — no submits on the shared auth user.
- [ ] Confirm "Mark won" reuses `convertProspectToActive` + **no QB write while a dealer is still a prospect**.
