# Calendar: encourage upfront quote + MSA (protect the commitment) — Intent

**Created:** 2026-06-23

## Problem

The workflow is date-first: a coach books an event (a `campaigns` row) via **"+ Book Event"**, and the Quote and MSA are *follow-up* tasks. Today booking is a **dead-end** — it saves the date and the dialog just closes, with no connection to the commercial work. That leaves a booked event as an **exposed date-hold**: the business has committed a date, a coach, and resources, but the instruments that *protect* that commitment aren't in place.

The protection is the **cancellation fee** — MSA §2(iii): *50% of the accepted Quote total if the Client cancels within 21 days of the Event*. That fee depends on **both**:
- a **signed MSA** (the clause that creates the fee), and
- an **accepted Quote** (the dollar amount the 50% is computed from).

With neither in place, a booked event can be cancelled with no consequence — and the task to set it up is easily missed because nothing drives or surfaces it.

> **SME pushback (2026-06-23):** don't optimize for "do it later" / don't lock that in — **encourage the commercial work upfront, at booking**, so the event is a protected commitment from the start. (Surfaced in planning, pre-code — the cheapest moment to pivot. Requirements like this often only appear once a system is built and used.)

## Desired outcome

Booking still grabs the date fast, but it **leads into the commercial setup** (create/send the Quote; sign the MSA if the client has none) as the **encouraged default** instead of a dead-end close. The goal state for an event is **commercially protected = an accepted Quote + an active MSA**, driven as close to booking as possible. The calendar makes a booked-but-unprotected event visibly **exposed**, as the backstop for anything skipped.

**The commitment chain (resolves the "a quote isn't a commitment yet" tension).** A *created* or *sent* Quote binds no one; only an **accepted** Quote is the contract (MSA §1.iii — the accepted Quote *is* the contract), and acceptance is gated on a **signed MSA** (0082). So "do it upfront" can't mean merely *draft a quote* — the target is **acceptance + signature**. There's also a time-value: the cancellation protection is worth most when in place *well before* the 21-day window, so front-loading maximizes it; deferring erodes it.

## Decisions (settled)

- **Encourage upfront, skippable** — booking leads into the commercial setup as a strong default, but a coach can still "finish later" (you sometimes must grab a date fast). **Not** a hard block on booking.
- **Guided hand-off, not inline embed** — booking routes into the *existing* tools with the event prefilled (the `/quotes/new` composer, the dealer MSA send), then back. We do **not** cram the heavy quote composer / MSA send into the booking modal. Revisit embedding only if the jump-out drags in practice.
- **Quote always scopes to an event** → `quotes.campaignId` is **app-required**; the event-less quote entry points route through an event step (decision **B**).
- **MSA is per-client** (one active MSA covers all the client's events) → the MSA step only fires when the client has **no active MSA**.
- **Date is mutable** post-booking → the quote ⇄ event link is by **stable campaign id**, never by date.
- **"Commercially protected" = accepted Quote + active MSA**; **"exposed" = anything less** — that's the calendar's visibility predicate.

## Non-goals

- **Cancellation-fee calculation / invoicing.** Out of v1 (parked in 0037). This chunk encodes the *principle* (protect the commitment early) into the flow — not the fee math.
- **Full inline embedding** of the quote composer or MSA send inside the booking dialog (we use the guided hand-off).
- **Hard-blocking booking** until a quote/MSA exists (the upfront flow is a skippable default).
- **Re-coupling Quote ⇄ MSA** (0082), reworking the quote/campaign lifecycles or the accept gate, or touching the Google Calendar projection (0077).
- **Keeping a sent quote PDF's embedded event date in sync** when the date moves — that's the existing quote re-send flow (0046).
- **The public "Book Your Event" web intake** (deferred `future/0016`).

## Success criteria

- On **"Book Event" success**, the coach lands on the new event's **commercial setup** (its detail card showing the exposed state + **Create Quote** / **Send MSA** CTAs), not a blank close; **"finish later"** is still available.
- Each event surfaces **per-event Quote status** + **per-client MSA status**, and a clear **exposed / protected** indicator.
- The calendar **ribbon flags exposed events** at a glance (backstop).
- Quote creation from an event carries the `campaignId`; the three event-less entry points route through an event step (B).
- No regression to booking, the accept gate, or gcal sync; the additive nullable migration is applied **sandbox-first** (and prod before deploy).

## Open questions

- **Exposed gradations.** Do we distinguish *no quote / no MSA* (coach must act) from *quote sent, awaiting customer* (no coach action) in the marker? Default: a single "exposed" state until accepted-quote + active-MSA; refine later.
- **Backfill extent.** Best-effort back-link accepted quotes from `campaigns.acceptedQuoteId`; whether to later tighten `campaignId` to NOT NULL once coverage is known.
- **Ever hard-block?** Should booking be *blocked* in some cases (e.g. within 21 days of the event, where protection is most time-critical)? Possible future rule; default skippable for now — confirm with the SME.

## Why now

SME pushback on the "do it later" lock-in, surfaced during planning. The cancellation-fee structure means an unprotected booked event is a real financial exposure, and that protection has the most value when set up early — so the system should *drive* the commercial work upfront rather than defer it. Caught pre-code: the cheapest possible moment to change direction.
