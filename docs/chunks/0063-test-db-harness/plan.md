# Containerized Test DB Harness — Plan

**Intent:** [`intent.md`](intent.md)
**Started:** 2026-06-01

## Progress Tracker

| Phase | Status | Commit |
|-------|--------|--------|
| 1: Compose service + auth bootstrap SQL | Pending | - |
| 2: Reset script + npm scripts (localhost guard) | Pending | - |
| 3: Verify replay-from-zero + wiki note | Pending | - |

A disposable `postgres:17` container, rebuilt from migration 0 with one command, isolated from the shared Supabase DB. "Done" looks like: `pnpm db:test:reset` stands up a fresh container, stubs `auth.users`, replays `0000 → 0024` cleanly, and the script refuses to run against any non-localhost `DATABASE_URL`. Becomes the rehearsal stage for 0062's `DROP COLUMN` and the home for deferred real-DB integration tests.

## Code Anchors

Greenfield infra — no existing docker/compose in the repo. Anchors are conventions + config, not sibling files.

| New code | Anchor (`path:line`) | Why this anchor |
|----------|---------------------|-----------------|
| `docker-compose.yml` (postgres:17 service) | _none — greenfield_ | First compose file; keep it minimal (one service, one throwaway volume, non-default host port) |
| `scripts/test-db/bootstrap-auth.sql` | `drizzle/0000_cute_ser_duncan.sql:1` (the "auth.users managed by Supabase" header) | The stub fills exactly the gap that comment names — `auth` schema + `auth.users(id uuid pk)` the FKs reference |
| `scripts/test-db/reset.sh` | existing `scripts/*.ts` shape (e.g. `scripts/flip-msa-status.ts`) | Same `scripts/` home + "operational helper" role; bash here (orchestration, not app code) |
| `db:test:*` npm scripts | `package.json` `db:migrate` line | Same `db:`-prefixed script family; `reset` wraps `drizzle-kit migrate` with the container URL |
| `drizzle-kit migrate` env wiring | `drizzle.config.ts:9` (`url: process.env.DATABASE_URL!`) | Confirms the migrate target is `DATABASE_URL`-driven; the script exports a localhost URL for the call |

**Conventions referenced:**
- `db-conventions` skill — PG 17.6 (→ `postgres:17`), direct-vs-pooled (the container is a direct connection on 5432), the `auth.users` "managed by Supabase, not migrated" gotcha (→ the bootstrap stub), forward-only migrations (→ reset = rebuild from zero).
- `docs/wiki/architecture.md` / `data-model.md` — Phase 3 adds a short "Test DB harness" note pointing at the scripts.

**Overall Progress:** 0% (0/3 phases complete)

**Note:**
- The container is a *direct* 5432 connection (inside the container), exposed on host `55432` — DDL-transaction-safe, unlike the shared pooler.
- The localhost guard is the load-bearing safety rail: parse the host out of `DATABASE_URL`; abort unless `localhost`/`127.0.0.1`.
- Reset is destructive **only to the container** (`down -v` drops the volume). Never touches the shared DB.

### Phase Checklist

#### Phase 1: Compose service + auth bootstrap SQL
- [ ] Write `docker-compose.yml` — one `db` service: `image: postgres:17`, `POSTGRES_USER=postgres` / `POSTGRES_PASSWORD=postgres` / `POSTGRES_DB=event_manager_test`, `ports: ["55432:5432"]`, a named volume, and a `healthcheck` (`pg_isready`).
- [ ] Write `scripts/test-db/bootstrap-auth.sql` — `CREATE SCHEMA IF NOT EXISTS auth; CREATE TABLE IF NOT EXISTS auth.users (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text);` (mirrors the Supabase-managed table the migrations FK-reference but never create).
- [ ] Add a `.gitignore` entry if the volume or any local artifact would otherwise be tracked (named docker volumes live outside the repo, so likely nothing).
- [ ] `.env.example` / docs: document `TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55432/event_manager_test`.

#### Phase 2: Reset script + npm scripts (localhost guard)
- [ ] Write `scripts/test-db/reset.sh` (`set -euo pipefail`):
  - [ ] Resolve `TEST_DATABASE_URL` (default `postgres://postgres:postgres@127.0.0.1:55432/event_manager_test`).
  - [ ] **Guard:** extract the host; `case` it must be `localhost`/`127.0.0.1`, else `echo` an error + `exit 1`.
  - [ ] `docker compose down -v` → `docker compose up -d` → wait for `pg_isready` (poll loop, bounded).
  - [ ] `psql "$TEST_DATABASE_URL" -f scripts/test-db/bootstrap-auth.sql`.
  - [ ] `DATABASE_URL="$TEST_DATABASE_URL" pnpm exec drizzle-kit migrate` (replays `0000 → latest`).
- [ ] `package.json`: `db:test:up` (compose up + bootstrap), `db:test:reset` (the script), `db:test:down` (`docker compose down -v`), `db:test:psql` (open psql against the container).
- [ ] Make `reset.sh` executable (`chmod +x`).

#### Phase 3: Verify replay-from-zero + wiki note
- [ ] Run `pnpm db:test:reset`; confirm `0000 → 0024` all apply with no errors (capture the drizzle-kit output).
- [ ] `pnpm db:test:psql -c '\d quote_line_items'` — table + 4 indexes present.
- [ ] `psql … -c "select count(*) from quote_line_items"` — 0 on the empty replay (the backfill ran, no source rows); optionally insert one `quotes` row with a `line_items` jsonb element + re-run the backfill statement to confirm it maps.
- [ ] Confirm the localhost guard: run `reset.sh` with `TEST_DATABASE_URL` pointed at a fake remote host → it aborts before any docker/migrate action.
- [ ] `docker compose down -v` — clean teardown, no lingering volume.
- [ ] Add a "Test DB harness" note to `docs/wiki/conventions.md` (or `architecture.md`) + a `log.md` entry.
- [ ] Run `/eval` (static + Codex; browser smoke N/A for infra); resolve any Must-Fix; commit.
