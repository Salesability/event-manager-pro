# Production List → shareable Google worksheet feed — Plan

**Intent:** [`intent.md`](intent.md)
**Started:** 2026-07-06

## Progress Tracker

| Phase | Status | Commit |
|-------|--------|--------|
| 1: Pure feed model (select + redacted row mapper) + unit tests | Done | `527c293` |
| 2: Public token-gated feed route (`/api/production-feed`) | Done | `331e480` |
| 3: Secret + deploy wiring + P0 owner-setup doc | Done | `38ca8e4` |
| 4: Admin discoverability panel (optional — IMPORTDATA formula) | Pending | - |
| 5: Verification (route test + public-feed smoke) | Pending | - |

Serve the Production List as a **public, token-gated, read-only CSV feed** of
booked+upcoming campaigns with delivery-focused columns only, so a Google Sheet can
pull it via `=IMPORTDATA()` and the owner can share that Sheet with implementers.
"Done" = `GET /api/production-feed?token=<valid>` returns the redacted CSV, a
missing/wrong token is rejected, the feed leaks no PII/notes, and the token is
sourced from the `production-feed-token` secret + wired into deploy. **No Google
API, no DWD scope, no migration.**

## Code Anchors

| New code | Anchor (`path:line`) | Why this anchor |
|----------|---------------------|-----------------|
| `src/features/schedule/production-feed.ts` — `selectFeedCampaigns` + `FEED_HEADERS` + `mapCampaignToFeedRow` | `src/lib/google/calendar-event.ts:62` (`mapCampaignToGcalEvent` — the customer-safe field-selection/redaction precedent) + `src/lib/quotes/delivery-metrics.ts` (pure, testable mapping module shape) | Pure mapper that deliberately withholds ops/PII fields; same "explicit safe subset" discipline |
| `src/app/api/production-feed/route.ts` — public feed route | `src/app/api/boldsign/webhook/route.ts` (public, external-caller route that verifies a shared secret before doing work) + `src/app/(app)/production/export/route.ts` (the `loadCampaigns → buildCsv → csvResponse` shape) | Same public-route + secret-gate shape; same CSV-of-production-list shape (minus the gate swap: `assertCan` → token) |
| Constant-time token compare helper | `src/lib/boldsign/webhook-verify.ts` (`timingSafeEqual`/secret compare) | Reuse the existing constant-time secret-compare idiom; don't hand-roll `===` |
| `PUBLIC_PATHS` entry (if the session middleware gates it) | `src/lib/supabase/middleware.ts:11` (`/share/coach`) | Mirror the existing public-path allowlist; `isPublicPath` is prefix-matched (`:16`) |
| Secret wiring in deploy | `deploy.sh:333` (`--set-secrets=…BOLDSIGN_WEBHOOK_SECRET=boldsign-webhook-secret:latest`) + `cloudbuild.deploy.yaml` `--set-secrets` (`:104`-ish) + `cloudbuild.deploy.stage.yaml` | Add `PRODUCTION_FEED_TOKEN=production-feed-token:latest` the same way an existing app secret is mounted |
| Admin IMPORTDATA-formula panel (Phase 4, optional) | `src/app/(app)/production/production-page-actions.tsx` (client action bar on `/production`) | Same page, same "surface a copyable action" shape; gated admin-only |

**Conventions referenced:**
- `CLAUDE.md` → "Mutations go through Server Actions, not route handlers. Route handlers are for external callers only — webhooks, public APIs." The feed is consumed by Google's `IMPORTDATA` fetcher (external) → a **route handler** is correct.
- `docs/wiki/data-model.md` — `Campaign` fields (`src/features/schedule/queries.ts:90-117`); ops/PII fields to withhold: `qtyRecords`(kept here), `notes`, `phone`, `email`, `audienceSourceLabel`.
- `docs/wiki/go-live-accounts.md` — deploy secret-mount runbook; add a `production-feed-token` row.

**Overall Progress:** 60% (3/5 phases complete)

### Phase Checklist

#### Phase 1: Pure feed model + unit tests
- [x] `src/features/schedule/production-feed.ts`: `FEED_HEADERS` (Start Date, End Date, Dealer, Location, Format, Coach, Records, SMS-Email, Letters, BDC); `selectFeedCampaigns(campaigns, todayIso)` keeps `status ∈ {booked, completed} && endDate >= todayIso`; `mapCampaignToFeedRow(c)` emits the safe subset (blanks for null; **never** touches `notes`/`contact`/`phone`/`email`/audience source).
- [x] Unit tests (`production-feed.test.ts`, 7/7): filter includes booked-future + completed-today, excludes draft / cancelled / fully-past; mapper emits exactly `FEED_HEADERS.length` cells in order, nulls → blank; **redaction test** asserts sentinel `notes`/`contact`/`phone`/`email`/source never surface.

