# Appointment booking via tokenized public link — Intent

**Created:** 2026-07-14

## Problem

Campaign SMS invites customers to "book your appointment", but there is no way to actually book one: replies land in the conversation console (0106/0107) where a staff member has to read them, negotiate a time by text, and record the result somewhere off-app. The AI-chatbot path that was meant to absorb this (auto-drafted replies → approval queue → autonomy) is under owner rethink — it concentrates compliance risk (rich PII in prompts, PIPEDA), autonomy risk ("approvals cannot be missed"), and AI judgment on commercial intent, all to handle what is mostly a deterministic transaction: *pick a time slot*.

The owner's new direction (2026-07-14): give every opted-in recipient a unique HTTP link that books the appointment on a web page instead. The transaction moves to a deterministic, self-serve surface; the conversation console remains the human fallback for people who text back anyway.

## Desired outcome

**This chunk is step 1 of the direction: the booking substrate + public page — no SMS changes.**

- A campaign can carry a bookable **slot grid** over its event days (times + per-slot capacity).
- Every `sms_recipients` row can carry a unique, unguessable **booking token**.
- A public page at `/book/<token>` (no login) greets the recipient by name ("Hi Sarah — pick your time at Summerside Hyundai"), shows the campaign's available slots, and lets them book **exactly one** appointment. Revisiting the link shows the existing booking.
- Bookings land **in-app** — a real appointments table, visible to staff on the event's surface (who booked, phone, slot time), surviving the 24-month recipient purge (the appointment snapshots the customer's name/phone rather than depending on the recipient row).
- Staff can see at a glance how many bookings each slot has (sent → booked attribution comes with chunk 2's link sends).

Chunk 2 (separate): the `{{booking_link}}` template token in the campaign send path + confirmation SMS.

## Non-goals

- **Any SMS change** — no `{{booking_link}}` token, no confirmation/reminder texts, no send-path edits. This chunk must be shippable with links handed out manually.
- **The AI-draft/approval-queue path** — parked with the SMS-AI rethink (branch `0103-sms-service`, see 0107's pause note). The conversation console stays as-is as the human fallback.
- **External scheduler integration** (Calendly etc.) — bookings are in-app; that's the data substrate the Module-1 vision wants (durable, named customers with intent).
- **Coach assignment / capacity planning per coach** — a booking attaches to a campaign slot, not to a specific coach.
- **Staff-side manual booking / walk-in entry** — staff view is read-first in this chunk; manual entry can follow if the owner wants it.
- **Cancel/reschedule self-serve flows** — v1 is book-once; changes go through the dealer/staff. (Revisit if it proves annoying.)

## Success criteria

- Visiting `/book/<valid-token>` with no session renders the greeting (recipient first name + dealer name + event dates) and the slot grid; invalid/unknown token → not-found, never a login redirect.
- Booking a slot persists an appointment row (campaign, slot, recipient link + name/phone snapshot), decrements that slot's visible availability, and re-rendering the link shows the booked state instead of the grid.
- A second booking attempt via the same token is refused (server-enforced, not just UI) — one appointment per recipient.
- A full slot is not bookable (capacity enforced under concurrency, not just display).
- Staff see the campaign's slots + appointments on the event's surface behind the normal auth gate.
- Appointment rows survive deletion of their `sms_recipients` row (retention: recipients hard-delete at 24 months).

## Open questions

- **Slot grid shape (owner call):** who defines it and what's the default — e.g. half-hour slots across each event day 9–5, capacity N per slot? Per-campaign editable grid, or a fixed template to start?
- **Slot capacity default (owner call):** how many appointments per slot?
- **What the page collects:** pre-filled name/phone from the recipient — do we ask for anything else (email, vehicle of interest, notes)? Lean v1 says no.
- **Token lifetime:** does the link die after the event ends (probably: token resolves but page shows "this event has passed")?
- **Who builds the slot grid in-app:** admin-only (`sms:send`-adjacent) or the event's coach too?

## Why now

The SMS-AI rethink (2026-07-14) paused the chatbot/approval-queue path mid-flight. This direction keeps everything that's already built and valuable (0103 send engine, 0105 ledger, consent machinery, conversation console as fallback), dissolves the compliance/autonomy questions that triggered the rethink, and produces the first durable customer-intent records in the app — real named customers picking appointment times, not purged CSV rows. It's also the strongest sell for the SMS add-on: a sent → clicked → booked funnel per campaign.
