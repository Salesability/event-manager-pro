# Dealer pipeline (prospecting CRM-lite) — Plan

**Intent:** [`intent.md`](intent.md)
**Started:** _scaffolded 2026-06-19; PARKED pending sequencing decision vs 0086_

> **Status note:** scaffolded as a sketch to size the work. **Not active** — 0086
> (the import) holds the active pointer. Sequencing is the open call: ship this
> *before* 0086's prod load (so the import seeds stages) or *after* (backfill
> imported prospects to the initial stage). Un-park when that's decided.

## Progress Tracker

| Phase | Status | Commit |
|-------|--------|--------|
| 1: Decision gate — stage model, owner FK, fields-vs-table, dashboard, 0086 order | Pending | - |
| 2: Schema migration — pipeline fields + enums on `dealers` | Pending | - |
| 3: Server actions + query projections (set pipeline, log touch, Won→convert) | Pending | - |
| 4: Dealer-detail pipeline panel | Pending | - |
| 5: Dealer-list stage/owner/priority columns + filters | Pending | - |
| 6: Tests + smoke | Pending | - |

A **CRM-lite pipeline on the dealer** — stage, owner, priority, next-action,
last-contacted — driven from a per-dealer panel + a filterable dealer list, with
"won" reusing `convertProspectToActive` so the pipeline and the commercial spine
stay one system. v1 = fields-on-dealer (no activity table, no Kanban, no auto-stage
— those are v2). "Done" = the dealer carries settable pipeline fields, the list
filters on them, "mark won" flows to active+QBO, and a smoke drives the panel +
filter.

## Code Anchors

For each new file or method below, the builder reads the anchor first and matches
its shape (length, error handling, naming, query style). For modifications to an
existing file, the anchor is the nearest sibling method in that same file.

| New code | Anchor (`path:line`) | Why this anchor |
|----------|---------------------|-----------------|
| `pipeline_stage` + `priority` enums; `owner_id` / `next_action` / `next_action_at` / `last_contacted_at` columns on `dealers` | `src/lib/db/schema/dealers.ts:10` (`dealerStatus` pgEnum) + `:16-52` (table; `actors` mixin = the `auth.users` FK pattern for `owner_id`) | Same enum + nullable-column patterns already in the file; `createdById` is the actor-FK template for `owner_id` |
| Migration `00NN_*` (generate + apply) | `drizzle/0040_wealthy_ultragirl.sql` + **`db-conventions` skill** | Additive columns + new enums; verify the journal `when` ([[project-drizzle-journal-when-gotcha]]) |
| `setDealerPipeline` / `logDealerTouch` Server Actions + Won→`convertProspectToActive` | `src/features/schedule/actions.ts` (`convertProspectToActive` + `updateDealer` — the dealer-action siblings; `capabilityClient` gating) | Match the existing dealer Server Action shape (capability gate, FormData parse, guarded UPDATE, `revalidatePath`) |
| `loadDealers` / `loadDealer` projection += pipeline fields | `src/features/schedule/queries.ts` (`loadDealer`/`loadDealers` — the existing `Dealer` projections) | Extend the same projections the list + detail already read |
| Dealer-detail pipeline panel | `src/features/quotes/dealer-quotes-panel.tsx` (`DealerQuotesPanel`) + `src/features/msa/msa-send-button.tsx` (the per-dealer MSA panel on `/dealerships/[id]`) | A per-dealer feature panel rendered into the detail page's `<Section>`s — same shape |
| Stage/owner/priority columns + filters on the list | `src/features/dealers/dealers-columns.tsx` (columns) + `src/features/dealers/dealers-admin.tsx:74-82` (URL-driven `globalFilter` + `makeNeedleFilter`) | The dealer list already has columns + URL-driven filter state; add stage/owner/priority the same way |
| Status `<Badge>` for stage | `src/components/app/status-badge.tsx` (`DealerStatusBadge`) | Mirror the existing dealer-status badge for a `PipelineStageBadge` |
| Gate-matrix rows for the new actions | `docs/wiki/auth.md` (the per-action `requireRole`/capability matrix) | Every new gated action gets a matrix row |

**Conventions referenced:**
- `docs/wiki/data-model.md` — `dealers` shape + the `status` enum the stage dovetails with; `dealer_contacts.lastContactedAt` (the per-contact precedent for the new dealer-level `last_contacted_at`).
- `docs/wiki/commercial-spine.md` — "won" = `prospect → active` via quote-accept / `convertProspectToActive`; the pipeline must not fork a parallel state.
- `docs/wiki/layout.md` — `<Section>` / `<KeyValueStrip>` / `<ListToolbar>` / row-action vocab + status `<Badge>` for the panel + list.
- `docs/wiki/auth.md` — capability gating on the new Server Actions; add gate-matrix rows.
- **`db-conventions` skill** — invoked before the schema change + migration.

