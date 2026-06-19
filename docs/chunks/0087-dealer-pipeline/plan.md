# Dealer commitment tracker ("don't drop the ball") — Plan

**Intent:** [`intent.md`](intent.md)
**Started:** _reframed 2026-06-19 from a stage-funnel sketch to a commitment tracker; 0086 shipped so sequencing = ship-after with no seed. Ready to build pending the owner's go + the light Phase-1 calls._

> **Status note:** **not active** — `CURRENT.md` Plan is `_None_`. This plan is fleshed
> out + decisions mostly locked in conversation; un-park by setting it active and running
> `/build`. The 0086 sequencing question that originally parked it is **resolved** (0086
> shipped; imported prospects start idle, no backfill).

## Progress Tracker

| Phase | Status | Commit |
|-------|--------|--------|
| 1: Decision gate — owner source, queue surface, touch-note | Pending | - |
| 2: Schema migration — commitment fields on `dealers` | Pending | - |
| 3: Server actions + query projections (set commitment, log touch, won) | Pending | - |
| 4: Dealer-detail commitment panel | Pending | - |
| 5: Dealer-list commitment queue (columns + overdue/due/idle filters + sort) | Pending | - |
| 6: Tests + smoke | Pending | - |

A **commitment tracker on the dealer** — a single current next-action (free text) + due
date + owner + last-contacted — whose job is to **keep promises from slipping**, surfaced
as a queue (overdue / due-soon / idle, filtered to "mine"). "Won" reuses
`convertProspectToActive`; "on hold" = a future-dated action; "lost" = archive. v1 =
**fields-on-dealer, no enums, no priority, no consent, no activity table** (those are v2).
"Done" = the dealer carries settable commitment fields, the list surfaces the queue,
log-a-touch + mark-won work, and a smoke drives the panel + queue.

## Code Anchors

For each new file or method below, read the anchor first and match its shape (length,
error handling, naming, query style). For modifications, the anchor is the nearest sibling
method in that same file.

| New code | Anchor (`path:line`) | Why this anchor |
|----------|---------------------|-----------------|
| `next_action` (text) / `next_action_at` (date) / `owner_id` (uuid→`auth.users`) / `last_contacted_at` (timestamptz) — all nullable on `dealers` | `src/lib/db/schema/dealers.ts` (the 0086 `phone`/`manufacturer`/`notes` nullable cols = the template; the `actors` mixin = the `auth.users` FK + `ON DELETE SET NULL` pattern for `owner_id`) | Same nullable-column + actor-FK patterns already in the file; **no new enums** |
| Migration `00NN_*` (generate + apply) | `drizzle/0041_strong_slyde.sql` + **`db-conventions` skill** | Additive nullable columns + 2 indexes; verify the journal `when` ([[project_drizzle_journal_when_gotcha]]) |
| `setDealerCommitment` / `logDealerTouch` Server Actions + won→`convertProspectToActive` | `src/features/schedule/actions.ts` (`convertProspectToActive` + `updateDealer` — dealer-action siblings; `capabilityClient('dealer:edit')`, FormData parse, guarded UPDATE, `revalidatePath`) | Match the existing dealer Server Action shape; reuse `dealer:edit` (no new capability) |
| `loadDealers` / `loadDealer` projection += commitment fields + owner display name | `src/features/schedule/queries.ts` (`loadDealer`/`loadDealers`; 0086 extended `loadDealer` the same way) | Extend the same projections the list + detail already read |
| Dealer-detail commitment panel | `src/features/quotes/dealer-quotes-panel.tsx` + `src/features/msa/msa-send-button.tsx` (per-dealer panels on `/dealerships/[id]`) | A per-dealer feature panel rendered into a detail-page `<Section>` — same shape |
| Commitment columns + queue filters/sort on the list | `src/features/dealers/dealers-columns.tsx` + `src/features/dealers/dealers-admin.tsx:74-82` (URL-driven `globalFilter`) | The list already has columns + URL-driven filter state; add next-action/due/owner the same way |
| Overdue / due-soon styling + owner picklist | `src/components/app/status-badge.tsx` (badge precedent) + `src/features/schedule/queries.ts:322` (`loadCoaches`, or an all-staff loader) | Mirror the badge for an overdue/due-today indicator; reuse the coach/staff loader for the owner select |
| Gate-matrix rows for the new actions | `docs/wiki/auth.md` (the per-action capability matrix) | Every new gated action gets a matrix row |

