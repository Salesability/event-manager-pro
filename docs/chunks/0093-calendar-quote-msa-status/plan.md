# Calendar: encourage upfront quote + MSA (protect the commitment) — Plan

**Intent:** [`intent.md`](intent.md)
**Started:** 2026-06-23

## Progress Tracker

| Phase | Status | Commit |
|-------|--------|--------|
| 1: Data — require quote → event link + reconcile entry points | Done | - |
| 2: Queries — quote + MSA status + protected/exposed | Done | - |
| 3: Event-detail commercial surface — badges + exposed + CTAs | Done | - |
| 4: Booking hand-off + ribbon exposure marker | Done | - |
| 5: Tests + smoke verification | Pending | - |

Booking is a dead-end today: it saves a date and closes, leaving the event an **exposed date-hold** with no Quote and maybe no MSA — i.e. no cancellation-fee protection (MSA §2iii needs an *accepted Quote* + a *signed MSA*). This chunk makes booking **lead into the commercial setup** as the encouraged default (create/send the Quote, sign the MSA if the client has none), reframes the calendar to flag **exposed** events (booked but not yet protected), and ties each Quote to its event so status is per-event. "Done" = after booking a coach lands on the event's commercial setup with one-click Create-Quote / Send-MSA, the calendar shows which events are still exposed, and quotes are required to scope to an event. We **encourage** (skippable default) and **hand off** to existing tools (no inline composer embed); cancellation-fee *math* stays out of scope (0037).

## Code Anchors

For each new file or method below, the builder reads the anchor first and matches its shape (length, error handling, naming, query style). For modifications to an existing file, the anchor is the nearest sibling method in that same file.

| New code | Anchor (`path:line`) | Why this anchor |
|----------|---------------------|-----------------|
| `quotes.campaignId` required FK + index (`src/lib/db/schema/quotes.ts`) | `src/lib/db/schema/quotes.ts:87` (`previousQuoteId` nullable bigint `.references()`) + `:101-102` (dealer indexes) | Same shape: bigint FK to a domain table + matching index, same file (nullable column, app-enforced-required) |
| Additive migration (`drizzle/NNNN_*.sql`) | most recent additive migration in `drizzle/` (the 0042/0043 adds) + `db-conventions` skill | Same migration style (nullable column add, no backfill required); journal `when` gotcha applies |
| `createQuote` requires `campaignId` (`src/features/quotes/actions.ts`) | the existing `createQuote` in the same file (`:240`) | Modify in place — match its Zod parse + insert shape (no yup) |
| Event-step reconcile for entry points (`dealerships/[id]`, `dealers-columns.tsx`, `quotes/page.tsx`) | `src/app/(app)/calendar/booking-form.tsx` (the `BookingForm` reused for "Book a new event") + `event-detail.tsx:162` (event→composer link carrying `campaignId`) | Reuse the booking form + the already-correct event→composer link pattern |
| Per-event status + protected/exposed resolver (`src/features/schedule/queries.ts`) | `src/features/msa/queries.ts:40-82` (`loadActiveOrPendingMsa`) + `src/features/quotes/status-display.ts:9` (`displayStatusKey`) | Same query-module shape; reuse the canonical MSA loader + derived-`expired` quote status |
| Event-detail commercial surface (`src/app/(app)/calendar/event-detail.tsx`) | `event-detail.tsx:119` (existing `<Badge>` usage) + `src/components/app/status-badge.tsx` (`QuoteStatusBadge`/`MsaStatusBadge`) | Reuse the in-file badge pattern + shared badge components |
| Booking → commercial-setup hand-off (`src/app/(app)/calendar/calendar-view.tsx`) | `calendar-view.tsx:602` (`onSuccess={closeDialog}`) + `:582-590` (`kind:'detail'` render) | Change post-save: open the new event's detail (the commercial surface) instead of closing |
| Ribbon exposure marker (`src/app/(app)/calendar/calendar-view.tsx`) | `calendar-view.tsx:326-388` (`drawRibbons`) | Same render site; layer the marker onto the existing per-coach ribbon |
| Throwaway fixture (`scripts/0093-calendar-status-smoke.ts`) | `scripts/0041-msa-smoke.ts` (insert/cleanup, tag-idempotent) | Same fixture pattern: seed campaign(s) ± linked quote ± dealer MSA, idempotent cleanup |

