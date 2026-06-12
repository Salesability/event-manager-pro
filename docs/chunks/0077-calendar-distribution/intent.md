# Calendar Distribution — Intent

**Created:** 2026-06-12

## Problem

Today the only way a booked SaleDay event reaches the people who need it — the coach who works it and the dealership contact whose store it's at — is Shannon **manually** creating a Google Calendar event on her **personal** calendar ("ST Personal") and typing all the detail into the description (see the reference screenshot in this folder's discussion). That means:

- The business runs off **one person's personal calendar** — single point of failure, no shared source of truth, walks out the door if Shannon does.
- **Internal ops data leaks** into the customer-facing invite (Data Source, Qty Records, SMS/Email, Letters, BDC are all crammed into the description a dealer can read).
- Nothing updates automatically — a reschedule means Shannon re-typing the event.
- Guests are empty: the coach and dealer don't actually get the event on *their* calendars.

The app is already the system of record for campaigns (`campaigns` table), but that record never reaches the calendars where coaches and dealers actually live.

## Desired outcome

When a campaign is **booked / edited / cancelled** in the app, the event automatically projects into the right people's real calendars, with the app remaining the single source of truth:

- The **coach** and the **dealership contact** get the event on their own personal calendars (any platform) as guest invitations, with reminders and RSVP.
- A shared, read-only **EventPro Calendar** team calendar carries the whole schedule, colour-coded by coach, that staff subscribe to as an overlay in their own calendar.
- The customer-facing event is **clean** — dealership, dates, coach, format, contact — with **no internal ops fields**.
- Rescheduling or cancelling in the app **propagates automatically** to every copy; no re-typing.
- The dealer-facing **organizer identity** is `shannon@salesability.ca` (the warm, known owner/face of the business today), held as a **single config value** so it can be switched to a brand mailbox (`events@`) later with no code change.

## Non-goals

- **`.ics`-email-only distribution** — considered and set aside *because* `shannon@` is already licensed, which makes the full Google Calendar API path free and unlocks the real-time shared overlay + RSVP read-back that `.ics` can't give. See `decision.md`.
- **A standalone in-app customer portal / separate schedule silo** — the calendar *is* the distribution surface; a separate place to check would compete with the calendar people already keep.
- **The service-provider shareable production list** (Vicimus et al.) — that's the separate tokenized read-only app link (roadmap Phase 2 / `future/0058` territory), not a calendar.
- **Two-way sync** — strictly one-way (app → calendar). Hand-edits in Google are not read back. The only inbound read in scope is **RSVP status** (and even that may be deferred — see Open questions).
- **Conflict detection / free-busy** integration.
- **Executing the `events@` rebrand** — the design is config-ready for it, but v1 ships on `shannon@`.

## Success criteria

- Booking a campaign creates one Google event on the **EventPro Calendar** with the **coach + dealer contact as guests**; it appears on their personal calendars.
- Editing dates/coach **updates the same event in place** (no duplicate); cancelling **removes** it everywhere.
- The customer-facing event carries **none** of the internal ops fields (`qty_records`, `sms_email`, `letters`, `bdc`, data source).
- The organizer identity is a **single config value** (`shannon@` now), switchable to `events@` later with **no code change and no data migration**.
- Staff can subscribe to the read-only EventPro Calendar and see the whole schedule, **colour-by-coach**.
- A failed Google call **does not fail the booking** (best-effort; the app stays authoritative) — confirm stance below.

## Open questions

- **Coach → `colorId` mapping** — where does it live? A new column on `team_member_roles`, a small lookup, or derive from the legacy coach-colour notion the old app already had. (Google's palette is the fixed 1–11.)
- **Failure stance** — best-effort (app succeeds, store a "needs sync" flag + manual resync button) vs. block the booking on a failed sync. *Leaning best-effort.*
- **RSVP read-back** — in scope for v1 or deferred? Low value here: these events are **pre-contracted** (MSA + accepted quote) and run at the dealer's own site, so the invite is "here's the confirmed date," not "please confirm attendance." *Leaning deferred.*
- **Guest privacy** — confirm `guestsCanSeeOtherGuests: false` / `guestsCanInviteOthers: false` defaults.
- **Workspace confirmation** — DWD requires salesability.ca to be a real Google Workspace. Almost certainly yes (admin@ exists), but confirm before relying on Phase 0.

## Why now

Shannon runs the whole booking schedule off her personal calendar — the screenshot that kicked this off is a manually-created "ST Personal" event. It doesn't scale as the business grows or adds coaches, and the requirement to "link customers to an event" surfaced it directly. The unlock: `shannon@` is **already licensed**, so the full Google Calendar API path costs **$0** — removing the seat-cost objection that would otherwise have pushed us to the lighter `.ics` path.
