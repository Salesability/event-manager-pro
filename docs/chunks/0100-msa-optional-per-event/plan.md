# MSA optional per calendar event — Plan

**Intent:** [`intent.md`](intent.md)
**Started:** 2026-07-07

## Progress Tracker

| Phase | Status | Commit |
|-------|--------|--------|
| 1: Schema — `campaigns.msa_waived` + migration | Done | 167843b |
| 2: Waiver-aware commercial status (logic + unit tests) | Done | f3b4914 |
| 3: Waive/un-waive server action + event-detail control | Done | 9a4f43c |
| 4: Visual treatment (pill · banner · dot · CTA · booked-prompt) | Done | 3444725 |
| 5: Accept-gate waiver (`acceptQuote` + client mirror) | Done | 2a26385 |
| 6: Tests + smoke verification | Done | 91b893c |

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

**Overall Progress:** 100% (6/6 phases complete)

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
- [x] Resolve the Phase-1 open question: capability that gates the waive action → **`campaign:edit`** (the capability `updateCampaign`/`resyncCampaign` use — the waiver is a per-event campaign property). **Correction to the intent's "coach-scoped" lean:** in this app `campaign:edit` resolves to **admin-only** ("booking is back-office" — every campaign-mutating action is admin-only per the gate matrix), so the waiver is admin-gated, consistent with the adjacent Edit / Re-sync / Send-MSA (`admin:access`) controls. Not `dealer:edit` (that's the dealer entity), not a bespoke `admin:access` (campaign:edit already lands admin-only and is the semantically correct capability).

#### Phase 2: Waiver-aware commercial status
- [x] Extend `CommercialStatus` with `msaWaived: boolean` (and/or a `'waived'` effective-MSA state) — added `msaWaived` field + a pure `msaDisplayState()` helper returning `'waived'` for the display layer
- [x] Update `isExposed` so a waived MSA doesn't count toward exposure — `!(quoteAccepted && (msaActive || msaWaived))`; the quote dimension is untouched (3rd param `msaWaived = false`)
- [x] Thread `msaWaived` into `loadCommercialStatusByCampaign` (read `campaigns.msa_waived` alongside the existing per-campaign batch load) — read straight off the `Campaign` input (already carries `msaWaived` from Phase 1's `loadCampaigns`), no extra query
- [x] Test: waived event → **not** exposed on the MSA dimension, but still exposed when its quote isn't accepted
- [x] Test: waived flips the effective MSA status to "not required" / `waived` (`msaDisplayState` tests)
- [x] Test: non-waived event's exposure is unchanged (regression)

#### Phase 3: Waive/un-waive server action + event-detail control
- [x] `setMsaWaived(campaignId, waived)` server action — guarded UPDATE (`campaign:edit`, `id`+`waived` from form, `.returning()` → no-op error on bad id, `revalidateCampaignViews`). **No audit-log row** — `audit_log.action` is a pgEnum (a new value would need an `ALTER TYPE` migration), and the sibling `updateCampaign`/`resyncCampaign` edits don't audit either; `updated_by_id` captures the actor
- [x] Add a gate-matrix row if a new gated action is introduced (`src/features/__tests__/action-gate-matrix.ts`) — `setMsaWaived` row (ADMIN_ONLY); the harness greps `actions.ts` for gated entries and fails without it, so this runs now
- [x] Waive / un-waive toggle on the event-detail card (near the MSA row) — action-bar button next to "Send MSA"; label flips "MSA not required" ↔ "Require MSA"; closes the panel on success (the commercial surface is recomputed server-side; `dialog.campaign` is a snapshot)
- [x] ~~Pass `msaWaived` through `calendar/page.tsx` → `calendar-view.tsx` → `event-detail.tsx` props~~ — **not needed**: `EventDetail` already receives the full `Campaign` (now carrying `msaWaived`) *and* `commercial` (carries `msaWaived` from Phase 2), so the flag is already in hand
- [x] Test: `setMsaWaived` flips the flag; guarded update is a no-op on a bad/foreign campaign id — **auth** covered now by the gate-matrix row (runs in `pnpm test`); the **DB flip + no-op-on-bad-id** round-trip is folded into the Phase 6 integration suite per the plan's "integration tests come last" note (the `capabilityClient`-wrapped action can't run in the tx-rollback harness; the repo has no mocked-db unit-test precedent for these thin actions)

