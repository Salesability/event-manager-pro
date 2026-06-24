# Calendar quote + MSA status — Plan

**Intent:** [`intent.md`](intent.md)
**Started:** 2026-06-23

## Progress Tracker

| Phase | Status | Commit |
|-------|--------|--------|
| 1: Data — link quote → event (`quotes.campaignId`) | Pending | - |
| 2: Queries — resolve per-event quote + per-client MSA status | Pending | - |
| 3: Event-detail card — badges + CTAs | Pending | - |
| 4: Calendar ribbon — needs-attention marker | Pending | - |
| 5: Tests + smoke verification | Pending | - |

The calendar is blind to commercial status: a booked event (`campaigns` row) shows no signal that its **Quote** or the client's **MSA** is still outstanding, so the follow-up gets missed. This chunk makes each event surface its **per-event quote status** and its **per-client MSA status** — as badges on the event card and an at-a-glance "needs attention" marker on the calendar ribbon — and puts the create-quote / send-MSA actions one click from the booking. "Done" = a coach can see, per event, whether the quote and MSA are in place, and act on the gap without leaving the calendar. The only schema change is an additive, nullable `quotes.campaignId` so a quote can be tied to the event it was raised for.

## Code Anchors

For each new file or method below, the builder reads the anchor first and matches its shape (length, error handling, naming, query style). For modifications to an existing file, the anchor is the nearest sibling method in that same file.

| New code | Anchor (`path:line`) | Why this anchor |
|----------|---------------------|-----------------|
| `quotes.campaignId` nullable FK + index (`src/lib/db/schema/quotes.ts`) | `src/lib/db/schema/quotes.ts:87` (`previousQuoteId` nullable bigint `.references()`) + `:101-102` (dealer indexes) | Same shape: nullable bigint FK to a domain table + a matching index, in the same file |
| Additive migration (`drizzle/NNNN_*.sql`) | most recent additive migration in `drizzle/` (the 0042/0043 `dealers`/`is_primary` adds) + `db-conventions` skill | Same migration style (nullable column add, no backfill required); journal `when` gotcha applies |
| `createQuote` persists `campaignId` (`src/features/quotes/actions.ts`) | the existing `createQuote` in the same file (nearest sibling) | Modify in place — match its input parse + insert shape; Zod parse, no yup |
| `/quotes/new` carries `campaignId` into the action (`src/app/(app)/quotes/new/page.tsx:27`) | same file — `initialCampaignId` resolution already present at `:27` | Thread the already-resolved id through to the create call |
| Per-event commercial-status resolver (`src/features/schedule/queries.ts`) | `src/features/msa/queries.ts:40-82` (`loadActiveOrPendingMsa`) + `src/features/quotes/status-display.ts:9` (`displayStatusKey`) | Same query-module shape; reuse the canonical MSA loader + the derived-`expired` quote status |
| Event-detail badges + CTAs (`src/app/(app)/calendar/event-detail.tsx`) | `event-detail.tsx:119` (existing `<Badge>` status usage) + `src/components/app/status-badge.tsx` (`QuoteStatusBadge`/`MsaStatusBadge`) | Reuse the in-file badge pattern + the shared badge components — no new badge styling |
| Ribbon needs-attention marker (`src/app/(app)/calendar/calendar-view.tsx`) | `calendar-view.tsx:326-388` (`drawRibbons`) | Same render site; marker layers onto the existing per-coach ribbon without disturbing color/label |
| Throwaway fixture (`scripts/0093-calendar-status-smoke.ts`) | `scripts/0041-msa-smoke.ts` (insert/cleanup, tag-idempotent) | Same fixture pattern: seed campaign(s) ± linked quote ± dealer MSA, idempotent cleanup |

