# Calendar quote + MSA status — Intent

**Created:** 2026-06-23

## Problem

The real-world workflow is **date-first**: a coach opens the in-app calendar, clicks **"+ Book Event"**, and locks a date — which creates a `campaigns` row. The **Quote** and the **MSA** are *follow-up* tasks done afterward (build/send/accept the quote; get the client's master agreement signed). Nothing on the calendar shows whether those follow-ups are still outstanding, so a booked event can sit quietly with no quote and/or an unsigned MSA. The task "is easily missed" — which is exactly the feedback that started this chunk. The calendar is where the booking lives, so it's the natural home for the nudge.

## Desired outcome

Looking at the calendar, a coach can tell **per booked event** whether:
- a **Quote** is in place and where it stands (draft / sent / accepted / declined / expired), and
- the client is under an **active MSA** (pending / active / expired / terminated / none).

Events still missing a quote or an active MSA are visually flagged at a glance (without opening the card), and acting on the gap is one click away from the event (create the quote, send the MSA).

**Every quote belongs to an event (invariant).** A quote does not exist on its own — it is *always* scoped to an event (campaign). So `quotes.campaignId` is **required for new quotes** (app-enforced), not an optional convenience link. The DB column stays nullable only to tolerate legacy rows; new quotes must carry an event. This has a direct consequence: every quote-creation entry point must supply an event. Today three of the four entry points do **not** (the bare "New Quote" on `/quotes`, and the dealer-scoped "Create Quote" on the dealer detail page + dealer-list row) — they create dealer-only quotes. Under this invariant those must change (route through event selection / creation, or be removed). See Open question (e).

**Date is mutable, link is not.** The booked date is provisional — coaches routinely move the event date *while working the quote* (the quote process settles the real date). The quote ⇄ event link must therefore be by **stable campaign id** (`quotes.campaignId`), never by date, so a quote stays attached to its event across date changes. (Keeping date-sensitive *content inside* a sent quote PDF in sync when the date moves is the existing quote re-send flow — see Non-goals.)

## Non-goals

- **Full inline creation of the quote inside the calendar dialog.** This chunk surfaces status and links/CTAs to the existing create flows (`/quotes/new`, the dealer MSA panel). A fully embedded "compose + send quote/MSA without leaving the calendar" experience is a *possible later phase*, not this one. (Scope tier — see Open questions.)
- **Changing the quote ⇄ MSA decoupling (chunk 0082).** A quote still does not reference an MSA; the MSA stays per-client. We are *not* re-coupling them.
- **The public "Book Your Event" web intake.** That's the deferred `future/0016-book-your-event-intake` chunk; this chunk is the in-app calendar only.
- **Keeping a sent quote PDF's embedded event date in sync when the date moves.** A quote that already went out with an old date is refreshed via the existing quote **re-send** flow (chunk 0046), not by this chunk. We only track *which* event a quote belongs to, not re-render its contents.
- **Reworking the campaign/quote/MSA lifecycles or the accept gate.** We read existing status; we don't change state machines.
- **Google Calendar projection (0077).** The outward gcal sync is untouched; this is the in-app month grid.

## Success criteria

- Each event's detail card shows a **Quote status** badge (or "No quote yet") and an **MSA status** badge (or "No active MSA"), reusing `QuoteStatusBadge` / `MsaStatusBadge`.
- Quote status is resolved **per event** (the quote linked to *that* campaign), not per client — so two events for the same client with different quote progress read differently.
- MSA status is resolved **per client** (the dealer's active/pending MSA) and shown on each of that client's events.
- The calendar ribbon carries an at-a-glance **"needs attention"** marker for events missing a quote or an active MSA.
- From the event, a coach can reach **Create Quote** (when none exists, carrying the campaign link) and **Send MSA for signature** (when the client has no active MSA).
- No regression to booking, the quote accept gate, or gcal sync; migration is additive/nullable and applied to sandbox (and prod when shipped) before deploy.

## Open questions

- **(a) Scope tier.** Confirm this chunk is "calendar feedback + CTAs that link out" vs. also building full **inline create-quote / send-MSA from the event dialog**. (Recommended: feedback + CTAs first; inline create as a follow-up.) — *user asked to clarify; settle before Phase 3/4 UI.*
- **(b) Ribbon marker treatment.** Dot vs. icon vs. ribbon color/desaturation for "needs attention"? Must stay legible alongside the existing per-coach ribbon color.
- **(c) "Needs attention" definition.** Exactly what flags an event: no quote at all? quote not yet accepted? no active MSA? a date-proximity factor (e.g. only flag events within N days)? Likely: *(no linked quote OR linked quote not accepted) OR (client has no active MSA)* — confirm.
- **(d) Quote backfill.** Existing quotes have no `campaignId`; pre-existing events won't show a linked quote until re-linked. Acceptable (forward-only), or do we attempt a best-effort backfill from `campaigns.acceptedQuoteId`? (An accepted quote already pointed-to by a campaign can be back-linked cheaply.)
- **(e) Event-less quote entry points** *(opened by the "every quote belongs to an event" invariant).* The bare **"New Quote"** on `/quotes` and the **"Create Quote"** on the dealer detail page + dealer-list row currently start a quote with only a dealer (no event). Under the invariant they must change. Options: **(A)** remove them — quotes can only be started from an event on the calendar; **(B)** route them through an **event step** first (pick an existing event for the dealer, or create one), then proceed to the composer; **(C)** add an event picker inside the composer that's required before the quote can be saved. Recommendation: **B** (least surprising — keeps the dealer-first entry but inserts the event the quote will scope to). Whether to enforce `campaignId` NOT NULL at the DB (vs. app-only) depends on whether (d)'s backfill reaches 100%.

## Why now

The MSA e-signature surface just went live in prod (counter-signature shipped 2026-06-23, rev `-00036-fhh`), so the quote→MSA→sign loop is fully operational — which makes "the MSA/quote step silently not happening for a booked event" a live operational risk rather than a hypothetical. The owner surfaced it directly as workflow feedback: the calendar is where they live day-to-day, and it's blind to commercial status today.