**Conventions referenced:**
- `docs/wiki/commercial-spine.md` — Dealer → MSA → Quote → Campaign; MSA per-client, accept gate needs an active MSA, cancellation fee §2iii (don't disturb the lifecycle).
- `docs/wiki/data-model.md` — `quotes` / `campaigns` / `master_service_agreements` columns + FK directions; update when `campaignId` lands.
- `db-conventions` skill — additive nullable FK, migrate on the **session pooler (5432)**, Drizzle journal `when` gotcha, sandbox-before-prod.

**Overall Progress:** 80% (4/5 phases complete)

**Note:**
- Each phase includes both implementation and tests; integration tests come last (Phase 5).
- **Decisions settled** (see `intent.md`): encourage **upfront** + **skippable**; **guided hand-off** (no inline embed); quote **per-event** (`campaignId` app-required); MSA **per-client**; event-less entry points route through an **event step (B)**; **protected = accepted quote + active MSA**, exposed = anything less; cancellation-fee math **out of scope**.
- **Phase 1 carries the invariant:** a required `campaignId` *breaks* the three event-less quote entry points until they're reconciled via the event step — in-scope here, not a follow-up.

### Phase Checklist

#### Phase 1: Data — require quote → event link (`quotes.campaignId`)
- [x] Add `campaignId` bigint FK on `quotes` → `campaigns.id` (`onDelete: 'set null'`); **nullable column** (tolerates legacy) but **app-required for new quotes**. Add `quotes_campaign_id_idx`
- [x] Generate the migration via `db-conventions` (drizzle-kit), verify journal `when` ordering, apply to **sandbox** (session pooler 5432) — `0046_clean_yellowjacket.sql`, applied + verified (column/index/FK present)
- [x] `createQuote`: make `campaignId` **required** — reject a quote with no event; persist on insert (+ event-belongs-to-dealer guard inside the tx)
- [x] **Reconcile the event-less entry points via decision C (event-select in the composer)** — added a required Event `<select>` to `QuoteComposer` (create-mode), scoped to the chosen dealer (`campaigns` prop + `loadCampaigns()` in `/quotes/new`), replacing the old "campaign linkage lands later" placeholder. The dealer-page (`dealerships/[id]:238,253`) + dealer-list-row (`dealers-columns.tsx:301`) + bare "New Quote" (`quotes/page.tsx:23`) entries keep their links; the composer now demands the event. (Owner switched B→C 2026-06-24.) "+ Book a new event" inline option deferred — dealer must have an existing event for now.
- [x] Backfill existing **accepted** quotes from `campaigns.acceptedQuoteId` (reverse link) — custom migration `0047_backfill_quote_campaign_id.sql` (idempotent UPDATE, fills NULLs only); applied to sandbox (0 rows — no accepted-spawned campaigns there; fills on prod)
- [x] Unit test: `createQuote` **rejects** when `campaignId` is absent / event missing / event belongs to another client; **persists** + audits it when present (`actions.test.ts`)

#### Phase 2: Queries — quote + MSA status + protected/exposed
- [x] Resolver: `loadCommercialStatusByCampaign(campaigns)` (`src/features/schedule/commercial-status.ts`) — batch (2 queries, no N+1): latest linked quote per campaign (`quoteDisplayStatus` incl. derived `expired`) + dealer's active-or-pending MSA
- [x] `exposed = !(quoteStatus === 'accepted' && msaStatus === 'active')` — pure `isExposed()` predicate
- [x] ~~Fold the projection into the calendar's campaign load~~ → moved to Phases 3/4 (wired where it's consumed — the calendar page loads it + passes to detail/ribbon — so the diff stays coherent, no unused prop)
- [x] Unit tests: quote accepted vs none vs expired; MSA active vs pending vs none; protected/exposed truth table (`commercial-status.test.ts`, 8 cases)

