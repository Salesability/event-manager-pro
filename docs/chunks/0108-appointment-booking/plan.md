# Appointment booking via tokenized public link — Plan

**Intent:** [`intent.md`](intent.md)
**Started:** 2026-07-14

## Progress Tracker

| Phase | Status | Commit |
|-------|--------|--------|
| 1: [Schema — slot grid + appointments + booking token] | Done | `c97dac7` |
| 2: [Booking domain — token resolution, availability, book action] | Done | `daa1905` |
| 3: [Public /book/<token> page] | Done | `5638037` |
| 4: [Staff surface — slots + appointments on the event page] | Done | `3fbad75` |
| 5: Tests + smoke verification | Done | `97824be` |

The SMS "book your appointment" CTA finally gets a booking transaction: a per-recipient unguessable token resolves a public `/book/<token>` page where the customer picks one slot from the campaign's grid; the appointment lands in-app for staff. No SMS changes in this chunk (the `{{booking_link}}` send-path token + confirmation SMS are chunk 2) — done = a manually shared link books an appointment end-to-end, one per recipient, capacity-enforced, visible to staff on the event surface, with rows that outlive the 24-month recipient purge.

## Code Anchors

For each new file or method below, the builder reads the anchor first and matches its shape (length, error handling, naming, query style). For modifications to an existing file, the anchor is the nearest sibling method in that same file.

| New code | Anchor (`path:line`) | Why this anchor |
|----------|---------------------|-----------------|
| `src/lib/db/schema/appointments.ts` (slot + appointment tables) | `src/lib/db/schema/sms-conversations.ts:27` | Newest schema file: `bigIdentity`/`timestamps`/`actors` columns, RESTRICT FKs with a rationale comment, CHECK constraints, uniqueIndex race-backstops — match all of it. Invoke the `db-conventions` skill before writing |
| `booking_token` column on `sms_recipients` | `src/lib/db/schema/sms-recipients.ts:31` (the table def + its header comment) | Same file; partial-unique index like `sms_thread_messages.provider_sid`; the header's 24-month hard-delete retention note is why appointments snapshot name/phone instead of leaning on this FK |
| Token generation | `generatePublicId` — `src/features/schedule/actions.ts:60` | Same `randomBytes(…).toString('base64url')` idiom — but bump entropy (≥16 bytes): this token gates PII + a write, unlike display-only publicIds |
| `src/features/bookings/queries.ts` (`loadBookingContext` by token, `loadCampaignSlots`) | `loadCampaignConversations` — `src/features/sms/conversations/queries.ts:40` | Same layer + read-model shape: `'server-only'`, typed exports, campaign-scoped select-then-map, derivation comments |
| Public book Server Action (token-gated, unauthed) in `src/features/bookings/actions.ts` | `signInWithMagicLink` — `src/features/auth/actions.ts:28` | The only public-tier action shape in the repo: `// authz: public` marker + validation-note comment; gate is the token itself — validate it server-side first, everything derived from the row it resolves |
| `src/app/book/[token]/page.tsx` | `src/app/share/coach/[id]/page.tsx:14` | The public-page pattern: own branded header (no `(app)` shell), param-validate → `notFound()`, server-loaded data only |
| `audit_action` enum value additions | `src/lib/db/schema/audit-log.ts:28` (enum header comment) | Appending an enum value = `ALTER TYPE ADD VALUE` migration (0055) + lock-step TS array order |
| `/book` entry in `PUBLIC_PATHS` | `src/lib/supabase/middleware.ts:8` | Same list + same style of "why this is public" comment as `/share/coach` |
| Staff slots/appointments panel on the event surface | `src/app/(app)/calendar/[id]/sms/page.tsx:25` | The per-event subpage pattern: `assertCan` + `loadCampaign` + `notFound` + `PageHeader` with a Back-to-event button; the panel itself mirrors `SmsPanel`'s server-serialized props shape |

**Conventions referenced:**
- `db-conventions` skill — invoke before schema/migration work (journal `when` gotcha; migrations on the 5432 session pooler)
- `docs/wiki/auth.md` — public-path gating; page/action gates for the staff surface
- `docs/wiki/sms.md` — recipient retention (24-month purge) and opt-out semantics the booking page must not violate
- `docs/wiki/conventions.md` — mutations via Server Actions (the public booking form is still our own UI)

**Overall Progress:** 100% (5/5 phases complete)

**Note:**
- Each phase includes both implementation and tests
- Integration tests come last, after all phases pass (verifies real DB behavior)
- ~~Phase 1 blocks on the intent's two owner calls~~ **Resolved 2026-07-14:** half-hour slots (day window default 9–17, per-campaign editable); capacity is a **per-campaign setting** (dealership staffing = coach + sales staff, varies by dealer/event). Suggests derived slots from per-campaign booking settings (slot length fixed at 30 min, window + capacity columns) rather than materialized slot rows — decide in Phase 1 with `db-conventions`

