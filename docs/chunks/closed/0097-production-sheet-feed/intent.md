# Production List → shareable Google worksheet feed — Intent

**Created:** 2026-07-06

## Problem

Third parties who **implement/deliver the campaigns** (the mailing houses, call
centres, print vendors) need to see what work is booked and coming up — dates,
dealer + location, format, coach, and the delivery volumes (records / SMS-email /
letters / BDC) that define their workload. Today that data lives only inside the
gated `/production` admin list; there's no way to hand an outside vendor a
live, always-current view. The owner would otherwise re-key or email spreadsheets
by hand.

## Desired outcome

The owner creates one Google Sheet, points a cell at the app with
`=IMPORTDATA("https://…/api/production-feed?token=…")`, and shares that Sheet with
the implementers. Google auto-refreshes it (~hourly), so the vendors always see the
current booked/upcoming schedule with just the delivery-relevant columns — no
internal notes, no raw contact PII. The app's only job is to serve a stable,
token-gated, read-only feed of the right rows and columns.

## Desired columns (delivery-focused)

`Start Date · End Date · Dealer · Location · Format · Coach · Records · SMS-Email ·
Letters · BDC`. **Deliberately excluded:** internal `notes`, raw contact
`phone`/`email`, `Data Source`/audience source, billing adjustments, status/ops
internals. (The volumes ARE included here — unlike the customer-facing calendar
projection that treated them as internal — because they're the implementer's
actual workload.)

## Scope of rows

Booked + upcoming only: `status ∈ {booked, completed}` **AND** `endDate ≥ today`.
Excludes draft, cancelled, and fully-past campaigns.

## Non-goals

- **No Google Sheets API / Drive API / DWD scope.** The Calendar integration's
  keyless auth is NOT extended here; the feed is a plain HTTP endpoint the Sheet
  pulls. (Avoids a Workspace-admin scope authorization + the org's Domain
  Restricted Sharing policy on service-account-owned files.)
- **No app-managed sharing / ACLs.** The owner owns and shares the Google Sheet
  through normal Google sharing; the app never touches Google file permissions.
- **No write-back.** One-way, read-only. The app stays the source of truth.
- **No near-real-time.** IMPORTDATA refreshes on Google's cadence (~hourly); that's
  accepted.
- **Not reusing `/share/coach/[id]`'s model** (public, token-less, enumerable) —
  this feed is bearer-token-gated.

## Success criteria

- `GET /api/production-feed?token=<valid>` returns a CSV the Sheet's `IMPORTDATA`
  parses, containing exactly the delivery-focused columns and only booked+upcoming
  rows.
- `GET /api/production-feed` with a missing/wrong token returns 401/403 — no data.
- The feed **never** emits `notes`, contact `phone`/`email`, or audience source
  (asserted by a unit test).
- The endpoint is publicly reachable (Google's fetcher isn't authenticated) yet
  the app's gated surface is unaffected.
- The token is sourced from a secret (`production-feed-token`), constant-time
  compared, and rotatable (rotate secret → update the Sheet formula).

## Open questions

- **Token exposure.** The bearer token lives in the Sheet's `IMPORTDATA` formula
  (visible to anyone with edit access to the Sheet) and in Google's + our access
  logs. Accepted because the feed is low-sensitivity (delivery data, no PII) and
  rotatable — but worth a one-line note in the runbook. Do we want per-vendor
  tokens later? (Deferred — single shared token for the MVP.)
- **Feed freshness vs. `IMPORTDATA` cache.** ~1h is fine for scheduling vendors;
  revisit only if someone needs same-day changes reflected faster.
- **Discoverability.** Does the owner get the ready-to-paste formula from a small
  admin panel, or just construct the URL once from the secret? (Leaning: a tiny
  admin-only helper; see plan Phase 4 — optional.)

## Why now

The production list just gained a sortable Date column (0096) and is the operational
hub for scheduled work; the natural next step is getting that schedule in front of
the outside vendors who actually run the events, without hand-maintained
spreadsheets.