#### Phase 4: Visual treatment
- [x] Event-detail MSA row: neutral **"Not required"** pill when `msaWaived` (no amber, no pending `MsaStatusBadge`) — inline `<Badge color="zinc">Not required</Badge>`
- [x] Event-detail banner: a waived event shows no "⚠ Commercially exposed" contribution from the MSA side — `commercialBannerText()` helper: waived+exposed blames only the missing quote (+"(MSA not required for this event.)"); waived+protected reads "Protected — accepted quote. MSA not required for this event."
- [x] Hide the "Send MSA" CTA when waived — added `&& !commercial.msaWaived` to the CTA condition
- [x] Calendar amber dot: not painted when the only exposure was a waived MSA (`calendar-view.tsx`) — **no change needed**: the dot reads `commercialStatus[…].exposed`, which Phase 2 already made waiver-aware (waived+accepted ⇒ not exposed ⇒ no dot; waived+no-quote still dots for the quote gap, correctly)
- [x] Booked-prompt: add "MSA not needed for this event" that calls `setMsaWaived` — `plain` Button gated `campaign:edit`, waives + closes via `waiveMsaFromPrompt`
- [x] ~~(If needed) a `waived` / `not-required` variant in `MsaStatusBadge` / `MSA_COLOR`~~ — **not needed**: rendered an inline neutral `Badge` instead of widening the `Msa['status']` domain type with a display-only value

#### Phase 5: Accept-gate waiver (`acceptQuote` + client mirror)
- [x] `acceptQuote`: also select the quote's `campaignId`; when its campaign is `msa_waived`, **skip** the active-MSA requirement (`quotes/actions.ts`) — looks up `campaigns.msaWaived` for the linked campaign; `!msaWaived` → the existing active-MSA gate runs unchanged
- [x] Handle a null-`campaignId` quote (no event → no waiver → normal gate) — `campaignId == null` short-circuits `msaWaived=false`, so the gate runs; the client loader uses an `innerJoin` so a null link yields `false` too
- [x] Client mirror: `quotes/[id]/page.tsx` computes the event's waived state (`loadQuoteEventMsaWaived`); `quote-status-actions.tsx` treats waived as satisfied (`msaSatisfied = hasActiveMsa || msaWaived`) — Accept enabled + the "sign the MSA first" copy suppressed when waived
- [x] Test: a waived event's `sent` quote accepts with no active MSA; a non-waived event's is still blocked with the existing error — **folded into the Phase 6 integration suite** (real-DB service test per the plan's "integration tests come last" note; the gate lives in a `capabilityClient` action)

#### Phase 6: Tests + smoke verification
- [x] Service-level integration test for the accept-gate waiver against a real DB (waived → accepts; non-waived → blocked) — `tests/integration/msa-waiver.test.ts`, **6/6 pass** on the sandbox pooler: waived→satisfied w/o MSA, non-waived+no-MSA→blocked, non-waived+active-MSA→satisfied, expired-MSA→blocked, null-campaign→normal gate, + the `msa_waived` guarded-UPDATE flip/no-op (Phase 3's deferred DB test)
- [x] `pnpm dlx tsx scripts/0100-msa-waived-smoke.ts insert` — script written (waived event = `msa_waived` + accepted quote + no MSA; control = non-waived, no MSA, no quote). Run in the chunk-end `/eval` browser-smoke window
- [ ] Smoke (web-test): `goto /calendar`; open the waived event's detail → MSA row reads **"Not required"** (neutral), **no** "⚠ Commercially exposed" banner, **no** "Send MSA" button — runs in the chunk-end `/eval`
- [ ] Smoke (web-test): the non-waived control event still shows the amber "No active MSA" row + "Send MSA" CTA (regression) — runs in the chunk-end `/eval`
- [ ] `pnpm dlx tsx scripts/0100-msa-waived-smoke.ts cleanup` — after the smoke
- [x] Ingest to wiki: `commercial-spine.md` (new "Per-event MSA opt-out (0100)" section + accept-gate/exposed-flag bullets) + `data-model.md` (`campaigns.msa_waived` in the ER block + tables-at-a-glance) + a `log.md` entry

**Read-only smoke discipline:** the waive toggle is a mutation — the web-test verifies *render states* via the fixture script (insert a pre-waived campaign), not by clicking the toggle on a real coach's event.