#### Phase 3: Event-detail commercial surface
- [x] `event-detail.tsx`: render `QuoteStatusBadge` (or "No quote yet") + `MsaStatusBadge` (or "No active MSA") + a prominent **"⚠ Commercially exposed"** / **"✓ Protected"** banner driven by the Phase-2 predicate. Wired the Phase-2 resolver through `calendar/page.tsx` → `calendar-view` (`commercialStatus` prop, string-keyed for RSC serialization) → `EventDetail`
- [x] CTA **"Create Quote"** (kept — already carries `campaignId` + `dealerId`)
- [x] CTA **"Send MSA"** when the client has no active MSA → links to the dealer MSA panel (gated `admin:access`, who can actually send)
- [ ] Visual smoke (manual): exposed card (no quote / no MSA) and protected card → deferred to the SME try-through / chunk-end smoke (Chrome driver not available in this session)

#### Phase 4: Booking → "Create quote now?" hand-off + ribbon exposure marker
- [x] On **"Book Event" success**, replaced `closeDialog` with a **directive prompt** (`booked-prompt` dialog state): "Event booked ✓ — lock in the commercial side" → **`[ Create quote now → ]`** (primary), **`[ Send MSA for signature ]`**, **`I'll do this later`** (quiet skip → close; event stays flagged exposed). `createCampaign` now returns `{ campaignId, dealerId }`; `BookingForm.onSuccess(booked?)` threads it back
- [x] **"Create quote now" → navigates to the prefilled composer page** `/quotes/new?campaignId&dealerId` (NOT an in-calendar modal). **Deliberate deviation from the modal plan:** the just-booked campaign isn't in the calendar's client-side `campaigns` prop until a refresh, so the composer's Event picker wouldn't see it; navigating does a fresh server load where the event is present + prefills cleanly. Same "book → prompt → one-click prefilled composer" encouragement, far more robust. In-modal composer = a later refinement once the SME validates the flow
- [x] `drawRibbons`: overlay an **amber exposed dot** at the ribbon's leading edge on `exposed` events (app mode; `commercialStatus` added to the redraw deps)
- [x] Confirm no regression: `tsc` clean, 1210 unit tests pass; share-mode calendar unaffected (no `commercialStatus`, marker skipped)
- [ ] Visual smoke (manual): book → "Create quote now?" prompt → prefilled composer; exposed ribbon dot → deferred to the SME try-through (Chrome driver not available in this session)

#### Phase 5: Tests + smoke verification
- [ ] Integration test: `createQuote` persists `campaignId` against the real DB; resolver returns correct per-event quote + per-client MSA + protected/exposed
- [ ] Fixture: `scripts/0093-calendar-status-smoke.ts insert` — seed (i) a campaign with an accepted quote + active MSA (protected), (ii) a campaign with no quote + no active MSA (exposed), idempotent by tag
- [ ] Smoke (web-test): `goto /calendar`; open the protected event → Quote + MSA badges + "✓ Protected"; open the exposed event → "No quote yet" / "No active MSA" + "⚠ Commercially exposed" + the two CTAs
- [ ] Smoke (web-test): on `/calendar`, the exposed event's ribbon shows the marker; the protected event's does not
- [ ] `pnpm dlx tsx scripts/0093-calendar-status-smoke.ts cleanup`
- [ ] Ingest to wiki: `data-model.md` (`quotes.campaignId`) + `commercial-spine.md` (booking → upfront commercial setup; exposed/protected on the calendar) + `log.md`
