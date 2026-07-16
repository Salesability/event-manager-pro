# Stage seed harness — marker-owned demo-seed modules — Intent

**Created:** 2026-07-16

## Problem

Stage demo data is currently produced by one-off scripts: per-chunk smoke fixtures with `insert`/`cleanup` subcommands (`scripts/0108-booking-smoke.ts`, `scripts/0110-console-polish-smoke.ts`) and ad-hoc throwaways (the 2026-07-15 Century Mazda recipient seed was written, run, and deleted in one sitting). The demo state shown at a business review isn't reproducible, the ad-hoc seeds piggyback on *real* sandbox rows (Century Mazda is an owner-vetted dealer), and every new demo need re-invents the same fixture plumbing. The reference model ([bcgov/biohubbc-platform `database/src/seeds`](https://github.com/bcgov/biohubbc-platform/tree/dev/database/src/seeds)) — ordered seed modules, env-flag guard, faker data — gets its idempotency from an ephemeral docker DB that's reset before every run. Our stage reads the **long-lived shared sandbox Supabase DB** (also local dev's DB, carrying unregenerable data: Atlantic dealer reconciliation, QBO links, real quotes/MSAs), so "reset the world" is not available — idempotency has to live in the seeds themselves.

## Desired outcome

- A `scripts/seeds/` harness: numerically-ordered modules, each exporting `seed(db)` + `clean(db)`, walked by a runner (`pnpm seed:demo` / `pnpm seed:demo --clean`) — seed in order, clean in reverse (FK-safe).
- **Marker ownership**: every seeded row is identifiable and owned by the harness — `publicId` prefixed `demo-`, phones in a reserved `+1999…` block, a dedicated demo dealer (never a real dealer's campaign). Idempotency = each module cleans its own marker scope before seeding (a scoped "reset" that cannot touch real data).
- **Hard environment guards**: refuse outright when `DATABASE_URL` contains the prod ref (`fkfybeddnfxnjuxkqidp`) regardless of flags, plus a bcgov-style explicit opt-in so the runner never fires by accident.
- The SMS-line demo (the immediate consumer) is reproducible end-to-end: demo dealer + booked campaign with the SMS add-on, recipient list with the deliberate consent mix (eligible / stale-CASL / opted-out), and enough send/thread history that the funnel strip, console, inbox, and `/sms` aggregates all light up without a phone in the loop.
- Existing per-chunk smoke fixtures are promotable into modules over time; new chunks add a module instead of a new throwaway script.

## Non-goals

- **No docker-reset flow changes** — the ephemeral test DB (`pnpm db:test:*` + `seed-dev.sql`) already implements the bcgov pattern where it fits; untouched.
- **No lookup-table seeding** — lookups stay as idempotent seed migrations (`0001`, `0013`).
- **No faker/bulk volume tier** — hand-authored narrative fixtures only (each row exists to light up a specific chip). Deterministic bulk (e.g. `drizzle-seed` for the parked 0107-a inbox-scale pass) is a follow-up module when needed.
- **No prod seeding of any kind.** The guard exists to make this structurally impossible.
- **No CI wiring** — the runner is invoked by a human (or Claude) before a demo, not on deploy.

## Success criteria

- `pnpm seed:demo` on the sandbox DB is idempotent: run twice, row counts identical; `pnpm seed:demo --clean` leaves zero marker-owned rows and zero rows touched outside the marker scope.
- Pointing `DATABASE_URL` at anything containing the prod ref makes the runner exit non-zero before any DB write.
- After seeding, the stage/local UI shows the demo campaign with the full SMS surface lit: pre-send chips (incl. stale-consent + opted-out exclusion rows), funnel strip with reconciled numbers, a named conversation thread with turn-state + sentiment/temperature labels, and `/sms` aggregates.
- The Century Mazda fixture rows from 2026-07-15 are migrated into (or replaced by) the demo-dealer module and swept from the real dealer's campaign.

## Open questions

- **Fabricated history vs real-flow only:** should seeds write `sms_sends`/`sms_messages`/`sms_threads` rows no Twilio call ever made (instant, deterministic — what the 0110 smoke script does), or should message history only ever come from walking the real flows? Leaning: fabricate, clearly marked — the harness is a demo tool, not a ledger.
- Does the demo dealer need non-SMS surface coverage too (quote, MSA, production row) in v1, or is the SMS line enough for the imminent review cycle?
- Runner ergonomics: plain `tsx` script vs a tiny CLI with per-module selection (`pnpm seed:demo --only 20-sms-recipients`)? Leaning: per-module selection from day one — it's cheap and the smoke scripts already prove the need.

## Why now

The SMS-line stage review (owner-stated next step after 0110) is being demoed off hand-rolled state: the 2026-07-15 Century Mazda seed lives only in this conversation's history, and re-creating it after a purge or DB change means re-writing it. Formalizing the harness now means every subsequent review cycle (and the booking-chunk-2 / prod-runway demos behind it) starts from `pnpm seed:demo` instead of archaeology.
