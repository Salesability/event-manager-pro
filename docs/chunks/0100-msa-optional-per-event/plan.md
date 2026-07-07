# MSA optional per calendar event — Plan

**Intent:** [`intent.md`](intent.md)
**Started:** 2026-07-07

## Progress Tracker

| Phase | Status | Commit |
|-------|--------|--------|
| 1: Schema — `campaigns.msa_waived` + migration | Done | 167843b |
| 2: Waiver-aware commercial status (logic + unit tests) | Done | f3b4914 |
| 3: Waive/un-waive server action + event-detail control | Pending | - |
| 4: Visual treatment (pill · banner · dot · CTA · booked-prompt) | Pending | - |
| 5: Accept-gate waiver (`acceptQuote` + client mirror) | Pending | - |
| 6: Tests + smoke verification | Pending | - |

Make the MSA an **opt-out per calendar event**. A new `campaigns.msa_waived` boolean feeds three surfaces so a waived event reads as "MSA not required" rather than an unfinished step: (1) the commercial-status predicate that paints the calendar dot / event-detail banner / MSA badge, (2) the "Send MSA" CTA + post-booking prompt, and (3) the hard accept-quote gate. "Done" = a waived booked event shows a neutral "Not required" pill (no amber, no ⚠, no CTA) and its quote accepts with no active MSA, while a non-waived event is unchanged and the waiver is reversible.

## Code Anchors

For each new file or method below, the builder reads the anchor first and matches its shape (length, error handling, naming, query style). For modifications to an existing file, the anchor is the nearest sibling method in that same file.

| New code | Anchor (`path:line`) | Why this anchor |
|----------|---------------------|-----------------|
| `campaigns.msaWaived` boolean column — `src/lib/db/schema/campaigns.ts` | `src/lib/db/schema/campaigns.ts:65` (`acceptedQuoteId`, nullable field on same table) + `dealer_contacts.is_primary` boolean precedent (`data-model.md:361`) | Same table; boolean-flag / optional-column precedent to match default + naming |
| `setMsaWaived` server action — `src/features/schedule/actions.ts` | `convertProspectToActive` in `src/features/schedule/actions.ts` (atomic guarded campaign/dealer UPDATE; referenced from `quotes/actions.ts:1262`) | Same layer (server action), same guarded-UPDATE-on-a-campaign shape |
| Waiver in `isExposed` / `CommercialStatus` / `loadCommercialStatusByCampaign` — `src/features/schedule/commercial-status.ts` | `src/features/schedule/commercial-status.ts:17-56` (`isExposed`, `effectiveMsaStatus`) | Modify in place — nearest sibling logic |
| Waiver skip in the accept gate — `src/features/quotes/actions.ts` | `src/features/quotes/actions.ts:1287-1310` (the existing active-MSA gate inside `acceptQuote`) | Modify in place — extend the exact gate being relaxed |
| Neutral "Not required" pill — `src/app/(app)/calendar/event-detail.tsx` (+ maybe `src/components/app/status-badge.tsx`) | `event-detail.tsx:164-175` (MSA row) + `status-badge.tsx:66-75` (`MsaStatusBadge` / `MSA_COLOR`) | Nearest badge-rendering shape to add a `waived` variant |

**Conventions referenced:**
- `docs/wiki/commercial-spine.md` — the exposed-flag design + accept gate (§"Calendar surfaces commercial status" 0093, §"Accepting a Quote" 0082). This page must be updated when the chunk ships.
- `docs/wiki/data-model.md` — `campaigns` table row + MSA table; add the `msa_waived` column.
- **`db-conventions` skill** — invoke before the schema edit; watch the Drizzle journal `when` gotcha (see [[project_drizzle_journal_when_gotcha]]).

**Overall Progress:** 33% (2/6 phases complete)

**Note:**
- Each phase includes both implementation and tests.
- Integration tests come last (Phase 6), after all phases pass — verifies the accept-gate waiver against a real DB.

### Phase Checklist

