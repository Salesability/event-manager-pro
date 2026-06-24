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

- **(a) Scope tier — RESOLVED → Tier 1 (show + link).** The chunk surfaces quote/MSA status and **links out** to the existing tools (the `/quotes/new` composer, the dealer MSA panel); it does **not** embed creation. Rationale (owner): coaches **grab a date and do the quote/MSA work later**, so the win is *visibility* (don't miss it), not saving clicks at booking time — and the quote composer is heavy while the MSA send is once-per-client-per-year, so inlining is high-cost / low-frequency. **Full inline create — and even the booking→quote/MSA hand-off prompt — are deferred** (revisit only if the jump-out proves a drag in practice). Keeps the build fast.
- **(b) Ribbon marker treatment — DEFAULT (finalize in build/smoke):** a small **amber "needs-attention" dot** at the ribbon's leading edge, kept legible over the per-coach ribbon color; settle the exact glyph/placement against a real screenshot in Phase 4.
- **(c) "Needs attention" definition — DEFAULT:** flag an event until **both** its quote is *accepted* **and** the client has an *active* MSA — `needsAttention = !(quote?.status === 'accepted' && msa?.status === 'active')`. Covers no-quote, draft/sent/declined/expired quote, and no/pending/expired MSA. Possible later refinement: split *coach-action-needed* (no quote / no MSA) from *awaiting-customer* (quote sent) — out of scope for v1.
- **(d) Quote backfill — DEFAULT:** best-effort back-link existing **accepted** quotes from `campaigns.acceptedQuoteId`; leave the rest null. Keep `campaignId` **nullable at the DB** (app-required for new quotes); defer any NOT-NULL tightening until backfill coverage is known. Pre-existing draft/sent quotes simply won't show a per-event link — acceptable.
- **(e) Event-less quote entry points** — **RESOLVED → B (event step).** *(Opened by the "every quote belongs to an event" invariant.)* The **"Create Quote"** on the dealer detail page + dealer-list row, and the bare **"New Quote"** on `/quotes`, currently start a quote with only a dealer (or nothing). Decision: route them through an **event step** — pick an existing event for the dealer or **Book a new event**, then continue to the composer with the chosen `campaignId`. (Rejected: A = remove them outright — too blunt; C = event picker inside the composer — defers the choice too late.) For the bare `/quotes` entry (no dealer), the step is dealer-select → event-select/create → composer. Concrete wiring in `plan.md` Phase 1. Still open: whether to tighten `campaignId` to NOT NULL at the DB (vs. app-only), which depends on whether (d)'s backfill reaches 100%.

## Why now

The MSA e-signature surface just went live in prod (counter-signature shipped 2026-06-23, rev `-00036-fhh`), so the quote→MSA→sign loop is fully operational — which makes "the MSA/quote step silently not happening for a booked event" a live operational risk rather than a hypothetical. The owner surfaced it directly as workflow feedback: the calendar is where they live day-to-day, and it's blind to commercial status today.
