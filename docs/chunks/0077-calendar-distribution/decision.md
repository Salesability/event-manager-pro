# Calendar Distribution — Decisions

Design decisions reached in the 2026-06-12 design conversation, recorded so the *why* survives plan churn. See `intent.md` for the problem and `plan.md` for the phased how.

## 1. The app is the hub; the calendar is a projection (one-way)

The app (`campaigns` table) is the **single source of truth**. The calendar is a **distribution channel**, not a rival system of record. Sync is **one-way** (app → calendar): hand-edits in Google are not read back. This is the explicit fix for today's failure mode — the business running off Shannon's *personal* calendar as the record.

Why not make the app's own calendar view the only surface? Because **a business event is one of many event types a person tracks.** A coach needs SaleDay events merged with their dentist appointment and their kid's game — and only a *multi-source* personal calendar does that merge. The app calendar is single-source and can never show what it didn't create, so it can't be a coach's "where am I Tuesday" surface. The app keeps its own calendar view (the live whole-schedule hub for *doing the work*); the projection is what lands events where humans already look.

## 2. Google Calendar API over `.ics`-only — *because `shannon@` is already licensed*

Two delivery mechanisms were weighed:

- **`.ics` email invites** (author the iCal, send via Resend from a branded domain) — zero Google setup, free branding, lands in personal calendars. But it can't give a **real-time shared team overlay** (subscribable iCal feeds refresh on Google's slow 8–24h schedule) or **programmatic RSVP read-back**.
- **Google Calendar API** (write to a shared calendar, guests fan out natively) — real-time overlay + RSVP, but the organizer must be a **licensed Workspace user**.

The deciding factor: the organizer-must-be-licensed cost. A dedicated `events@` mailbox would cost a recurring seat — which nearly tipped the decision to `.ics`. But **`shannon@` already has a licensed seat**, so the API path costs **$0** *and* carries warmer branding (a real, known person vs. a brand alias). With the cost objection gone, the API path wins on capability (real-time overlay + RSVP).

`.ics` remains the documented fallback if the identity ever has to move to a *new* unlicensed account before a seat is justified.

## 3. Organizer = the **calendar's display name** (not the impersonated user) — empirically confirmed

> **⚠ Updated 2026-06-12 by the keyless smoke.** The premise below (organizer = `shannon@`, with a config-driven `events@` rebrand) was **overturned by direct test.** A test event written to the EventPro **secondary** calendar (impersonating `shannon@`) came back as:
> ```
> organizer: { email: "c_eb45…@group.calendar.google.com", displayName: "EventPro", self: true }
> creator:   { email: "shannon@salesability.ca" }
> ```
> So **the organizer dealers see is the calendar itself** (its display name + the `c_…@group` address); `shannon@` is only the **creator** (invisible to guests). This is *better* than the original plan: the dealer-facing brand is the **calendar's display name** — **free** (no `events@` seat ever), **not coupled to any person** (survives Shannon leaving → **no rebrand needed**), and renameable at will. We still impersonate `shannon@` because **DWD impersonation of a real user is required to add attendees at all** — but her identity is now purely the technical writer, *not* the brand.
>
> **Consequence:** name the **calendar's display name** to the customer brand (recommended **"SaleDay Events"**, matching the "SaleDay Event" titles); keep the technical SA as `eventpro-calendar` (never dealer-visible). The one cosmetic wart is the `c_…@group` email behind the friendly name (visible only on event-detail drill-down). **Open sub-decision:** dealer-facing calendar name = "SaleDay Events" (recommended) vs "EventPro" (current). The §2 "warmer branding" sub-point is now moot; the rest of §2 (API over `.ics` for real-time overlay + RSVP) still holds.

_(Original reasoning, kept for history — now superseded by the finding above:)_

Shannon is the owner and the face of the business today, so dealer-facing invites organized by `shannon@salesability.ca` are *good* branding (a known contact), not a compromise. As the business grows it may warrant a brand-neutral identity (`events@`).

The rebrand is made nearly free by three design rules, all baked in from day one:

