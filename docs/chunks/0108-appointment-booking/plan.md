# Appointment booking via tokenized public link — Plan

**Intent:** [`intent.md`](intent.md)
**Started:** 2026-07-14

## Progress Tracker

| Phase | Status | Commit |
|-------|--------|--------|
| 1: [Schema — slot grid + appointments + booking token] | Pending | - |
| 2: [Booking domain — token resolution, availability, book action] | Pending | - |
| 3: [Public /book/<token> page] | Pending | - |
| 4: [Staff surface — slots + appointments on the event page] | Pending | - |
| 5: Tests + smoke verification | Pending | - |

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
| `/book` entry in `PUBLIC_PATHS` | `src/lib/supabase/middleware.ts:8` | Same list + same style of "why this is public" comment as `/share/coach` |
| Staff slots/appointments panel on the event surface | `src/app/(app)/calendar/[id]/sms/page.tsx:25` | The per-event subpage pattern: `assertCan` + `loadCampaign` + `notFound` + `PageHeader` with a Back-to-event button; the panel itself mirrors `SmsPanel`'s server-serialized props shape |

**Conventions referenced:**
- `db-conventions` skill — invoke before schema/migration work (journal `when` gotcha; migrations on the 5432 session pooler)
- `docs/wiki/auth.md` — public-path gating; page/action gates for the staff surface
- `docs/wiki/sms.md` — recipient retention (24-month purge) and opt-out semantics the booking page must not violate
- `docs/wiki/conventions.md` — mutations via Server Actions (the public booking form is still our own UI)

**Overall Progress:** 0% (0/5 phases complete)

**Note:**
- Each phase includes both implementation and tests
- Integration tests come last, after all phases pass (verifies real DB behavior)
- Phase 1 blocks on the intent's two owner calls (slot-grid shape + capacity default) — surface them before writing the migration

### Phase Checklist

#### Phase 1: [Schema — slot grid + appointments + booking token]
- [ ] Task 1
- [ ] Task 2

#### Phase 2: [Booking domain — token resolution, availability, book action]
- [ ] Task 1
- [ ] Task 2
- [ ] Task 3
- [ ] Test case 1
- [ ] Test case 2

#### Phase 3: [Public /book/<token> page]
- [ ] Task 1
- [ ] Task 2
- [ ] Task 3
- [ ] Test case 1
- [ ] Test case 2

#### Phase 4: [Staff surface — slots + appointments on the event page]
- [ ] Task 1
- [ ] Task 2
- [ ] Test case 1

#### Phase 5: Tests + smoke verification
- [ ] Service-level integration test for the booking domain (token resolve, one-per-recipient, capacity under concurrency)
- [ ] Verify multi-step operations with real DB
- [ ] Smoke (web-test): `goto /book/<fixture-token>` with NO auth injection; expect greeting with recipient first name + dealer name + slot grid; invalid token → not-found (no login redirect)
- [ ] Smoke (web-test): book a fixture slot; page flips to booked state; revisit shows the booking (fixture cleanup after)
- [ ] Smoke (web-test): staff event surface shows the slots/appointments panel behind auth
- [ ] `pnpm dlx tsx scripts/0108-booking-smoke.ts insert`; run web-test; `... cleanup`
