# Calendar Distribution — Plan

**Intent:** [`intent.md`](intent.md)
**Decision:** [`decision.md`](decision.md)
**Started:** 2026-06-12

## Progress Tracker

| Phase | Status | Commit |
|-------|--------|--------|
| 0: Owner setup (SA → DWD → calendar) | ✅ Done — keyless pipeline smoke **PASSED** 2026-06-12 | - |
| 1: Google client wrapper | ✅ Done — `src/lib/google/calendar.ts`, test 7/7, tsc clean (uncommitted) | - |
| 2: Campaign → event mapper | Pending | - |
| 3: Schema (`gcal_event_id` + coach colour) | Pending | - |
| 4: Wire into campaign Server Actions | Pending | - |
| 5: Tests + smoke verification | Pending | - |

This chunk projects booked campaigns from the app (the source of truth) into real calendars via the Google Calendar API — coach + dealer as guests on each event, plus a shared read-only **EventPro Calendar** team calendar. Organizer is `shannon@salesability.ca`, impersonated by a service account via domain-wide delegation, held as a single config value so a later `events@` rebrand is a config flip (see `decision.md`). "Done" = booking/editing/cancelling a campaign creates/updates/removes one clean Google event everywhere, with the app never blocked by a Google failure. Structurally this mirrors a QuickBooks push slice (`0070`/`0073`): external-API client wrapper → pure domain→payload mapper → a nullable durable-link column → wiring into the existing mutation actions → tests.

## Code Anchors

| New code | Anchor (`path:line`) | Why this anchor |
|----------|---------------------|-----------------|
| `src/lib/google/calendar.ts` (JWT auth w/ `subject` impersonation + `createEvent`/`patchEvent`/`deleteEvent`) | `src/lib/quickbooks/client.ts` | Same layer: external-API client wrapper — token acquisition + typed CRUD helpers + error types. Closest existing neighbor (a third-party API the app authenticates to and mutates). |
| `mapCampaignToGcalEvent(campaign, dealer, coach)` (pure: domain row → Calendar event body) | `src/lib/quickbooks/quote-push.ts` (`mapQuoteToEstimate`) | Same shape: a pure inverse-map from a domain record to an external API payload, unit-tested in isolation. |
| `campaigns.gcal_event_id` (nullable text, durable external link) + migration | `quotes.quickbooks_estimate_id` (added in `0073`, migration `0034`) | Same pattern: nullable text column linking a domain row to its external object, with create→backfill / present→update idempotency. Use the **`db-conventions` skill**. |
| Coach → `colorId` source (column on `team_member_roles` or lookup) | `src/lib/db/schema/_columns.ts` mixins + `team_member_roles` in `src/lib/db/schema/` | Schema convention for adding a per-role attribute (cf. `specialty` on `team_member_roles`). |
| Sync hooks in `src/features/schedule/actions.ts` (create/update/cancel → emit) | existing campaign mutation in `src/features/schedule/actions.ts` + the QBO push Server Action (`0073`) | Same file = nearest sibling for the mutation shape; the QBO push gives the linked-vs-unlinked (create+backfill / update) idempotency template. **Mutations stay Server Actions** (CLAUDE.md). |

**Conventions referenced:**
- `docs/wiki/data-model.md` — `campaigns` carries the day-of dealer contact inline (`contact` / `phone` / `email`, `campaigns.ts:47-49`) → the dealer attendee email is `campaigns.email`; coach is `campaigns.coach_id` → `contacts`.
- `CLAUDE.md` → Conventions — Server Actions for mutations; invoke `db-conventions` before the schema/migration in Phase 3.
- `docs/wiki/go-live-accounts.md` — the Phase 0 SA/DWD/calendar provisioning belongs in the provisioning runbook. **Auth is keyless (Path 2 — see `decision.md` §4a):** no secret, no `deploy.sh` mount; the Cloud Run runtime SA impersonates `eventpro-calendar` via `signJwt` (org policy `iam.disableServiceAccountKeyCreation` blocks downloadable keys).

**Overall Progress:** 33% (2/6 — Phase 0 owner setup ✅ · Phase 1 client wrapper ✅)

**Note:**
- Phase 0 is **owner/console setup**, not code — partially started this session (service account `eventpro-calendar` provisioning begun in `eventpro-498313`; blocked on `gcloud auth login` reauth). The DWD authorization is a one-time Admin-console step (admin@salesability.ca).
- Integration tests come last, against a throwaway test calendar.

### Phase Checklist