**Overall Progress:** 0% (0/6 phases complete)

**Note:**
- This is **net-new product surface** (the app has no prospecting funnel today), so Phase 1 is a genuine **decision gate** with several owner calls (see `intent.md` Open questions) — more open than a typical build chunk.
- **Migration expected** (Phase 2: enums + ~5 nullable columns on `dealers`).
- **Sequencing vs 0086 is itself a Phase-1 decision** — ship-before (seed stages in the import) vs ship-after (backfill `pipeline_stage='new'`).
- v1 scope is deliberately tight (fields-on-dealer); the `dealer_activities` timeline + Kanban board + auto-stage-from-quote are explicit v2 non-goals.

### Phase Checklist

#### Phase 1: Decision gate
- [ ] **Stage set + status mapping** — confirm the enum (draft: `new / researching / contacted / follow_up / meeting_booked / proposal_sent / negotiation / on_hold / lost`); "won" = `status='active'` (not a stage); decide whether `lost` archives the dealer or just parks it; decide whether stage applies to active dealers (lean: prospect-only). Write `decision.md`.
- [ ] **Owner FK** — `auth.users` uuid (reuse actor pattern) vs `contacts`. Lean: `auth.users`.
- [ ] **Fields-on-dealer vs activity table** — confirm v1 = columns on `dealers`; defer `dealer_activities` to v2.
- [ ] **Stage-count dashboard** — include a small "N by stage" strip on `/dealerships` in v1, or defer?
- [ ] **0086 sequencing** — before (seed stages + un-drop the sheet's stage/priority/owner) or after (backfill `new`)? Record the chosen order + its effect on the 0086 importer.
- [ ] **Default stage** for new/imported prospects (`new`); nullable for pre-existing dealers.

#### Phase 2: Schema migration — pipeline fields + enums on `dealers`
- [ ] Invoke the **`db-conventions`** skill first.
- [ ] Add to `dealers`: `pipeline_stage` (new pgEnum, nullable), `priority` (new pgEnum `high|medium|low`, nullable), `owner_id` (uuid → `auth.users`, nullable, `set null`), `next_action` (text, nullable), `next_action_at` (date, nullable), `last_contacted_at` (timestamptz, nullable). Index `(pipeline_stage)` + `(owner_id)` for the list filters.
- [ ] `drizzle-kit generate`; verify the journal `when`; apply to **sandbox**; verify.
- [ ] Update `docs/wiki/data-model.md` (dealers gains the pipeline fields + the enums).

#### Phase 3: Server actions + query projections
- [ ] `setDealerPipeline` (capability-gated; patches stage/owner/priority/next_action/next_action_at via guarded UPDATE; omit-when-absent patch shape like `updateDealer`).
- [ ] `logDealerTouch` (stamps `last_contacted_at = now()`, optional note appended to `dealers.notes`).
- [ ] **Won path:** a "Mark won" action (or stage='won' choice) routes through the existing `convertProspectToActive` (status → active + QBO push, 0084) — no new status logic.
- [ ] Extend `loadDealers` / `loadDealer` projections with the pipeline fields (+ owner display name).
- [ ] Add gate-matrix rows (`docs/wiki/auth.md`).
- [ ] Unit tests on the actions (patch semantics, Won→convert reuse, capability deny).

#### Phase 4: Dealer-detail pipeline panel
- [ ] `DealerPipelinePanel` rendered into a `<Section>` on `/dealerships/[id]`: stage dropdown (`PipelineStageBadge`), owner select (coaches), priority, next-action + date, last-contacted (relative), **Log a touch** button, **Mark won** (prospect-only).
- [ ] RHF + zod + `<Field>` (forms.md); shared Catalyst `Button`.
- [ ] Hidden/locked when the dealer is already `active` (per the Phase-1 decision).

#### Phase 5: Dealer-list stage/owner/priority columns + filters
- [ ] Add stage / owner / priority columns to `dealers-columns.tsx`.
- [ ] Add stage / owner / priority filters to `dealers-admin.tsx` (URL-driven, same pattern as the existing globalFilter so back-nav restores them).
- [ ] (If Phase-1 says yes) a "N by stage" count strip via `<ListToolbar>`.

#### Phase 6: Tests + smoke
- [ ] Service-level/integration test (real DB): set stage/owner/priority, log a touch, Won→active (status flips; push gated/mocked).
- [ ] Smoke (web-test): `goto /dealerships` → filter by a stage; open a prospect → the pipeline panel renders (stage dropdown, owner, priority, next-action, Log a touch, Mark won). Read-only — don't submit on the shared auth user.
- [ ] Confirm "Mark won" reuses `convertProspectToActive` (no duplicate status path) and **no QB write fires while a dealer is still a prospect**.