**Conventions referenced:**
- `docs/wiki/data-model.md` — `dealers` shape; the `dealer_contacts.lastContactedAt` precedent for a dealer-level `last_contacted_at`.
- `docs/wiki/commercial-spine.md` — "won" = `prospect → active` via `convertProspectToActive`; don't fork a parallel state.
- `docs/wiki/layout.md` — `<Section>` / `<KeyValueStrip>` / `<ListToolbar>` / row-action vocab for the panel + queue.
- `docs/wiki/auth.md` — capability gating (`dealer:edit`) on the new Server Actions; add gate-matrix rows.
- **`db-conventions` skill** — invoked before the schema change + migration.

**Overall Progress:** 0% (0/6 phases complete)

**Note:**
- The reframe **shrank the chunk**: ~4 nullable columns, **no new enums**, no priority, no consent field, no activity table, no stage funnel. Phase 1 is light (3 small calls).
- **No 0086 backfill** — imported prospects with null `next_action` are correctly "idle / needs a first commitment" in the queue.
- **Migration expected** (Phase 2: 4 nullable columns + 2 indexes on `dealers`).
- v2 (explicit non-goals): `dealer_activities` timeline, a dedicated follow-ups page, priority, auto-next-action from quote/MSA events, a Kanban board.

### Phase Checklist

#### Phase 1: Decision gate
- [ ] **Owner picklist source** — coaches only (`loadCoaches`) vs all staff (coaches + admins). Lean: all staff who can own a prospect. Write `decision.md`.
- [ ] **Queue surface** — list-integrated on `/dealerships` (columns + overdue/due/idle/owner filters + sort + a small count strip) vs a dedicated "My follow-ups" page. Lean: list-integrated for v1.
- [ ] **Log-a-touch note** — append a dated line to `dealers.notes` (0086) vs nothing in v1. Lean: optional append.
- [ ] **Confirm the shape** (already leaned in conversation): free-text action (no enum), no priority, no consent field; on-hold = future-dated action; lost = archive; won = `convertProspectToActive`; stage hidden once `active`.

#### Phase 2: Schema migration — commitment fields on `dealers`
- [ ] Invoke the **`db-conventions`** skill first.
- [ ] Add to `dealers` (all nullable): `next_action` text, `next_action_at` date, `owner_id` uuid → `auth.users` (`ON DELETE SET NULL`), `last_contacted_at` timestamptz. Indexes on `(owner_id)` + `(next_action_at)` for the queue.
- [ ] `drizzle-kit generate`; verify the journal `when` ([[project_drizzle_journal_when_gotcha]]); apply to **sandbox**; verify. **No backfill** (null = idle).
- [ ] Update `docs/wiki/data-model.md` (dealers gains the 4 commitment fields).

#### Phase 3: Server actions + query projections
- [ ] `setDealerCommitment` (`dealer:edit`; patches `next_action` / `next_action_at` / `owner_id` via guarded UPDATE; omit-when-absent patch shape like `updateDealer`).
- [ ] `logDealerTouch` (`dealer:edit`; stamps `last_contacted_at = now()`; optional dated note appended to `dealers.notes`; optionally sets the next action in the same call).
- [ ] **Won path:** "Mark won" routes through the existing `convertProspectToActive` (status → active + QBO push, 0084) — no new status logic.
- [ ] Extend `loadDealers` / `loadDealer` projections with the commitment fields + owner display name.
- [ ] Add gate-matrix rows (`docs/wiki/auth.md`).
- [ ] Unit tests (patch semantics, touch stamping, won→convert reuse, capability deny).

#### Phase 4: Dealer-detail commitment panel
- [ ] `DealerCommitmentPanel` in a `<Section>` on `/dealerships/[id]`: next-action (text) + due-date + owner select + last-contacted (relative), **Log a touch** button, **Mark won** (prospect-only).
- [ ] RHF + zod + `<Field>` (forms.md); shared Catalyst `Button`.
- [ ] Hidden/locked when the dealer is already `active` (won).

#### Phase 5: Dealer-list commitment queue
- [ ] Add **next-action / due-date / owner** columns to `dealers-columns.tsx`; **overdue** rendered loud (badge/colour), due-today/soon distinct.
- [ ] Add URL-driven filters to `dealers-admin.tsx`: **owner ("mine")**, **due bucket** (overdue / today / this-week), **idle** (no next action). Default sort by `next_action_at` (overdue first).
- [ ] (If Phase-1 says yes) a small "**N overdue · N due today**" strip via `<ListToolbar>`.

#### Phase 6: Tests + smoke
- [ ] Integration test (real DB): set a commitment, log a touch (last-contacted stamps), won → active (status flips; push gated/mocked).
- [ ] Smoke (web-test): `goto /dealerships` → filter to overdue/due-today; open a prospect → the commitment panel renders (next-action, due, owner, Log a touch, Mark won). Read-only — don't submit on the shared auth user.
- [ ] Confirm "Mark won" reuses `convertProspectToActive` (no duplicate status path) and **no QB write fires while a dealer is still a prospect**.
