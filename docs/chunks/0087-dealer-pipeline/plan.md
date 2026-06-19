# Dealer pipeline — commitments + progress dashboard — Plan

**Intent:** [`intent.md`](intent.md)
**Started:** _reframed 2026-06-19 (stage funnel → commitment tracker → both: rep commitment layer + management dashboard backed by an activity log). Ready to build pending the owner's go + the Phase-1 calls._

> **Status note:** **not active** — `CURRENT.md` Plan is `_None_`. Fleshed out + decisions
> mostly locked in conversation. 0086 sequencing resolved (shipped; prospects start `new`).
> Un-park by setting it active + `/build`. **Sizeable chunk** — see Phase-1 "split?" call:
> the management **dashboard (Phase 6) can be a fast-follow chunk** if you want the
> operational layer (1–5) shipped first.

## Progress Tracker

| Phase | Status | Commit |
|-------|--------|--------|
| 1: Decision gate — stage list, owner source, activity kinds, dashboard surface, split? | Pending | - |
| 2: Schema — pipeline/commitment fields on `dealers` + `dealer_activities` table | Pending | - |
| 3: Server actions + query projections (set commitment/stage, log activity, won) | Pending | - |
| 4: Dealer-detail panel — stage + commitment + log-activity + recent-activity list | Pending | - |
| 5: Dealer-list commitment queue (columns + overdue/due/idle filters + sort) | Pending | - |
| 6: Management dashboard — N-by-stage / by-owner / activity counts / blockers | Pending | - |
| 7: Tests + smoke | Pending | - |

Two lenses over one prospect dataset: a **rep commitment tracker** (next-action + due-date +
owner + activity log → an overdue/due/idle queue, "don't drop the ball") and a **management
dashboard** (N-by-stage, by-owner, activity counts, and blocker views — stalled / stale /
overdue — to see progress *and why it stalls*). `pipeline_stage` drives the funnel; a
`dealer_activities` touch-log drives true activity counts + a lite per-dealer timeline. Won
= `convertProspectToActive`; on-hold/lost = stages; lost does not auto-archive. v1 excludes
a Kanban board, the rich timeline UI, auto-stage, consent modeling, outbound send (all v2).

## Code Anchors

For each new file/method, read the anchor first and match its shape. For modifications, the
anchor is the nearest sibling in that file.

| New code | Anchor (`path:line`) | Why this anchor |
|----------|---------------------|-----------------|
| `pipeline_stage` + `priority` pgEnums; `owner_id` (uuid→`auth.users`), `next_action` (text), `next_action_at` (date), `last_contacted_at` + `stage_changed_at` (timestamptz) on `dealers` — all nullable | `src/lib/db/schema/dealers.ts` (`dealerStatus` pgEnum + the 0086 `phone`/`manufacturer`/`notes` nullable cols; `actors` mixin = the `auth.users` FK + `ON DELETE SET NULL` for `owner_id`) | Same enum + nullable-col + actor-FK patterns already in the file |
| `dealer_activities` table (touch-log: `dealer_id` FK cascade, `kind` enum, `note` text, `occurred_at` tstz, `actors`+`timestamps`) | `src/lib/db/schema/dealer-contacts.ts` (a `dealers`-FK join table with `actors`/`timestamps`) + `src/lib/db/schema/quote-attachments.ts` (cascade + snapshot-row shape) | Mirror an existing dealer-child table; `created_by_id` = who logged it (powers by-owner counts) |
| Migration `00NN_*` (cols + enums + table + indexes) | `drizzle/0041_strong_slyde.sql` + `drizzle/0038_daily_azazel.sql` (a new-table migration) + **`db-conventions` skill** | Additive cols/enums + a new table; index `(owner_id)`, `(next_action_at)`, `(pipeline_stage)`, `dealer_activities(dealer_id)`, `(created_by_id, occurred_at)`; verify journal `when` ([[project_drizzle_journal_when_gotcha]]) |
| `setDealerPipeline` / `logDealerActivity` Server Actions + won→`convertProspectToActive` | `src/features/schedule/actions.ts` (`convertProspectToActive` + `updateDealer`; `capabilityClient('dealer:edit')`, guarded UPDATE, `revalidatePath`) | Match the dealer Server Action shape; reuse `dealer:edit` (no new capability) |
| `loadDealers`/`loadDealer` += pipeline fields + owner name; dashboard aggregation queries | `src/features/schedule/queries.ts` (`loadDealer`/`loadDealers`; `loadCoaches` for owner/staff names) | Extend the existing projections; add grouped-count queries for the dashboard |
| Dealer-detail panel (stage + commitment + log-activity + recent list) | `src/features/quotes/dealer-quotes-panel.tsx` + `src/features/msa/msa-send-button.tsx` (per-dealer `<Section>` panels) | Same per-dealer feature-panel shape |
| List commitment columns + queue filters/sort | `src/features/dealers/dealers-columns.tsx` + `src/features/dealers/dealers-admin.tsx:74-82` (URL-driven filters) | The list already has columns + URL filter state |
| Stage `<Badge>` + overdue/due styling | `src/components/app/status-badge.tsx` (`DealerStatusBadge`) | Mirror for a `PipelineStageBadge` + an overdue indicator |
| Management dashboard page/section | `docs/wiki/layout.md` (`<Section>`/`<KeyValueStrip>`/`<ListToolbar>`) + an existing admin page under `src/app/(app)/admin/` for the route shape | Compose count cards from the aggregation queries |
| Gate-matrix rows | `docs/wiki/auth.md` | Every new gated action gets a row |

