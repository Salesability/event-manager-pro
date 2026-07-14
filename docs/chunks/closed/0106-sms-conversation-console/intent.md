# SMS Conversation Console — Intent

**Created:** 2026-07-14

## Problem

The shipped campaign SMS (0103) invites replies — the default copy says "Reply to book your appointment" — but the Twilio webhook only *acts* on STOP; every other inbound message is acked and discarded (`src/lib/sms/webhook-events.ts` — "two-way console is an intent non-goal"). A customer who texts back "interested" lands in a black hole: nothing is persisted, nobody is notified, no reply ever comes. The first real campaign will generate orphaned replies the moment it launches.

## Desired outcome

Inbound campaign SMS replies become **conversation threads** the team can see and answer, with AI-drafted replies accelerating the response — the vision's Module 3 SMS Console + AI SMS Response (`docs/strategy/vision.md` — three-step draft/review/approve workflow), scoped to v1:

- Every non-STOP inbound to the campaign sender persists as a thread message, associated to the recipient + campaign it most plausibly replies to.
- Staff see new replies (per-campaign panel and/or a global inbox) and can send a reply from the app; outbound replies ride the same `sendSms` redirect doctrine (dev-redirect, opt-out recheck) as campaign sends.
- AI drafts a suggested reply for common intents ("interested", "what time", "not interested", "already bought") from campaign facts only; a team member approves/edits/discards before it sends (draft-and-approve — see Open questions for the autonomy decision).
- STOP always wins: a mid-conversation STOP writes the permanent global opt-out (existing behavior) *and* halts the thread — no further outbound, AI or human, to that number.
- The conversation is logged on the same CASL-grade ledger posture as campaign sends (0105 snapshots).

## Non-goals

- **Fully autonomous AI chat** — not in v1 unless the open question below resolves that way; the vision's model is explicitly human-in-the-loop.
- **Appointment-slot booking substrate** — the vision's Appointment Booking widget (slots, sales-team availability) is its own feature; here "booking" means capturing the customer's appointment intent (day/time preference as structured data or a note), not writing to a slot calendar.
- **Email response console** — vision pairs SMS + email consoles; this chunk is SMS only.
- **AI creative generation for outbound campaign copy** — separate vision feature (Module 2).
- **The traffic app's number/threads** — the Twilio account is shared; this console only touches our campaign Messaging Service (`MG39b6…`), never +19027073043.
- **Automated follow-up sequences / drip** — vision mentions them; out of scope.

## Success criteria

- A non-STOP reply to a campaign send appears as a persisted thread message visible in the UI, linked to the right recipient + campaign.
- Staff can send a reply from the console; it delivers (dev-redirected in non-prod) and appends to the thread.
- An inbound with a recognizable intent gets an AI-drafted reply presented for approve/edit/discard; approving sends it; nothing sends without approval.
- Replying STOP mid-thread permanently opts the number out (existing) **and** provably blocks any further outbound in that thread.
- The AI never asserts facts outside the campaign context (dealer name, event dates/format, opt-out language); drafts disclose automation per the disclosure decision below.
- No regression to the 0103 launch flow or webhook status handling (existing unit + integration tests stay green).

## Open questions

- **Autonomous vs draft-and-approve** *(the key decision)* — the vision specifies AI-drafts + one-click human approval; the product pull is toward autonomous handling of the reply funnel. Liability (AI negotiating on a dealer's behalf), CASL posture, and disclosure obligations all favor draft-and-approve for v1, with autonomy possibly later for narrow non-commercial intents ("what time?", "where?"). Needs an owner call before the AI phase is built.
- **Disclosure** — if/when any AI-composed text sends, does it identify itself as automated? (Recommended; decide the wording and whether it applies to approved-drafts too.)
- **Thread → campaign attribution** — replies arrive keyed only on the From number + our shared sender. When a phone exists in multiple campaigns, which thread does the reply join? (Most-recent-send-to-that-number is the obvious rule; confirm.)
- **Where the console lives** — extend the per-campaign `/calendar/[id]/sms` panel, add a global inbox route, or both? Who needs to see it (capability: `sms:send` or a new one)?
- **Notification** — how does staff learn a reply arrived (in-app badge only, or email notify)? Nothing exists today.
- **AI provider/model** — no LLM dependency exists in the repo yet; provider, model, and where the key lives (Secret Manager, per-env) get decided at the AI phase.
- **Opener copy** — shorter opener ("…interested?") to raise reply rates; still a CEM, so the STOP footer stays. Confirm the new default template copy.

## Why now

0103 shipped with reply-inviting copy and a webhook that discards replies — the gap is live on stage now (rev `-00026-r6z`, inbound webhook already pointed at the app) and becomes customer-visible with the first real campaign. The vision already commits to this surface (Module 3, its phase 6); building the thread capture now also de-risks the eventual booking widget.
