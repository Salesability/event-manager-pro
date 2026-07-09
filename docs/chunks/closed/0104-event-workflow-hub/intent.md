# Event-detail dialog as the commercial-workflow hub — Intent

**Created:** 2026-07-09

## Problem

The core commercial funnel — **Book Event → Create Quote → Send MSA → Mark Accepted → Protected** — has no connective tissue. Each step lives on a different surface and the coach loses their place between them:

- Booking an event opens the event-detail dialog with next-step CTAs ("Create Quote", "Send MSA"). Good start.
- Clicking **Create Quote** runs `createQuote` and `router.push('/quotes/<id>')` ([`quote-composer.tsx:442`](../../../../src/features/quotes/quote-composer.tsx)) — dropping the coach on the quote's edit page (or, after further navigation, the quotes list). **Neither has any link back to the event.** The quote *knows* its `campaignId`, but nothing surfaces it.
- To get back to the event's next step (Send MSA / Mark accepted), the coach must manually go to the calendar, **hunt for the event they were just working on, and re-open it**. The calendar's event-detail dialog is **not URL-addressable** — it only opens via a client-side click (`setDialog({kind:'detail', …})`, [`calendar-view.tsx:423`](../../../../src/app/(app)/calendar/calendar-view.tsx)) — so there's nothing to link back to.

The owner flagged this as a **core workflow** that's too hard: "we need more intelligence to make it efficient for the user."

## Desired outcome

**Chosen direction: the event-detail dialog is the hub** (decided 2026-07-09 — not a new `/events/[id]` workspace page, not a linear wizard). The coach starts at an event, steps out to do a quote or MSA, and is brought **back to that event** with its status updated and the next action surfaced — never having to re-navigate.

Concretely:

1. **The event detail is URL-addressable.** `/calendar?event=<id>` opens that event's detail dialog on load; closing the dialog clears the param. This is the foundation — it's what every step links back to.
2. **The quote step round-trips to the event.** The quote composer shows a persistent **"← [Event name · date]"** link whenever it's scoped to a campaign, and after `createQuote`/save on a campaign-scoped quote it **returns to `/calendar?event=<id>`** (with the quote now showing) instead of dumping on `/quotes/<id>` or the quotes list.
3. **The MSA step round-trips to the event.** The event-detail "Send MSA" path (→ the dealer page) carries the event context and returns to the event after sending.
4. **The event dialog surfaces the NEXT step.** Quote ✓ lights "Send MSA" → dealer signs → "Mark accepted" enables → **Protected**. Reuses the status badges + CTAs recently fixed (Edit/View Quote, waiver toggle hidden on active MSA, the precise "commercially exposed" banner).

## Non-goals

- **No new events table or `/events/[id]` route** — the calendar's event-detail dialog is the hub. `campaigns` already model events; `campaign.id` (and the existing `publicId`) already identify them.
- **No wizard** — steps stay independent and re-enterable; we thread context, not force a linear order.
- **No schema change** — `quotes.campaignId` already ties a quote to its event (0093); nothing new to persist.
- **Not** changing what a quote/MSA *is* or the accept-gate logic — only the *navigation + context* between steps.
- Not building customer-facing self-serve accept (that's a separate, larger question).

## Success criteria

- `goto /calendar?event=<id>` opens that event's detail dialog directly (deep-linkable); closing it strips the param without a full reload.
- From an event, **Create Quote → Save** lands the coach **back on that event's dialog** with the quote status updated and the next CTA (Send MSA / Mark accepted) visible — zero manual re-navigation.
- The quote composer shows a working **"← back to event"** link when campaign-scoped.
- The MSA-send path returns to the event.
- No regression to the standalone `/quotes/new` (dealer-only, no campaign) or `/quotes/[id]` flows for quotes with no campaign link.

## Open questions

- **URL key: numeric `campaign.id` vs `publicId`?** `id` is simplest for an internal gated route; `publicId` avoids exposing sequential ids. Lean `id` (the route is auth-gated, ids already appear in `/quotes/<id>` etc.) — confirm during build.
- **Return after an *edit*-mode quote save** (`setQuoteInputs`, which currently `reset()` + `router.refresh()` and stays put): also bounce back to the event, or stay on the quote? Leaning: keep edit-mode staying on the quote, but add the "← event" link there too, so the coach chooses. Resolve in Phase 2.
- **MSA return** — the MSA send is admin-gated on the dealer page (per-client, not per-event). Threading a per-event return target through a per-dealer page needs a lightweight `?returnEvent=<id>` query param; confirm that's the cleanest carrier in Phase 3.

## Why now

The owner is actively running this funnel on prod (real dealers, real quotes/MSAs) and hitting the re-navigation friction every time — it's the day-to-day path, not an edge case. The recent event-detail fixes (quote CTA, waiver toggle, banner copy, MSA backfill) already made the *destination* dialog good; this chunk makes *getting back to it* effortless, which is the missing half of the workflow.
