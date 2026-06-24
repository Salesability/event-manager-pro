# Calendar: encourage upfront quote + MSA (protect the commitment) — Plan

**Intent:** [`intent.md`](intent.md)
**Started:** 2026-06-23

## Progress Tracker

| Phase | Status | Commit |
|-------|--------|--------|
| 1: Data — require quote → event link + reconcile entry points | Pending | - |
| 2: Queries — quote + MSA status + protected/exposed | Pending | - |
| 3: Event-detail commercial surface — badges + exposed + CTAs | Pending | - |
| 4: Booking hand-off + ribbon exposure marker | Pending | - |
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

**Overall Progress:** 0% (0/5 phases complete)

**Note:**
- Each phase includes both implementation and tests; integration tests come last (Phase 5).
- **Decisions settled** (see `intent.md`): encourage **upfront** + **skippable**; **guided hand-off** (no inline embed); quote **per-event** (`campaignId` app-required); MSA **per-client**; event-less entry points route through an **event step (B)**; **protected = accepted quote + active MSA**, exposed = anything less; cancellation-fee math **out of scope**.
- **Phase 1 carries the invariant:** a required `campaignId` *breaks* the three event-less quote entry points until they're reconciled via the event step — in-scope here, not a follow-up.

### Phase Checklist

#### Phase 1: Data — require quote → event link (`quotes.campaignId`)
- [ ] Add `campaignId` bigint FK on `quotes` → `campaigns.id` (`onDelete: 'set null'`); **nullable column** (tolerates legacy) but **app-required for new quotes**. Add `quotes_campaign_id_idx`
- [ ] Generate the migration via `db-conventions` (drizzle-kit), verify journal `when` ordering, apply to **sandbox** (session pooler 5432)
- [ ] `createQuote`: make `campaignId` **required** (Zod) — reject a quote with no event; persist on insert
- [ ] **Reconcile the event-less entry points via an event step (decision B):** "Create Quote" on the dealer page (`dealerships/[id]/page.tsx:238,253`) + dealer-list row (`dealers-columns.tsx:301`) → first pick an existing event for that dealer or **Book a new event** (reuse `BookingForm`), then continue to the composer with the chosen `campaignId`. The bare "New Quote" on `/quotes` (`quotes/page.tsx:23`) → dealer-select → event-select/create → composer
- [ ] Backfill existing **accepted** quotes from `campaigns.acceptedQuoteId` (reverse link); leave the rest null
- [ ] Unit test: `createQuote` **rejects** when `campaignId` is absent; persists it when present

#### Phase 2: Queries — quote + MSA status + protected/exposed
- [ ] Resolver: given a campaign, return its linked quote (`quotes.campaignId = campaign.id`, latest) + `displayStatusKey`, and the dealer's MSA via `loadActiveOrPendingMsa(dealerId)`
- [ ] `commerciallyProtected = quote?.status === 'accepted' && msa?.status === 'active'`; `exposed = !commerciallyProtected`
- [ ] Fold the projection into the calendar's campaign load (`src/features/schedule/queries.ts`) so ribbons + detail get status without N extra round-trips
- [ ] Unit tests: quote accepted vs none vs expired; MSA active vs pending vs none; protected/exposed truth table

#### Phase 3: Event-detail commercial surface
- [ ] `event-detail.tsx`: render `QuoteStatusBadge` (or "No quote yet") + `MsaStatusBadge` (or "No active MSA") + a prominent **"⚠ Commercially exposed"** / **"✓ Protected"** line driven by the Phase-2 predicate
- [ ] CTA **"Create Quote"** when no/incomplete quote (carry `campaignId` + `dealerId`, as today)
- [ ] CTA **"Send MSA for signature"** when the client has no active MSA (link to the dealer MSA panel — the existing send surface; no inline send)
- [ ] Visual smoke (manual): exposed card (no quote / no MSA) and protected card (accepted quote + active MSA) → screenshot path

#### Phase 4: Booking hand-off + ribbon exposure marker
- [ ] On **"Book Event" success**, open the new event's **detail card** (the Phase-3 commercial surface) instead of `closeDialog` — coach lands on the exposed state + CTAs (encourage upfront). Needs `createCampaign` to return enough to open the detail (return the row, or refetch by id); "finish later" = close the card (skippable)
- [ ] `drawRibbons`: overlay an **amber needs-attention dot** on `exposed` events (legible over the per-coach color); optional "needs attention" filter pill alongside the coach filter
- [ ] Confirm no regression to the edit flow / availability dialog / gcal re-sync
- [ ] Visual smoke (manual): book an event → land on its (exposed) detail card; an exposed vs. protected event on the grid → screenshot path

#### Phase 5: Tests + smoke verification
- [ ] Integration test: `createQuote` persists `campaignId` against the real DB; resolver returns correct per-event quote + per-client MSA + protected/exposed
- [ ] Fixture: `scripts/0093-calendar-status-smoke.ts insert` — seed (i) a campaign with an accepted quote + active MSA (protected), (ii) a campaign with no quote + no active MSA (exposed), idempotent by tag
- [ ] Smoke (web-test): `goto /calendar`; open the protected event → Quote + MSA badges + "✓ Protected"; open the exposed event → "No quote yet" / "No active MSA" + "⚠ Commercially exposed" + the two CTAs
- [ ] Smoke (web-test): on `/calendar`, the exposed event's ribbon shows the marker; the protected event's does not
- [ ] `pnpm dlx tsx scripts/0093-calendar-status-smoke.ts cleanup`
- [ ] Ingest to wiki: `data-model.md` (`quotes.campaignId`) + `commercial-spine.md` (booking → upfront commercial setup; exposed/protected on the calendar) + `log.md`
