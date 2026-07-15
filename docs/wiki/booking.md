# Appointment booking (tokenized public links)

Customer self-serve appointment booking for campaign events: every opted-in `sms_recipients` row can hold an unguessable **booking token** that resolves a public `/book/<token>` page where the customer books **exactly one** appointment into the campaign's slot grid. Shipped as chunk `0108` (2026-07-15); the `{{booking_link}}` SMS send-path token + confirmation SMS are the not-yet-scaffolded chunk 2 — until then staff hand links out manually from the staff panel. This is step 1 of the owner's post-chatbot SMS direction (2026-07-14): the booking transaction moved to a deterministic web page; the [conversation console](sms.md#conversation-console-0106) stays as the human fallback for people who text back.

## Slot model — derived, never materialized

There are no slot rows. Enabling booking creates one `campaign_booking_settings` row (unique per campaign) and the bookable grid is **computed at read time**: half-hour slots (fixed length, code constant `SLOT_LENGTH_MINUTES` in `src/features/bookings/slots.ts`) across every campaign day within `[day_start_minute, day_end_minute)` (defaults 9:00–17:00, staff-editable per campaign). **Capacity is per campaign** — it tracks event staffing (coach + the dealer's own sales staff), which varies per event even at the same dealer (owner call 2026-07-14). Minutes are local wall-clock offsets; dates are the campaign's local `date` strings — no timezone math (the host-local `todayIso` pattern, 0097-a caveat applies app-wide).

## The public page

- `/book/[token]` (`src/app/book/[token]/page.tsx`) — own branded header (no `(app)` shell), noindex, in `PUBLIC_PATHS` ([auth.md](auth.md)). Unknown token or booking-never-enabled → `notFound()`, **never a login redirect**.
- States: slot picker (radio chips + one confirm submit, no client JS) → "You're booked ✓" (revisits show the booking) → "This event has passed" (token outlives the event but stops booking; **cancelled campaigns read as ended**).
- The form posts the public Server Action `bookAppointment` (`src/features/bookings/actions.ts`, `// authz: public`) — the token IS the gate; every written value derives from the row it resolves. Refusals travel back as `?error=full|invalid` query params.
- Opt-out does **not** block booking — STOP halts SMS, not the customer's own web self-serve.

## Invariants & how they're enforced

All in `src/features/bookings/book.ts` (`bookSlot` — the action-free domain half, integration-tested against real Postgres in `tests/integration/bookings.test.ts`):

- **One live appointment per person** — inside a `pg_advisory_xact_lock('booking_' || campaignId)` transaction, recheck matches `recipient_id` **OR `(campaign_id, phone)`** (the phone arm survives a list re-import deleting + reinserting the person under a new id/token). Backstop: partial unique index on `recipient_id WHERE status='booked'`.
- **Capacity under concurrency** — count + insert under the same campaign lock, against settings **re-read inside the transaction** (window too, re-running the grid check), so a concurrent staff settings save can't be raced. `saveCampaignBookingSettings` takes locks in order `sms_launch_` → `booking_` (bookings take only `booking_` — no deadlock cycle).
- **Purge survival** — `appointments.recipient_id` is SET NULL and the row snapshots `first_name`/`last_name`/`phone` at booking time, so appointments outlive the 24-month recipient hard-delete ([sms.md](sms.md)). Appointments are the app's first durable customer-intent records.
- **Token minting can't race a re-import** — the mint loop in `saveCampaignBookingSettings` shares the `sms_launch_` advisory key with `importSmsRecipients`. Tokens are ≥18 random bytes base64url (higher entropy than display publicIds — they gate PII + a write). Minting is idempotent: re-saving settings tokenizes only recipients missing a token; held links never change. A re-import wipes recipients (tokens die with rows) — re-save settings to re-mint.
- **Lifecycle gates** — settings can only be saved on `status='booked'` campaigns (mirrors the SMS launch gate); cancelled campaigns refuse bookings (`event-ended` outcome).

## Staff surface

`/calendar/<id>/bookings` (`assertCan('sms:send')` — admin-only like the rest of the SMS family; "who builds the grid" resolved to the lean default, widening to coaches is a one-line change). Reached from the event dialog's **Bookings** button (renders beside **SMS** under the same add-on condition). Panel (`src/features/bookings/bookings-panel.tsx`): settings enable/edit form (window selects + capacity), token-mint status, read-only slot grid with booked/capacity per slot, appointments table (cancelled rows included — ledger view), and per-recipient **Booking links** with copy buttons (the manual-handout path until chunk 2).

## Schema

`campaign_booking_settings` + `appointments` (+ `appointment_status` enum, `sms_recipients.booking_token`) — see [data-model.md](data-model.md). Migrations `0054` (tables/column) + `0055` (audit enum value `booking.settings_saved`). Sandbox-applied; prod still at `0048` — the whole `0103…0108` line migrates prod before merging to `main`.

## Fixtures & smoke

`scripts/0108-booking-smoke.ts insert|cleanup` — seeds a single-day bookable campaign + one recipient with the fixed token `0108-booking-smoke-token` (single-day because duplicate time labels across days trip the browse tool's role+name click resolution).

## Open questions / parked

- **Chunk 2** (not scaffolded): `{{booking_link}}` template token in the campaign send path + confirmation SMS.
- What the page collects stays lean (pre-filled name/phone only; no email/vehicle/notes fields) — revisit if the owner wants richer intent capture.
- No self-serve cancel/reschedule (v1 book-once; changes go through the dealer/staff). No staff-side manual booking / walk-in entry yet (staff view is read-first).
