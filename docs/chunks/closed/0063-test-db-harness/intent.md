# Containerized Test DB Harness — Intent

**Created:** 2026-06-01

## Problem

The only configured `DATABASE_URL` (`.env.local`) points at the **shared** Supabase pooler. There is no disposable local database, so:

- The `/build` loop has been **deferring all real-DB verification** — 0062's Phases 1/4/8 each note "no local DB in the build loop", so the schema migration, the delete-and-insert write path, and the backfill were verified only by mocked unit tests, never against real Postgres.
- **Destructive migrations can't be rehearsed.** 0062 Phase 7 wants to `DROP COLUMN quotes.line_items`. Today the only place to run that is the shared DB — there's no safe sandbox to confirm the `0024` backfill populated `quote_line_items` before `0025` drops the source column.
- Drizzle is **forward-only** (no down-migrations), so the natural "undo" for a test DB is *rebuild from zero* — which we have no harness for.

## Desired outcome

A committed, reusable, **disposable Postgres** that any developer (or the build loop) can stand up and rebuild **from migration 0** with one command, entirely isolated from the shared DB:

- `docker compose up` a `postgres:17` service (matches Supabase's Postgres 17.6) on a throwaway volume + a non-default host port (no clash with any existing local PG on 5432).
- A one-command **reset**: tear down → fresh container → bootstrap the `auth.users` stub → `drizzle-kit migrate` replays `0000 → latest`. Idempotent; safe to run repeatedly.
- A **localhost-only safety guard**: the reset script refuses to run `migrate` against any `DATABASE_URL` host that isn't `localhost`/`127.0.0.1`, so the harness can never touch the shared DB by accident.
- This becomes the home for the **real-DB integration tests** deferred elsewhere, and the rehearsal stage for **any** future migration before it reaches the shared DB.

## Non-goals

- **Not** replacing the shared Supabase DB for everyday app dev (the app still runs against `.env.local`).
- **Not** full fixture/seed data — an empty schema replayed from migrations is the baseline (integration tests insert their own rows).
- **Not** emulating Supabase Auth / RLS beyond the minimal `auth.users` FK stub the migrations need.
- **Not** Drizzle down-migrations — reset == rebuild from zero.
- **Not** CI wiring — running this in CI is a possible follow-up, not this chunk.

## Success criteria

- `pnpm db:test:reset` brings up a fresh `postgres:17` container, applies the `auth.users` bootstrap, and replays **every** migration `0000 → 0024` from zero with **no errors**.
- After reset, `quote_line_items` exists with its columns + indexes, and the `0024` backfill ran (0 rows on an empty `quotes` table is the correct result; a seeded row with `line_items` would produce matching `quote_line_items` rows).
- The reset script **aborts** if `DATABASE_URL` resolves to a non-localhost host (shared-DB safety).
- `docker compose down -v` tears everything down cleanly (no lingering volume).
- A short wiki note documents the harness so it's discoverable.

## Open questions

- **Where `drizzle-kit migrate` reads its URL.** It reads `process.env.DATABASE_URL`. The reset script exports a localhost `DATABASE_URL` inline for the migrate invocation; verify dotenv doesn't override the shell-set value (dotenv does not override existing env by default — confirm empirically in Phase 3).
- **`auth.users` stub fidelity.** A bare `id uuid PRIMARY KEY` + `email text` satisfies the FK references (`ON DELETE SET NULL`). If a future migration needs more `auth.users` columns, extend the bootstrap then.
- **Host port.** Default to `55432` to avoid the existing local PG on `5432`; make it env-overridable.

## Why now

0062's Phase 7 is blocked on a safe way to rehearse a destructive `DROP COLUMN` against real Postgres — the user called for "a container-based DB we rebuild from migration 0 for this kind of testing." Building it now unblocks 0062's finish *and* pays down the standing "no local DB → defer all real-DB verification" debt that every recent DB chunk has carried.