#### Phase 2: Public token-gated feed route
- [x] `src/app/api/production-feed/route.ts` (`GET`, `dynamic='force-dynamic'`): reads `PRODUCTION_FEED_TOKEN` — unset/empty → 500 (fail-closed). Reads `?token=`; constant-time compare (`timingSafeEqual` + length guard, à la `webhook-verify`). Mismatch/absent → 401 (bare body, no DB read).
- [x] On valid token: `loadCampaigns()` → `selectFeedCampaigns(all, todayIso())` → CSV via `csvCell` (imported from `@/lib/csv` for the formula-injection escaping) joined inline **without** `buildCsv`'s UTF-8 BOM (a BOM would land as a stray char in the Sheet's A1 under `IMPORTDATA`). Returns `text/csv; charset=utf-8`, `Cache-Control: no-store`, no attachment disposition.
- [x] Added `/api/production-feed` to `PUBLIC_PATHS` (`src/lib/supabase/middleware.ts`) — the `src/proxy.ts` middleware matcher covers `/api/*`, so without it the feed would 307→/login. (Not an `ADMIN_PATHS` prefix, so no admin gate either.)
- [x] Route test (`route.test.ts`, 4/4, `loadCampaigns` mocked): no token → 401 (DB untouched); wrong token → 401; unset env → 500; valid token → 200 `text/csv`, header line + exactly the booked+upcoming rows, and no notes/contact/phone/email/source leak.

#### Phase 3: Secret + deploy wiring + P0 owner-setup doc
- [x] `deploy.sh`: added a **mount-if-present** block (mirrors `QBO_SECRET_MOUNTS`) — `FEED_SECRET_MOUNT` wires `PRODUCTION_FEED_TOKEN=production-feed-token:latest` only when the secret exists in the target project, appended to `--set-secrets`. Self-healing: a deploy never fails on a missing secret.
- [x] `cloudbuild.deploy.yaml` (the keyless path): a static args list can't do mount-if-present, so instead of a live mount that would break deploys pre-secret, added an inline comment with the exact secret-create commands + the one-line `--set-secrets` append to run once the secret exists. Did **not** touch `cloudbuild.deploy.stage.yaml` (prod-only feed for MVP).
- [x] Wiki: added **§4b Production feed → Google Sheet** to `docs/wiki/go-live-accounts.md` (secret, owner go-live steps, URL, rotate, local-dev note).
- [~] `.env.local` dev value — left to the user (gitignored secret file; the Phase-5 local smoke passes `PRODUCTION_FEED_TOKEN` inline to `pnpm dev` instead). Documented in §4b.
- [ ] **P0 OWNER steps (non-code — the classifier correctly blocked me from writing a prod secret):** (1) create `production-feed-token` (prod project) + grant the runtime SA accessor (commands in `cloudbuild.deploy.yaml` comment + wiki §4b); (2) append the one `--set-secrets` line + deploy; (3) create the Google Sheet with `=IMPORTDATA(<url>)` and share it with the implementers. **Until (1)+(2), the prod feed route returns 500 "not configured" (fail-closed).**

#### Phase 4: Admin discoverability panel (optional)
- [ ] Gated admin-only helper (on `/production` or `/admin`) that renders the ready-to-paste `=IMPORTDATA("<SITE_URL>/api/production-feed?token=<token>")` formula + a one-line "share this Sheet with vendors" note. Reads token from server env (admin-trusted surface). Cut this phase if we prefer to keep the token out of the browser entirely.

#### Phase 5: Verification (route test + public-feed smoke)
- [ ] Unit + route tests green (Phases 1–2).
- [ ] Smoke (public — no auth injection needed): `curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/api/production-feed` → 401; `curl ".../api/production-feed?token=<dev-token>"` → 200 with a CSV whose header row is `Start Date,End Date,Dealer,…,BDC`.
- [ ] Smoke: confirm the CSV body contains only booked+upcoming rows and **no** notes/phone/email substrings.
- [ ] (If Phase 4) Smoke (web-test): `goto /production` authed; the admin panel shows the IMPORTDATA formula. *(auth-injection may be blocked while the sandbox DB is paused — defer to owner-verify if so.)*