### Phase Checklist

#### Phase 1: [Schema — slot grid + appointments + booking token]
- [x] Decide slot representation → **derived** slots (per-campaign `campaign_booking_settings`: day window minutes + capacity; slot length fixed 30 min in code) — no materialized slot rows to sync when campaign dates shift
- [x] `campaign_booking_settings` table (unique campaign FK, window CHECKs incl. half-hour alignment, capacity ≥ 1)
- [x] `appointments` table (campaign RESTRICT, recipient SET NULL + name/phone snapshot, `appointment_status` enum, partial-unique one-live-booking-per-recipient race backstop, slot CHECKs)
- [x] `booking_token` column on `sms_recipients` + partial unique index
- [x] Export from `schema/index.ts`; generate migration `0054` (`0054_zippy_wolfpack.sql`) (verify journal `when` > previous; strip any `auth` schema statements)
- [x] Apply migration to sandbox DB (5432 session pooler) — applied + verified 2026-07-15

#### Phase 2: [Booking domain — token resolution, availability, book action]
- [x] `src/features/bookings/slots.ts` — pure 30-min slot-grid derivation (campaign dates × settings window) + slot-time formatting; slot length is a code constant
- [x] `src/features/bookings/queries.ts` — `loadBookingContext(token)` (recipient + campaign + dealer + settings + live-appointment + per-slot booked counts) and `loadCampaignBookingOverview(campaignId)` for the staff surface
- [x] `src/features/bookings/actions.ts` — public `bookAppointment` (token IS the gate; zod-parsed; advisory-locked capacity + one-per-recipient inside a transaction; unique-index backstop; redirect-based results) + staff `saveCampaignBookingSettings` (`sms:send`; settings upsert + mints missing recipient tokens ≥16 random bytes base64url)
- [x] Test: slot-grid derivation unit tests (multi-day span, window boundaries, formatting)
- [x] Test: booking input schema + slot-membership validation unit tests — membership via `isSlotInGrid` tests; the zod input path is module-private in the `'use server'` file, exercised by Phase 5 integration tests

#### Phase 3: [Public /book/<token> page]
- [x] `/book` entry in `PUBLIC_PATHS` (`src/lib/supabase/middleware.ts`) with why-public comment
- [x] `src/app/book/[token]/page.tsx` — branded public page (share/coach pattern): greeting (first name + dealer + event dates), slot grid grouped by day, `?error=` banner; unknown token / booking-not-enabled → `notFound()`; noindex
- [x] Booked + event-passed states (revisit shows the booking; ended event stops booking)
- [x] Slot picker = radio chips + single confirm submit (no client JS; full slots disabled) — `bookAppointment` input reshaped to one `slot` field (`YYYY-MM-DD#minute`)
- [x] Test: server component + no client logic — rendering exercised by Phase 5 web-test smoke (grid, booked state, invalid token)

#### Phase 4: [Staff surface — slots + appointments on the event page]
- [x] `loadCampaignBookingOverview` gains per-recipient booking links (token holders) — staff must be able to hand links out manually (the chunk's done-condition)
- [x] `src/features/bookings/bookings-panel.tsx` (client) — settings enable/edit form (capacity + half-hour window selects → `saveCampaignBookingSettings`), token status, read-only slot grid with booked/capacity, appointments table, copyable recipient links
- [x] `src/app/(app)/calendar/[id]/bookings/page.tsx` — per-event subpage (`assertCan('sms:send')` + `loadCampaign` + `PageHeader` + Back-to-event), serializes overview into the panel
- [x] "Bookings" button in the event dialog next to "SMS" (same `sms:send` gate + add-on condition)
- [x] Test: client panel is presentational + one action call — exercised by Phase 5 auth-gated smoke

#### Phase 5: Tests + smoke verification
- [x] Service-level integration test for the booking domain (token resolve, one-per-recipient, capacity under concurrency) — `tests/integration/bookings.test.ts` (5 tests; `bookSlot` extracted to `src/features/bookings/book.ts` so the transaction is action-free testable)
- [x] Verify multi-step operations with real DB — incl. appointment surviving recipient hard-delete (purge posture) + concurrent capacity race (advisory lock)
- [x] Smoke (web-test): `goto /book/<fixture-token>` with NO auth injection; expect greeting with recipient first name + dealer name + slot grid; invalid token → not-found (no login redirect) — PASS 2026-07-15
- [x] Smoke (web-test): book a fixture slot; page flips to booked state; revisit shows the booking (fixture cleanup after) — PASS (radio made an invisible overlay, not sr-only, so pointer automation can drive it)
- [x] Smoke (web-test): staff event surface shows the slots/appointments panel behind auth — PASS (settings form, grid 1 booked, appointments row, Booking links + Copy; event dialog carries SMS + Bookings links)
- [x] `pnpm dlx tsx scripts/0108-booking-smoke.ts insert`; run web-test; `... cleanup` — fixtures removed, count verified 0
