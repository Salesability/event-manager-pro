# Event-detail dialog as the commercial-workflow hub — Plan

**Intent:** [`intent.md`](intent.md)
**Started:** 2026-07-09

## Progress Tracker

| Phase | Status | Commit |
|-------|--------|--------|
| 1: URL-addressable event detail (`?event=<id>`) | Done | `20bae53` |
| 2: Quote step round-trips to the event | Done | `d14d333` |
| 3: MSA step round-trips to the event | Pending | - |
| 4: Next-step emphasis + tests + browser verify | Pending | - |

Make the calendar event-detail dialog the hub for the commercial funnel: deep-linkable via `?event=<id>`, and every step (quote, MSA) returns the coach to that event with updated status + the next CTA. "Done" = create-quote-from-an-event round-trips back to the event dialog with no manual re-navigation, and `/calendar?event=<id>` opens the right event directly.

## Code Anchors

For a modification to an existing file, the anchor is the nearest sibling in that same file.

| New code | Anchor (`path:line`) | Why this anchor |
|----------|---------------------|-----------------|
| `searchParams` → read `?event=` in the page | [`src/app/(app)/calendar/page.tsx:15`](../../../src/app/(app)/calendar/page.tsx) (`CalendarPage`, currently no props) | Add the standard App-Router async `searchParams` prop; pass `initialEventId` down to `CalendarView` alongside the existing props (`:43`) |
| Open-event-on-load + strip-param-on-close | [`calendar-view.tsx:423`](../../../src/app/(app)/calendar/calendar-view.tsx) (`setDialog({kind:'detail', campaign: ev})`) + the existing `useEffect` (`:436`) + `closeDialog` (`:113`) | Mirror the existing detail-open; add a `useEffect` that opens the dialog for `initialEventId` from the loaded `campaigns`, and `router.replace('/calendar')` in `closeDialog` to clear the param |
| Quote composer post-save return + "← event" link | [`quote-composer.tsx:442`](../../../src/features/quotes/quote-composer.tsx) (`router.push('/quotes/<id>')`) + the dealer-events memo (`:337`) | Redirect campaign-scoped `createQuote` to `/calendar?event=<campaignId>`; render a back-link header from the selected campaign's label (composer already has `useRouter` + `campaigns` + `campaignId`) |
| `Quote.campaignId` on the read-model (edit-mode back-link) | [`queries.ts:27`](../../../src/features/quotes/queries.ts) (`Quote` type + `projection` + `QuoteRow` + `mapRow`) | Add `campaignId: number \| null` to all four so the edit page can resolve the linked event; edit page loads it via `loadCampaign(quote.campaignId)` and passes `campaigns={[campaign]}` (label-only — no picker in edit-mode) |
| MSA-send return target (`?returnEvent=<id>`) | [`event-detail.tsx`](../../../src/app/(app)/calendar/event-detail.tsx) "Send MSA" (`href={/dealerships/${dealerId}}`) + the dealer-page MSA send-button/dialog | Thread a `returnEvent` query param through the per-dealer MSA send so it returns to `/calendar?event=<id>` |
| Next-step emphasis in the event dialog | [`event-detail.tsx`](../../../src/app/(app)/calendar/event-detail.tsx) (the recently-fixed CTAs: Edit/View Quote, Send MSA, waiver, banner) | Highlight the single next action; reuse existing badges/`commercial` status — no new status logic |

**Conventions referenced:**
- Next.js App Router: page components receive `searchParams` as a prop (async in this codebase); `CalendarView` is a `'use client'` component — use `useRouter`/`useSearchParams` for param changes, `router.replace` to avoid history spam.
- `quotes.campaignId` (0093) is the event↔quote link; `commercial-status.ts` already computes the per-event quote/MSA status the dialog renders.
- Event-detail CTAs + banner were refined this session (Edit/View Quote, waiver-toggle-hide, precise banner) — build on them, don't re-litigate.

**Overall Progress:** 50% (2/4 phases complete)

**Note:**
- **No DB, no migration, no new secret** — pure navigation/context wiring over existing data.
- Keep the standalone quote flows working: a quote with **no** `campaignId` (dealer-only `/quotes/new`) must not try to bounce to a nonexistent event.

### Phase Checklist

