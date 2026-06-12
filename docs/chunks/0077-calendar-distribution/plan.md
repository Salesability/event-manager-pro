# Calendar Distribution — Plan

**Intent:** [`intent.md`](intent.md)
**Decision:** [`decision.md`](decision.md)
**Started:** 2026-06-12

## Progress Tracker

| Phase | Status | Commit |
|-------|--------|--------|
| 0: Owner setup (SA → DWD → calendar) | ✅ Done — keyless pipeline smoke **PASSED** 2026-06-12 | - |
| 1: Google client wrapper | ✅ Done — `src/lib/google/calendar.ts`, test 7/7, tsc clean (uncommitted) | - |
| 2: Campaign → event mapper | ✅ Done — `src/lib/google/calendar-event.ts`, test 12/12, tsc clean | `dc733e0` |
| 3: Schema (`gcal_event_id` + sync status) | ✅ Done — migration `0037`, applied to sandbox; tsc + test green | `dc255a5` |
| 4: Wire into campaign Server Actions | ✅ Done — `calendar-sync.ts` reconcile + 3 mutation hooks + `resyncCampaign` + event-detail UI; tsc + test green | `1529c2f` |
| 5: Tests + smoke verification | ✅ Done — integration 6/6 + live smoke script + wiki; tsc + test 1136 green | `ae6bb45` |

This chunk projects booked campaigns from the app (the source of truth) into real calendars via the Google Calendar API — coach + dealer as guests on each event, plus a shared read-only **EventPro Calendar** team calendar. Organizer is `shannon@salesability.ca`, impersonated by a service account via domain-wide delegation, held as a single config value so a later `events@` rebrand is a config flip (see `decision.md`). "Done" = booking/editing/cancelling a campaign creates/updates/removes one clean Google event everywhere, with the app never blocked by a Google failure. Structurally this mirrors a QuickBooks push slice (`0070`/`0073`): external-API client wrapper → pure domain→payload mapper → a nullable durable-link column → wiring into the existing mutation actions → tests.

## Code Anchors

| New code | Anchor (`path:line`) | Why this anchor |
|----------|---------------------|-----------------|
| `src/lib/google/calendar.ts` (JWT auth w/ `subject` impersonation + `createEvent`/`patchEvent`/`deleteEvent`) | `src/lib/quickbooks/client.ts` | Same layer: external-API client wrapper — token acquisition + typed CRUD helpers + error types. Closest existing neighbor (a third-party API the app authenticates to and mutates). |
| `mapCampaignToGcalEvent(campaign, dealer, coach)` (pure: domain row → Calendar event body) | `src/lib/quickbooks/quote-push.ts` (`mapQuoteToEstimate`) | Same shape: a pure inverse-map from a domain record to an external API payload, unit-tested in isolation. |
| `campaigns.gcal_event_id` (nullable text, durable external link) + migration | `quotes.quickbooks_estimate_id` (added in `0073`, migration `0034`) | Same pattern: nullable text column linking a domain row to its external object, with create→backfill / present→update idempotency. Use the **`db-conventions` skill**. |
| Coach → `colorId` source (column on `team_member_roles` or lookup) | `src/lib/db/schema/_columns.ts` mixins + `team_member_roles` in `src/lib/db/schema/` | Schema convention for adding a per-role attribute (cf. `specialty` on `team_member_roles`). |
| Sync hooks in `src/features/schedule/actions.ts` (create/update/cancel → emit) | existing campaign mutation in `src/features/schedule/actions.ts` + the QBO push Server Action (`0073`) | Same file = nearest sibling for the mutation shape; the QBO push gives the linked-vs-unlinked (create+backfill / update) idempotency template. **Mutations stay Server Actions** (CLAUDE.md). |
| `src/features/schedule/calendar-sync.ts` — `reconcileCampaignCalendar` + `resyncCampaign` (Phase 4, built) | `src/lib/quickbooks/quote-push.ts` `pushQuoteToQuickbooks` | Same pattern: DB read → external upsert → guarded backfill, best-effort. New module so the I/O reconcile sits beside (not inside) the thin `actions.ts` mutations. |
| `Campaign` read shape + `event-detail.tsx` Calendar badge / Re-sync button (Phase 4, built) | `src/features/schedule/queries.ts` `loadCampaign(s)` + the existing Status badge in `event-detail.tsx` | Extends the existing read + detail surface rather than adding a new page. |

**Conventions referenced:**
- `docs/wiki/data-model.md` — `campaigns` carries the day-of dealer contact inline (`contact` / `phone` / `email`, `campaigns.ts:47-49`) → the dealer attendee email is `campaigns.email`; coach is `campaigns.coach_id` → `contacts`.
- `CLAUDE.md` → Conventions — Server Actions for mutations; invoke `db-conventions` before the schema/migration in Phase 3.
- `docs/wiki/go-live-accounts.md` — the Phase 0 SA/DWD/calendar provisioning belongs in the provisioning runbook. **Auth is keyless (Path 2 — see `decision.md` §4a):** no secret, no `deploy.sh` mount; the Cloud Run runtime SA impersonates `eventpro-calendar` via `signJwt` (org policy `iam.disableServiceAccountKeyCreation` blocks downloadable keys).

