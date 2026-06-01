#!/usr/bin/env bash
# chunk 0063: rebuild the disposable test Postgres from migration 0.
#
# Tears down the container + volume, brings up a fresh postgres:17, stubs
# auth.users, and replays every Drizzle migration (0000 -> latest) against it.
# Idempotent + safe to re-run. NEVER touches the shared Supabase DB: it targets
# TEST_DATABASE_URL (a local container), guarded both here and in
# drizzle.test.config.ts.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

TEST_DATABASE_URL="${TEST_DATABASE_URL:-postgres://postgres:postgres@127.0.0.1:55432/event_manager_test}"
export TEST_DATABASE_URL

# --- Safety guard: refuse any non-local host. The shared Supabase DB must be
# unreachable from this harness.
host="$(printf '%s' "$TEST_DATABASE_URL" | sed -E 's#^[a-zA-Z]+://[^@]*@([^:/]+).*#\1#')"
case "$host" in
  localhost | 127.0.0.1) ;;
  *)
    echo "ERROR: TEST_DATABASE_URL host is '$host' — refusing to run the test-db harness against a non-local host." >&2
    exit 1
    ;;
esac

echo "==> Tearing down any existing test DB (docker compose down -v)"
docker compose down -v

echo "==> Starting a fresh postgres:17 container"
docker compose up -d

echo "==> Waiting for Postgres to accept connections"
ready=""
for _ in $(seq 1 30); do
  if docker compose exec -T db pg_isready -U postgres -d event_manager_test >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 1
done
if [ -z "$ready" ]; then
  echo "ERROR: Postgres did not become ready in time." >&2
  exit 1
fi

echo "==> Bootstrapping the auth.users stub"
docker compose exec -T db psql -v ON_ERROR_STOP=1 -U postgres -d event_manager_test \
  < scripts/test-db/bootstrap-auth.sql

echo "==> Replaying migrations 0000 -> latest (drizzle.test.config.ts)"
pnpm exec drizzle-kit migrate --config drizzle.test.config.ts

# Dev fixtures (dealers / contacts / draft quotes with picked lines) so the DB
# is ready to exercise. Skip with TEST_DB_SEED=0 for a clean integration-test DB.
if [ "${TEST_DB_SEED:-1}" != "0" ]; then
  echo "==> Seeding dev fixtures (scripts/test-db/seed-dev.sql)"
  docker compose exec -T db psql -q -v ON_ERROR_STOP=1 -U postgres -d event_manager_test \
    < scripts/test-db/seed-dev.sql

  # Mirror the dev auth user into the stub auth.users so app writes that stamp
  # created_by_id/updated_by_id (the session uuid) satisfy the FK. Best-effort:
  # needs Supabase creds in .env.local + BROWSE_AUTH_EMAIL. Non-fatal.
  echo "==> Mirroring dev auth user into auth.users (so writes pass the actor FK)"
  TEST_DATABASE_URL="$TEST_DATABASE_URL" pnpm exec tsx scripts/test-db/seed-auth-user.ts \
    || echo "   (skipped — run 'pnpm db:test:seed:auth' once you have Supabase creds in .env.local)"
fi

echo "==> Test DB ready at ${TEST_DATABASE_URL}"