#### Phase 0: Owner setup (SA → keyless grant → DWD → EventPro Calendar)
- [x] Confirm salesability.ca is a Google Workspace — confirmed (DWD authorize + live impersonation succeeded) 2026-06-12
- [x] Enable Calendar API (`calendar-json.googleapis.com`) on `eventpro-498313` — done 2026-06-12
- [x] Create SA `eventpro-calendar@eventpro-498313.iam.gserviceaccount.com` (Client ID `101571815389036082153`) — done 2026-06-12
- [x] **Keyless grant (Path 2):** runtime SA `1094204863648-compute@developer.gserviceaccount.com` → `roles/iam.serviceAccountTokenCreator` on `eventpro-calendar` — done 2026-06-12
- [x] Authorize the Client ID `101571815389036082153` in Admin console DWD for scope `https://www.googleapis.com/auth/calendar.events` (admin@salesability.ca) — done 2026-06-12
- [x] Create the calendar owned by `shannon@salesability.ca` — done 2026-06-12; ID `c_eb45f29a4477f0e879861e24e1cdfaeed04ad140a1f5172919e22b82a57943c5@group.calendar.google.com`
- [x] **Keyless pipeline smoke PASSED 2026-06-12** — impersonate `shannon@` via `signJwt` → create/delete event round-trip on the calendar. **Finding: organizer = the calendar's display name** (`"EventPro"` + the `c_…@group` address), creator = `shannon@` → overturns the §3 organizer plan (see decision.md §3).
- [ ] **OPEN — dealer-visible calendar name:** currently "EventPro"; recommend Shannon rename the calendar's display name to **"SaleDay Events"** (it *is* the organizer dealers see) — pending owner decision. Also add the local-dev `tokenCreator` grant for `user:admin@salesability.ca` (done 2026-06-12) to the runbook.
- [ ] Share the calendar **read-only** to staff (coaches + admin) for the overlay
- [ ] Record SA / Client ID / calendar ID / keyless-grant in `docs/wiki/go-live-accounts.md`

#### Phase 1: Google client wrapper
- [x] `src/lib/google/calendar.ts`: **keyless DWD auth** — `google-auth-library` resolves ADC → IAM `signJwt` signs the DWD assertion → token exchange acts as the organizer (no key file). Per-instance token cache. Added dep `google-auth-library@10.7.0`.
- [x] `createEvent` / `patchEvent` / `deleteEvent` against the configured calendar ID; typed errors (`GoogleCalendarError` / `GoogleCalendarAuthError`); delete is idempotent (404/410 = success)
- [x] Config plumbing: `googleCalendarConfig()` / `googleCalendarConfigured()` read `GOOGLE_CALENDAR_SA_EMAIL` / `GOOGLE_CALENDAR_ID` / `GOOGLE_CALENDAR_SUBJECT` — single-source so the `events@` rebrand is a config flip. **TODO (deploy):** set these three in `deploy.sh` (prod) + `.env.local` (dev). Known values: SA `eventpro-calendar@…`, ID `c_eb45…@group.calendar.google.com`, subject `shannon@salesability.ca`.
- [x] Test 7/7 (config presence + `eventsUrl` encoding); `tsc` clean. `vi.mock('server-only', …)` per repo pattern.
- [ ] Local-dev prerequisite: grant the developer's identity (`admin@`) `tokenCreator` on `eventpro-calendar` — **done 2026-06-12**

#### Phase 2: Campaign → event mapper
- [ ] `mapCampaignToGcalEvent` — summary (`🚗 <dealer> — SaleDay Event`), `location` from dealer address, `start.date`/`end.date` with **end EXCLUSIVE (+1)**, `colorId` by coach
- [ ] Attendees: coach (`responseStatus: accepted`) + dealer contact (`campaigns.email`); `guestsCanSeeOtherGuests:false` / `guestsCanInviteOthers:false`
- [ ] **Customer-safe description** — coach, format, contact/phone, app deep-link; **omit** `qty_records` / `sms_email` / `letters` / `bdc` / data source
- [ ] `reminders` (email 1440m, popup 120m); `extendedProperties.private.campaignId` back-link; `source` deep-link to `/campaigns/<public_id>`
- [ ] Unit test: end-date +1, clean description (no ops fields), attendee list, colorId

#### Phase 3: Schema (`gcal_event_id` + coach colour)
- [ ] **Invoke `db-conventions`.** Add `campaigns.gcal_event_id` (nullable text) + a "needs sync" signal if best-effort chosen
- [ ] Coach → `colorId` source (column on `team_member_roles` or lookup); decide + migrate
- [ ] Generate + verify migration (watch the Drizzle journal `when` gotcha)

#### Phase 4: Wire into campaign Server Actions
- [ ] `src/features/schedule/actions.ts`: on create → `createEvent` + store returned id; on update → `patchEvent` by stored id; on cancel/delete → `deleteEvent`
- [ ] Create-vs-patch idempotency (linked = `gcal_event_id` set → patch; unlinked → create + backfill), mirroring the QBO push
- [ ] **Best-effort failure handling** — app succeeds even if Google fails; set a "needs sync" flag + surface a manual re-sync (confirm stance per intent Open question)
- [ ] Manual re-sync action for a single campaign

#### Phase 5: Tests + smoke verification
- [ ] Mapper unit tests (Phase 2) green
- [ ] Integration test against a throwaway test calendar: create → patch → delete round-trip; attendee + clean-description assertions
- [ ] Smoke (web-test): `goto /calendar`; a booked campaign renders with its synced state
- [ ] (If DB state needed) throwaway fixture `scripts/0077-calendar-smoke.ts` insert/cleanup, idempotent by tag
- [ ] Wiki ingest: `docs/wiki/` page for the calendar projection + `go-live-accounts.md` Phase-0 runbook entry; note in `log.md`