#### Phase 1: Schema — `campaigns.msa_waived` + migration
- [x] Invoke the `db-conventions` skill before editing schema
- [x] Add `msaWaived: boolean('msa_waived').notNull().default(false)` to `campaigns` (`src/lib/db/schema/campaigns.ts`)
- [x] Generate the migration; **verify the journal `when` is greater than the previous entry** ([[project_drizzle_journal_when_gotcha]]) so it actually applies — `0048_tiresome_virginia_dare.sql` (`ALTER TABLE campaigns ADD COLUMN msa_waived boolean DEFAULT false NOT NULL`); journal idx 48 `when` 1783461732034 > 47's 1782305717918 ✓
- [x] Apply to the sandbox DB on the **session pooler (5432)**, not the 6543 transaction pooler — applied; verified `msa_waived boolean NOT NULL DEFAULT false` present in `information_schema`
- [x] Thread `msaWaived` onto the `Campaign` projection/type wherever campaigns are loaded (`loadCampaigns`), so downstream reads can see it — `Campaign` type + `loadCampaigns`/`loadCampaign` selects & maps; `mk()` fixtures in `production-feed.test.ts` + `route.test.ts` updated
- [x] Resolve the Phase-1 open question: capability that gates the waive action → **`campaign:edit`** (coach-scoped, the capability `updateCampaign`/`resyncCampaign` use — the waiver is a per-event campaign property; not `dealer:edit`, not `admin:access` — 0082's `admin:access` was for *sending* an envelope, a heavier action than an opt-out toggle)

#### Phase 2: Waiver-aware commercial status
- [x] Extend `CommercialStatus` with `msaWaived: boolean` (and/or a `'waived'` effective-MSA state) — added `msaWaived` field + a pure `msaDisplayState()` helper returning `'waived'` for the display layer
- [x] Update `isExposed` so a waived MSA doesn't count toward exposure — `!(quoteAccepted && (msaActive || msaWaived))`; the quote dimension is untouched (3rd param `msaWaived = false`)
- [x] Thread `msaWaived` into `loadCommercialStatusByCampaign` (read `campaigns.msa_waived` alongside the existing per-campaign batch load) — read straight off the `Campaign` input (already carries `msaWaived` from Phase 1's `loadCampaigns`), no extra query
- [x] Test: waived event → **not** exposed on the MSA dimension, but still exposed when its quote isn't accepted
- [x] Test: waived flips the effective MSA status to "not required" / `waived` (`msaDisplayState` tests)
- [x] Test: non-waived event's exposure is unchanged (regression)

#### Phase 3: Waive/un-waive server action + event-detail control
- [ ] `setMsaWaived(campaignId, waived)` server action — guarded UPDATE, capability per Phase 1
- [ ] Add a gate-matrix row if a new gated action is introduced (`src/features/__tests__/action-gate-matrix.ts`)
- [ ] Waive / un-waive toggle on the event-detail card (near the MSA row)
- [ ] Pass `msaWaived` through `calendar/page.tsx` → `calendar-view.tsx` → `event-detail.tsx` props
- [ ] Test: `setMsaWaived` flips the flag; guarded update is a no-op on a bad/foreign campaign id

#### Phase 4: Visual treatment
- [ ] Event-detail MSA row: neutral **"Not required"** pill when `msaWaived` (no amber, no pending `MsaStatusBadge`)
- [ ] Event-detail banner: a waived event shows no "⚠ Commercially exposed" contribution from the MSA side
- [ ] Hide the "Send MSA" CTA when waived
- [ ] Calendar amber dot: not painted when the only exposure was a waived MSA (`calendar-view.tsx:369`)
- [ ] Booked-prompt (`calendar-view.tsx:654`): add "MSA not needed for this event" that calls `setMsaWaived` (per the intent open question)
- [ ] (If needed) a `waived` / `not-required` variant in `MsaStatusBadge` / `MSA_COLOR` (`status-badge.tsx:66`)

#### Phase 5: Accept-gate waiver (`acceptQuote` + client mirror)
- [ ] `acceptQuote`: also select the quote's `campaignId`; when its campaign is `msa_waived`, **skip** the active-MSA requirement (`quotes/actions.ts:1287-1310`)
- [ ] Handle a null-`campaignId` quote (no event → no waiver → normal gate; matches the existing "skips cleanly when the quote has no campaign link")
- [ ] Client mirror: `quotes/[id]/page.tsx` computes the event's waived state; `quote-status-actions.tsx` treats waived as satisfied (`hasActiveMsa || msaWaived`) so "Mark accepted" is enabled with the right copy
- [ ] Test: a waived event's `sent` quote accepts with no active MSA; a non-waived event's is still blocked with the existing error

#### Phase 6: Tests + smoke verification
- [ ] Service-level integration test for the accept-gate waiver against a real DB (waived → accepts; non-waived → blocked)
- [ ] `pnpm dlx tsx scripts/0100-msa-waived-smoke.ts insert` — insert one **waived** booked campaign (+ one non-waived control), idempotent by tag
- [ ] Smoke (web-test): `goto /calendar`; open the waived event's detail → MSA row reads **"Not required"** (neutral), **no** "⚠ Commercially exposed" banner, **no** "Send MSA" button
- [ ] Smoke (web-test): the non-waived control event still shows the amber "No active MSA" row + "Send MSA" CTA (regression)
- [ ] `pnpm dlx tsx scripts/0100-msa-waived-smoke.ts cleanup`
- [ ] Ingest to wiki: `commercial-spine.md` (waiver in the exposed-flag + accept gate) + `data-model.md` (`campaigns.msa_waived`), and add a `log.md` entry

**Read-only smoke discipline:** the waive toggle is a mutation — the web-test verifies *render states* via the fixture script (insert a pre-waived campaign), not by clicking the toggle on a real coach's event.