**Conventions referenced:** `docs/wiki/data-model.md` (dealers shape; `dealer_contacts.lastContactedAt` precedent), `commercial-spine.md` (won = `convertProspectToActive`, no parallel state), `layout.md` (panels/dashboard primitives), `auth.md` (gating + matrix), **`db-conventions` skill** (schema + migration).

**Overall Progress:** 0% (0/7 phases complete)

**Note:**
- **Migration expected** (Phase 2: 2 enums + ~7 nullable cols on `dealers` + the `dealer_activities` table + indexes).
- The **activity log is in v1** (owner choice — true activity counts + a lite recent-activity list); the **rich timeline UI + Kanban + auto-stage stay v2**.
- 0086: backfill the 188 imported prospects to `pipeline_stage='new'` (Phase 2) so the dashboard funnel reads cleanly; other fields stay null (idle).
- **Split option** (Phase-1 call): ship 1–5 (operational) first, dashboard (6) as a fast-follow chunk.

### Phase Checklist

#### Phase 1: Decision gate
- [ ] **Stage enum** — confirm `new / researching / contacted / follow_up / meeting_booked / proposal_sent / negotiation / on_hold / lost`; won = `active` (not a stage); `on_hold`/`lost` are stages (dashboard counts them); `lost` does **not** auto-archive. Write `decision.md`.
- [ ] **Owner source** — coaches only vs all staff. Lean: all staff.
- [ ] **Activity `kind`** — `call / email / meeting / note / other`? Confirm.
- [ ] **Dashboard surface** — dedicated page vs `/dealerships` section. Lean: dedicated page.
- [ ] **Priority** — confirm `high/medium/low` in v1 (yes).
- [ ] **0086 backfill** — default the 188 to `pipeline_stage='new'`.
- [ ] **Split?** — confirm one chunk vs operational-now + dashboard-fast-follow.

#### Phase 2: Schema — fields + activity table
- [ ] Invoke the **`db-conventions`** skill first.
- [ ] `dealers` (+ nullable): `pipeline_stage` (new enum), `priority` (new enum), `owner_id` (uuid→`auth.users`, set null), `next_action` (text), `next_action_at` (date), `last_contacted_at` (tstz), `stage_changed_at` (tstz). Indexes `(pipeline_stage)`, `(owner_id)`, `(next_action_at)`.
- [ ] `dealer_activities`: `id`, `dealer_id` (FK cascade), `kind` (enum), `note` (text null), `occurred_at` (tstz, default now), `actors` + `timestamps`. Indexes `(dealer_id)`, `(created_by_id, occurred_at)`.
- [ ] `drizzle-kit generate`; verify journal `when`; apply **sandbox**; verify. Backfill 0086 prospects → `pipeline_stage='new'`.
- [ ] Update `docs/wiki/data-model.md` (dealers pipeline fields + the new table + enums).

#### Phase 3: Server actions + query projections
- [ ] `setDealerPipeline` (`dealer:edit`; patches stage/priority/owner/next_action/next_action_at; stamps `stage_changed_at` when stage changes; omit-when-absent patch like `updateDealer`).
- [ ] `logDealerActivity` (`dealer:edit`; inserts a `dealer_activities` row (kind+note+occurred_at+actor) and updates `dealers.last_contacted_at`; optionally sets the next action in the same call).
- [ ] **Won:** "Mark won" routes through `convertProspectToActive` (status→active + QBO push) — no new status logic.
- [ ] Extend `loadDealers`/`loadDealer` projections (pipeline fields + owner name); add the dashboard aggregation queries (by-stage, by-owner, activity counts, blocker lists).
- [ ] Gate-matrix rows (`docs/wiki/auth.md`). Unit tests (patch semantics, activity insert + last-contacted stamp, stage_changed_at on transition, won→convert reuse, capability deny).

#### Phase 4: Dealer-detail panel
- [ ] `DealerPipelinePanel` in a `<Section>` on `/dealerships/[id]`: stage dropdown (`PipelineStageBadge`), priority, owner select, next-action + due-date, last-contacted (relative); **Log activity** (kind + note); **recent-activity list** (last N from the log); **Mark won** (prospect-only).
- [ ] RHF + zod + `<Field>`; shared Catalyst `Button`. Stage/commitment locked once `active`.

#### Phase 5: Dealer-list commitment queue
- [ ] Columns: stage / next-action / due-date / owner / priority; overdue rendered loud.
- [ ] URL-driven filters: owner ("mine"), due bucket (overdue/today/this-week), idle (no next action), stage, priority. Default sort by `next_action_at` (overdue first).

#### Phase 6: Management dashboard
- [ ] Page/section: **N-by-stage** (funnel), **by-owner** (stage×owner + workload), **activity counts** (by owner / period / kind from `dealer_activities`), **blockers** — stalled-in-stage (`stage_changed_at` age), stale (no touch in N days), overdue commitments.
- [ ] Count cards/strips via `layout.md` primitives; links from a count → the filtered list (Phase 5).

#### Phase 7: Tests + smoke
- [ ] Integration (real DB): set stage/commitment, log activities (counts + last-contacted), stage_changed_at on transition, won→active (push gated/mocked), dashboard aggregations return expected counts.
- [ ] Smoke (web-test): `/dealerships` queue filter; dealer panel renders (stage, commitment, log-activity, recent list, mark-won); dashboard renders the stage/owner/activity/blocker cards. Read-only — no submits on the shared auth user.
- [ ] Confirm "Mark won" reuses `convertProspectToActive` + **no QB write while a dealer is still a prospect**.
