#!/usr/bin/env bash
# Run any command against the PRODUCTION Supabase DB, with DATABASE_URL fetched
# from GCP Secret Manager at runtime — never pasted into a chat, never written
# to a file, never echoed. Access is governed by GCP IAM (the runner needs
# roles/secretmanager.secretAccessor on the secret) plus, for Claude, the
# allow-rule in .claude/settings.local.json scoped to this script.
#
# Usage:
#   ./scripts/with-prod-db.sh drizzle-kit migrate         # apply pending migrations
#   ./scripts/with-prod-db.sh psql "$DATABASE_URL" -c 'SELECT 1'
#   ./scripts/with-prod-db.sh pnpm exec tsx scripts/some-backfill.ts
#
# Migrations need the SESSION pooler (port 5432) — the 6543 transaction pooler
# can't run DDL. If `database-url-production` holds the 6543 runtime URL, point
# this at a 5432 secret instead:
#   PROD_DB_SECRET=database-url-production-session ./scripts/with-prod-db.sh drizzle-kit migrate
set -euo pipefail

SECRET="${PROD_DB_SECRET:-database-url-production}"
PROJECT="${PROD_DB_PROJECT:-eventpro-498313}"

if [ "$#" -eq 0 ]; then
  echo "usage: $0 <command> [args...]" >&2
  exit 64
fi

# Optional local prod-op secrets (gitignored via `.env.*`, and NOT auto-loaded by
# Next — it ignores `.env.prod.local`). Use it to stash QBO_TOKEN_ENC_KEY so the
# read-only prod QBO probes don't need a per-run `gcloud secrets access` prefix.
# Format (one var per line, no quotes needed for base64): QBO_TOKEN_ENC_KEY=<key>
if [ -f .env.prod.local ]; then
  set -a; . ./.env.prod.local; set +a
  echo "🔑 Loaded local prod-op secrets from .env.prod.local" >&2
fi

DATABASE_URL="$(gcloud secrets versions access latest --secret="$SECRET" --project="$PROJECT")"
export DATABASE_URL

# Confirm the target without leaking the password — print host:port only
# (everything before the '@' is stripped).
echo "🔐 PROD DB → $(printf '%s' "$DATABASE_URL" | sed -E 's#.*@([^/?]+).*#\1#')  (secret: ${SECRET}, project: ${PROJECT})" >&2

exec "$@"
