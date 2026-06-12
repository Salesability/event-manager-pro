# Calendar distribution (Google Calendar projection)

How a booked campaign reaches the people who work it. The app (`campaigns` table) is the **single source of
truth**; Google Calendar is a **one-way projection** (app → calendar), not a rival system of record. Hand-edits in
Google are not read back. This replaces the legacy failure mode — the whole schedule living on one person's
*personal* calendar, with internal ops data leaked into the invite description.

Built in chunk [`0077-calendar-distribution`](../chunks/0077-calendar-distribution/plan.md). Structurally it mirrors
a QuickBooks push slice (`0070`/`0073`): external-API client wrapper → pure domain→payload mapper → a nullable
durable-link column → wiring into the existing mutation Server Actions → tests.

## The pieces

| Layer | Where | What it does |
|-------|-------|--------------|
| Keyless client | `src/lib/google/calendar.ts` | `createEvent` / `patchEvent` / `deleteEvent` against the configured calendar; keyless DWD auth (signJwt → token exchange); `deleteEvent` idempotent (404/410 = success). |
| Pure mapper | `src/lib/google/calendar-event.ts` | `mapCampaignToGcalEvent(campaign, dealer, coach, appLink)` → event body. `coachGcalColorId(id)` derives the colour. DB-free, unit-tested. |
| Reconcile | `src/features/schedule/calendar-sync.ts` | `reconcileCampaignCalendar(campaignId, userId, exec?)` — the single status-driven entry point. Best-effort: never throws. |
| Wiring | `src/features/schedule/actions.ts` | `createCampaign` / `updateCampaign` / `cancelCampaign` each `await reconcileCampaignCalendar` after their DB write; `resyncCampaign` is the manual recovery action. |
| UI | `src/app/(app)/calendar/event-detail.tsx` | A **Calendar** status badge (`Synced` / `Sync failed` / `Not synced`) + a **Re-sync** button (capability `campaign:edit`). |

## Auth — keyless domain-wide delegation

The `eventpro-498313` org enforces `iam.disableServiceAccountKeyCreation`, so there is **no downloaded SA key**.
Instead the base identity (the Cloud Run runtime SA in prod, the developer's ADC locally) calls IAM Credentials
`signJwt` to have the `eventpro-calendar` SA sign a DWD assertion (`sub` = the organizer subject), which is
exchanged for an access token acting as that subject. DWD impersonation of a *real* Workspace user is **required**
to add attendees at all (a plain SA errors: *"Service accounts cannot invite attendees without Domain-Wide
Delegation"*).

**Organizer = the calendar's display name, not the subject.** A test event came back with
`organizer: { email: "c_…@group…", displayName: "EventPro" }` and `creator: { email: "shannon@…" }` — so guests see
the *calendar*, and the impersonated user is only the (invisible) creator. Consequences: the dealer-facing brand is
the calendar's display name (rename it to **"SaleDay Events"**), it costs no per-seat mailbox, and it survives the
organizer leaving. The future `events@` rebrand is just flipping `GOOGLE_CALENDAR_SUBJECT` — no schema change, no
data migration (old events keep their organizer; only new ones switch).

Provisioning details (SA email, Client ID, calendar ID, the `tokenCreator` grant, the three env vars) live in the
go-live runbook: [`go-live-accounts.md` §4a](go-live-accounts.md). Auth model rationale:
[chunk decision.md §3/§4a](../chunks/0077-calendar-distribution/decision.md).

## The event body

One clean, customer-safe event per campaign (decision §5). The dealer is a guest, so the description carries **only**
coach / format / dealer-contact + an app link — **never** the internal ops fields (`qty_records`, `sms_email`,
`letters`, `bdc`, audience source) that the legacy hand-typed invite leaked. Other shape rules:

- **All-day, end-EXCLUSIVE.** Google all-day `end.date` is exclusive, but `campaigns.end_date` is the inclusive last
  day, so the projected end is `end_date + 1` (`addDaysIso`, UTC/DST-safe).
- **Guests:** the coach (`responseStatus: accepted` — pre-contracted, not "please confirm") + the dealer contact
  (`campaigns.email`). `guestsCanInviteOthers` / `guestsCanSeeOtherGuests` both `false`. The attendee list is always
  sent (even empty) so a patch fully reconciles a coach/contact change.
- **Colour-by-coach** is **derived, not stored**: `coachGcalColorId(id) = (id % 11) + 1` maps each coach to a stable
  Google palette slot (1–11). No `team_member_roles` colour column (decision §7). Collisions every 11 ids are
  acceptable for an at-a-glance overlay.
- Reminders (email 1 day, popup 2 h), `extendedProperties.private.campaignId` back-link, `source` → `/calendar`
  (there's no per-campaign deep route yet).

## Sync state machine (best-effort)

`reconcileCampaignCalendar` is **status-driven and idempotent**, and **never blocks the campaign mutation** — the
app is authoritative, so a Google failure is swallowed (decision §6):

- `booked` / `completed` → **upsert**: linked (`gcal_event_id` set) → `patchEvent`; unlinked → `createEvent` +
  **guarded backfill** (`WHERE gcal_event_id IS NULL`). A lost backfill race best-effort deletes the duplicate event.
- `draft` / `cancelled` → **remove**: `deleteEvent` (idempotent) + clear `gcal_event_id`.
- On any error → mark `gcal_sync_status = 'failed'`, log, return `failed` (the mutation still succeeds).
- `skipped` when Google or `SITE_URL` is unconfigured — the row's status is left untouched.

The schema columns on `campaigns` (migration `0037`): `gcal_event_id` (nullable text, partial-unique
`WHERE NOT NULL`), `gcal_sync_status` enum (`pending` / `synced` / `failed`, default `pending`), `gcal_synced_at`.
See [`data-model.md`](data-model.md). The chosen status-column model (over inferring "needs sync" from a null link)
is decision §7.

## Tests + verification

- Unit: `src/lib/google/calendar.test.ts` (config + URL encoding), `calendar-event.test.ts` (mapper — end+1, clean
  description, guests, colour).
- Integration: `tests/integration/calendar-sync.test.ts` — create / patch / cancel / best-effort-failure / skipped /
  no-coach paths against the sandbox DB with the Google client mocked (the real mapper runs).
- Live round-trip: `scripts/0077-calendar-smoke.ts` (manual — needs ADC + the env vars; uses `sendUpdates='none'` so
  it emails nobody). Run with `NODE_OPTIONS='--conditions=react-server'` so `server-only` resolves to an empty module.

## Out of scope / future

Two-way sync (no read-back of hand-edits), conflict/free-busy detection, RSVP read-back (low value — events are
pre-contracted), and the service-provider shareable production list (that's the tokenized read-only app link,
`future/0058` territory — a different surface from the calendar). The `events@` rebrand is config-ready but not
executed.
