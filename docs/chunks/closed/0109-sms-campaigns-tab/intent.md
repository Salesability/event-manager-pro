# SMS campaigns tab — move the ledger off event-dialog nav — Intent

**Created:** 2026-07-14

## Problem

The per-campaign SMS ledger (`/calendar/<id>/sms` — recipient import, launch composer, send log) is only reachable through the calendar: open the event dialog, click its SMS button. That makes the event dialog a navigation hub, which is exactly the drift 0104 set out to reverse (the dialog is meant to be a workflow-*completion* hub) and 0107's intent re-flagged. The 0107 `Messages` inbox opened a global door to *conversations*, but a campaign with no replies yet — the ones staff most need to import lists into and launch — still has no door except the event dialog. Owner call 2026-07-14: move off using the event as the nav to the SMS ledger.

## Desired outcome

- A new **top-level nav tab** (gated `sms:send`, like Messages) listing every SMS-relevant campaign — dealer, event dates, add-on/launch state, imported-recipient count, last send, unread replies — each row linking to its existing `/calendar/<id>/sms` page.
- `/messages` stays purely the conversation inbox (owner call 2026-07-14 — no campaigns section there).
- Staff can run the whole SMS workflow (find campaign → import → launch → watch replies) without ever opening the calendar or an event dialog.
- The event dialog's SMS button becomes a shortcut, not the door.

## Non-goals

- **Moving the `/calendar/<id>/sms` URL** — the page stays where it is; this chunk adds the global index that links to it. A URL restructure (e.g. under the new tab's path) is separate churn for a later pass if ever.
- **Changing the SMS panel itself** — import/launch/send-log/conversations internals are untouched.
- **Removing the event dialog's SMS button** — default is keep-as-shortcut; only drop it if the owner explicitly says so (open question below).
- **Booking-link work** — that's 0108/chunk-2; this is pure navigation/IA.
- **Coach-facing SMS access** — gate stays `sms:send` (pure-admin, 0103 D4); same review-on-widening caveat as the 0107 inbox.

## Success criteria

- The new tab appears in the nav for `sms:send` users; clicking it lists SMS campaigns with dealer + dates + state; clicking a row lands on that campaign's `/calendar/<id>/sms` page.
- A booked campaign with the SMS add-on but zero threads/sends appears in the list (the "no replies yet" case the inbox can't surface).
- The event dialog's SMS button still works (unchanged behavior).
- No new capability or route-gate holes: page `assertCan('sms:send')`, tab capability-gated, list query admin-scoped.

## Open questions

_All three resolved 2026-07-15 (owner):_

- ~~Tab label + route?~~ **"SMS" at `/sms`.**
- ~~Which campaigns qualify?~~ **Gate-active ∪ has-history** — booked events with the SMS add-on active, plus any campaign with SMS history (sends or threads), state shown per row.
- ~~Keep or drop the event dialog's SMS button?~~ **Keep as shortcut** (no code change).

## Why now

Owner call during the 2026-07-14 SMS-direction reset: with the booking-link direction (0108) about to add more SMS-adjacent workflow (slot grids, appointment lists), the entry point needs to stop being the event dialog before more surfaces pile onto it. Queued behind 0108.