#### Phase 1: URL-addressable event detail (`?event=<id>`)
- [x] Add `searchParams` to `CalendarPage` (`page.tsx:15`); parse `event` → `initialEventId: number | null`; pass to `CalendarView`.
- [x] In `CalendarView`, add a `useEffect` that, on mount / when `initialEventId` changes, finds the campaign with that id in the loaded `campaigns` and `setDialog({kind:'detail', campaign})`. No-op if not found (stale/deleted event). _(Ref-latches per id so an unrelated re-render can't yank the user back to detail from another dialog.)_
- [x] `closeDialog` (`:113`) also strips the param: `router.replace('/calendar')` (only when a param is present, to avoid needless replaces).
- [x] Guard: `?event=` for an event outside the loaded date range / archived → dialog just doesn't open (no crash); consider widening the load or a fallback fetch only if it's a real gap. _(The `campaigns.find` guard no-ops when absent; the page loads a wide year-1→year+1 range so in-range events resolve.)_
- [ ] Verify: `goto /calendar?event=<real id>` opens that event's detail dialog; closing returns the URL to `/calendar`. _(Covered by the Phase 4 chunk-end browser smoke.)_

#### Phase 2: Quote step round-trips to the event
- [x] In `quote-composer.tsx`, change the post-`createQuote` redirect (`:442`) so that when `values.campaignId` is set it does `router.push('/calendar?event=' + campaignId)` instead of `/quotes/<id>`; keep `/quotes/<id>` for a dealer-only (no-campaign) quote.
- [x] Add a persistent **"← [event label]"** link at the top of the composer when `campaignId` is set, pointing at `/calendar?event=<campaignId>` (label from the selected campaign in the `campaigns` memo). _(Create-mode tracks the live picker selection; edit-mode uses the row's fixed `campaignId`.)_
- [x] Decide edit-mode (`setQuoteInputs`) behavior per intent open question — at minimum show the same "← event" link on `/quotes/[id]` when the quote has a `campaignId`. _(Resolved: edit-mode **stays put** on save (`setQuoteInputs` keeps its `reset()`+`router.refresh()`); the "← event" link is added so the coach can choose to return. Threaded `Quote.campaignId` through the read-model + `loadCampaign` in the edit page for the label.)_
- [ ] Verify: booking → Create Quote → Save Draft lands back on the event dialog with the quote status now shown; the "← event" link works from the composer. _(Covered by the Phase 4 chunk-end browser smoke — navigation/presence only; create-quote is a mutation.)_

#### Phase 3: MSA step round-trips to the event
- [ ] Add a `returnEvent` query param path: event-detail "Send MSA" links to `/dealerships/${dealerId}?returnEvent=${campaignId}`; the dealer-page MSA send-dialog, on success, routes back to `/calendar?event=<returnEvent>` when the param is present (else its current behaviour).
- [ ] Show a "← [event]" affordance on the dealer page when `returnEvent` is set, so an admin who went there to send an MSA can get back without the send.
- [ ] Verify: from an event with no MSA, Send MSA → dealer page (event context shown) → after send, back on the event dialog.

#### Phase 4: Next-step emphasis + tests + browser verify
- [ ] In `event-detail.tsx`, visually emphasize the single next action based on `commercial` status (no accepted quote → Create/Edit Quote; quote sent + no MSA → Send MSA; both ready → Mark accepted). Reuse existing CTAs/badges; don't add new status logic.
- [ ] Unit-test the pure bits (e.g. an `initialEventId` parse helper, and any "which step is next" selector if extracted).
- [ ] Browser smoke (web-test, read-only): `goto /calendar?event=<id>` opens the right dialog; open a booked event → the correct next-step CTA is emphasized; the composer "← event" link is present. (Do NOT drive create-quote/send in the smoke — those are mutations; verify the wiring by navigation + presence.)
- [ ] Wiki: note the event-detail-as-hub + `?event=` deep-link convention in `docs/wiki/` (layout or a calendar page).

**Verification note:** most of this is browser-driveable (deep-link opens the right event; the "← event" link + next-step CTA are present). The full create-quote round-trip is a *mutation* (creates a real quote), so smoke it by navigation/presence, not by actually submitting — or add a throwaway fixture+cleanup script if a real round-trip must be exercised.