**Conventions referenced:**
- `docs/wiki/data-model.md` — `quotes` / `campaigns` / `master_service_agreements` columns + FK directions; update it when `campaignId` lands.
- `docs/wiki/commercial-spine.md` — Dealer → MSA → Quote → Campaign flow; MSA is per-client, quote per-deal, accept gate needs an active MSA (don't disturb).
- `db-conventions` skill — additive nullable FK, migrate on the **session pooler (5432)**, Drizzle journal `when` gotcha, sandbox-before-prod.

**Overall Progress:** 0% (0/5 phases complete)

**Note:**
- Each phase includes both implementation and tests.
- Integration tests come last (Phase 5), after the feature phases pass — verifies real DB behavior (the `campaignId` persistence + resolver).
- **Settle Open question (a) scope tier and (c) "needs attention" definition before starting Phase 3/4** — they shape the UI and the marker predicate.

### Phase Checklist

#### Phase 1: Data — link quote → event (`quotes.campaignId`)
- [ ] Add nullable `campaignId` bigint FK on `quotes` → `campaigns.id` (`onDelete: 'set null'`) + `quotes_campaign_id_idx`
- [ ] Generate the migration via `db-conventions` (drizzle-kit), verify journal `when` ordering, apply to **sandbox** (session pooler 5432)
- [ ] Persist `campaignId` in `createQuote` (Zod-parse the optional id; insert it)
- [ ] Thread `initialCampaignId` from `/quotes/new` through to `createQuote` (the "Create Quote" CTA already passes `?campaignId=`)
- [ ] Unit test: `createQuote` with a `campaignId` persists it; without → `null`

#### Phase 2: Queries — resolve per-event quote + per-client MSA status
- [ ] Resolver: given a campaign, return its linked quote (`quotes.campaignId = campaign.id`, latest) + `displayStatusKey`, and the dealer's MSA via `loadActiveOrPendingMsa(dealerId)`
- [ ] Decide + implement the `needsAttention` predicate (Open question c) — default: `(no linked quote OR quote not accepted) OR (no active MSA)`
- [ ] Fold the projection into the calendar's campaign load (`src/features/schedule/queries.ts`) so ribbons + detail get status without N extra round-trips
- [ ] Unit tests: quote-accepted vs none vs expired; MSA active vs pending vs none; `needsAttention` truth table

#### Phase 3: Event-detail card — badges + CTAs
- [ ] `event-detail.tsx`: render `QuoteStatusBadge` (or "No quote yet") + `MsaStatusBadge` (or "No active MSA")
- [ ] CTA "Create Quote" shown when no linked quote (carry `campaignId` + `dealerId`, as today)
- [ ] CTA "Send MSA for signature" shown when the client has no active MSA (link to the dealer MSA panel; light — no inline send in this tier)
- [ ] Visual smoke (manual): card with quote+MSA present, and card with both missing → screenshot path

#### Phase 4: Calendar ribbon — needs-attention marker
- [ ] `drawRibbons`: overlay a small marker on events where `needsAttention` is true (treatment per Open question b — dot/icon, legible over the coach color)
- [ ] Optional: a legend entry and/or a "needs attention" filter pill alongside the coach filter
- [ ] Visual smoke (manual): a needs-attention event vs. a complete event on the grid → screenshot path

#### Phase 5: Tests + smoke verification
- [ ] Integration test: `createQuote` persists `campaignId` against the real DB; resolver returns correct per-event quote + per-client MSA status
- [ ] Fixture: `scripts/0093-calendar-status-smoke.ts insert` — seed (i) a campaign with a linked accepted quote + active MSA, (ii) a campaign with no quote + no active MSA, idempotent by tag
- [ ] Smoke (web-test): `goto /calendar`; open the seeded event detail → expect Quote badge + MSA badge (and the "No quote yet" / "No active MSA" variants on the second event)
- [ ] Smoke (web-test): on `/calendar`, the needs-attention event's ribbon shows the marker; the complete event's does not
- [ ] `pnpm dlx tsx scripts/0093-calendar-status-smoke.ts cleanup`
- [ ] Ingest to wiki: `data-model.md` (`quotes.campaignId`) + `commercial-spine.md` (calendar surfaces quote/MSA status) + `log.md`