1. **One persistent "EventPro Calendar"** is the durable write target (owned by `shannon@` now) — independent of who organizes.
2. **The impersonation identity is a single config value** (the SA's `subject`). Today `shannon@`; the rebrand flips this one value.
3. **Old events stay, new events switch — no migration.** Google won't reassign an existing event's organizer, and we don't need it to: booked events keep `shannon@` and still work; only newly-created events carry the new identity. The transition is gradual and invisible.

So the future rebrand is: provision `events@` → grant it write access to the EventPro Calendar → flip the config value. No schema change, no data migration, no dealer-facing disruption. **Do not hardcode `shannon@` anywhere except that one config value.**

Rejected: renaming `admin@` → `events@` (would make the brand mailbox a super-admin — backwards separation of duties — and disrupt the gcloud/GCP logins tied to `admin@`).

## 4. Service account + domain-wide delegation (impersonation), not plain calendar-share

A plain service account (no DWD) can create events on a shared calendar but **errors the moment an event has attendees** (`"Service accounts cannot invite attendees without Domain-Wide Delegation of Authority"`). Our whole design is events *with guests* (coach + dealer), so the SA must **impersonate** a real user (`subject`) via DWD. The DWD scope is the minimal `https://www.googleapis.com/auth/calendar.events`.

The SA is `eventpro-calendar@eventpro-498313.iam.gserviceaccount.com` (Client ID `101571815389036082153` — this is what gets authorized in the Workspace DWD console).

## 4a. Keyless auth (Path 2) — no downloaded SA key

The `eventpro-498313` org enforces `constraints/iam.disableServiceAccountKeyCreation`, so we **cannot** (and chose not to) download a JSON key. Instead the app authenticates **keyless**:

- The Cloud Run **runtime SA** (`1094204863648-compute@developer.gserviceaccount.com`) is granted `roles/iam.serviceAccountTokenCreator` **on `eventpro-calendar`** (a resource-level binding — it can impersonate *only* this one SA).
- At runtime the app uses the IAM Credentials `signJwt` API to have `eventpro-calendar` sign a DWD assertion (`iss=eventpro-calendar`, `sub=<organizer>`, `scope=calendar.events`), then exchanges it at the token endpoint for an access token acting as the organizer.
- DWD is authorized in Workspace for `eventpro-calendar`'s Client ID; the runtime SA itself never needs DWD.

Consequences vs. the rejected key path: **no secret to store or rotate** (drops the planned `google-calendar-sa-key` Secret Manager entry and the `deploy.sh` mount), aligns with the org's key-disabled posture, at the cost of a bit more code in the Phase 1 client wrapper (signJwt orchestration rather than loading a key file). Local dev needs the same `tokenCreator` grant for the developer's own identity.

## 5. One clean event, customer-safe description (option a)

Each campaign → **one** Google event. The dealer is a guest on it, so the description must be customer-safe: dealership, dates, coach, format, contact. The internal ops fields (`qty_records`, `sms_email`, `letters`, `bdc`, data source) — which the legacy screenshot leaked into the description — stay **app-only**. Rejected option (b) "two events (internal full + customer clean)" as more to keep in lockstep for no real gain now that the app holds the ops detail.

## 6. Best-effort sync (leaning) — the app is never blocked by Google

Because the app is the source of truth and the calendar is distribution, a Google API failure should **not fail the booking**. Plan: the mutation succeeds, the campaign is flagged "needs sync," and a manual re-sync is offered. (Confirm vs. block-on-failure during build — `intent.md` Open question.)

## 7. Schema-shape resolutions (Phase 3, owner-confirmed 2026-06-12)

Two `intent.md` Open Questions blocked the Phase 3 migration; the owner resolved both:

- **Coach → `colorId` source = auto-derive, no column.** `coachGcalColorId(id) = (id % 11) + 1` (`src/lib/google/calendar-event.ts`) maps a coach to a *stable* Google palette id (1..11) by their row id. Chosen over a stored `gcal_color_id` on `team_member_roles` + admin UI: it satisfies the "colour-by-coach" success criterion with **zero schema and zero admin surface**. Trade-off: colours aren't hand-picked and ids 11 apart collide — acceptable for an at-a-glance overlay. Departs from the legacy *encounter-order* assignment (which shifts when coaches change) precisely so a projected event's colour is durable. Revisit only if the owner wants to choose/lock specific colours.
- **"Needs sync" signal = a status column, not link-only.** `campaigns.gcal_sync_status` (`pending`/`synced`/`failed`, NOT NULL default `pending`) + `gcal_synced_at` timestamptz, alongside the `gcal_event_id` durable link. Chosen over inferring "needs sync" from `gcal_event_id IS NULL`: the explicit status distinguishes *never attempted* from *failed* from *stale-after-edit*, giving a precise admin "needs sync" list + targeted manual re-sync (§6). Cost: one enum + two columns to keep in lockstep with the Phase-4 wiring. Migration `0037` (additive, NOT NULL via constant default — Postgres backfills existing rows to `pending`).