**Overall Progress:** 100% (6/6 — Phase 0 owner setup ✅ · Phase 1 client wrapper ✅ · Phase 2 mapper ✅ · Phase 3 schema ✅ · Phase 4 wiring ✅ · Phase 5 tests+smoke+wiki ✅). Build phases complete; chunk-end `/eval` next.

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
- [x] `mapCampaignToGcalEvent` (`src/lib/google/calendar-event.ts`, pure/DB-free like `mapQuoteToEstimate`) — summary (`🚗 <dealer> — SaleDay Event`), `location` from dealer address, `start.date`/`end.date` with **end EXCLUSIVE (+1)** via `addDaysIso` (UTC, DST-safe), `colorId` by coach
- [x] Attendees: coach (`responseStatus: accepted`) + dealer contact (`campaigns.email`); `guestsCanSeeOtherGuests:false` / `guestsCanInviteOthers:false`. `attendees` always an array (empty ok) so a Phase-4 patch reconciles the guest list
- [x] **Customer-safe description** — coach, format, contact/phone, app link; **omits** `qty_records` / `sms_email` / `letters` / `bdc` / data source by construction (mapper only sees safe inputs)
- [x] `reminders` (email 1440m, popup 120m); `extendedProperties.private.campaignId` back-link; `source` → `appLink` (caller-provided absolute URL; there's no per-campaign deep route today, so Phase 4 links to `/calendar`)
- [x] Unit test (`calendar-event.test.ts`, 12 cases): end-date +1 (+ month/year/leap boundaries), clean description (asserts no ops fields), attendee list, colorId, sparse-field drops

#### Phase 3: Schema (`gcal_event_id` + sync status)
- [x] **Invoked `db-conventions`.** Added to `campaigns`: `gcal_event_id` (nullable text durable link, partial-unique `WHERE NOT NULL` like `dealers.quickbooks_id`), `gcal_sync_status` enum `campaign_gcal_sync_status` (`pending`/`synced`/`failed`, NOT NULL default `pending`), `gcal_synced_at` timestamptz — the best-effort "needs sync" signal (owner chose a status column over link-only)
- [x] Coach → `colorId` source: **owner chose auto-derive (no column)** → `coachGcalColorId(id) = (id % 11) + 1` in `calendar-event.ts` (stable per coach, Google palette 1..11). No `team_member_roles`/lookup migration. Decisions recorded in [decision.md §7](decision.md)
- [x] Generated + verified migration `0037_minor_stryfe.sql` (journal `when` 1781292323550 > prev 1781204355861 — monotonic, no silent-skip), applied to **sandbox**; columns + partial unique index + enum labels confirmed via `information_schema`

#### Phase 4: Wire into campaign Server Actions
- [x] Single status-driven entry point `reconcileCampaignCalendar(campaignId, userId)` in new `src/features/schedule/calendar-sync.ts` (server-only): booked/completed → upsert event, draft/cancelled → remove. `createCampaign` (now `.returning({id})`) / `updateCampaign` / `cancelCampaign` each `await` it after their DB write
- [x] Create-vs-patch idempotency: linked (`gcal_event_id` set) → `patchEvent`; unlinked → `createEvent` + **guarded backfill** (`WHERE gcal_event_id IS NULL`); a lost race best-effort `deleteEvent`s the duplicate. Mirrors the QBO push
- [x] **Best-effort** — reconcile never throws (catches all, marks `gcal_sync_status='failed'`, logs); the mutation always returns ok. `skipped` when Google/SITE_URL unconfigured (status untouched). Confirmed best-effort stance (decision.md §6/§7)
- [x] Manual re-sync: `resyncCampaign` Server Action (capability `campaign:edit`) + a **"Re-sync"** button + **Calendar** status badge (`Synced`/`Sync failed`/`Not synced`) in `event-detail.tsx`; `Campaign` read shape extended with `gcalSyncStatus`/`gcalEventId`

#### Phase 5: Tests + smoke verification
- [x] Mapper unit tests (Phase 2) green — `calendar-event.test.ts` 12/12
- [x] Integration suite `tests/integration/calendar-sync.test.ts` (6 cases): create → patch → cancel-remove round-trip + best-effort-failure + skipped + no-coach, against the **sandbox DB** with the Google client mocked (the real mapper runs, asserting clean description + EXCLUSIVE end + guest list). `reconcileCampaignCalendar` gained an `exec` param (cf. quote-push) so the test drives it in rolled-back txns
- [x] **Live** create → patch → delete round-trip = `scripts/0077-calendar-smoke.ts` — exercises the committed keyless client against real Google (`sendUpdates='none'` so no emails); run with `NODE_OPTIONS='--conditions=react-server'`. Structural check passed (reports "Not configured" until the owner sets the 3 env vars + ADC — see go-live §4a)
- [x] throwaway fixture: the smoke script builds its own event (no DB seed needed); the integration suite seeds + rolls back
- [x] Wiki ingest: new [`docs/wiki/calendar-distribution.md`](../../wiki/calendar-distribution.md) + `go-live-accounts.md` §4a runbook + `data-model.md` columns + `index.md` link + `log.md` entry
- [~] Smoke (web-test): `goto /calendar`; booked campaign renders its **Calendar** sync badge → **run as part of the chunk-end `/eval` browser smoke** (Google unconfigured in dev → badge shows "Not synced", the correct rendered state)
