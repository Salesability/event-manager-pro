# Conventions

Cross-cutting rules. The "what to do" reference; the "why" lives in [architecture.md](architecture.md), [data-model.md](data-model.md), and the relevant `docs/designs/` folders.

> Part of `docs/wiki/`. The `db-conventions` agent skill (`.claude/skills/db-conventions/SKILL.md`) covers the same ground for Claude in deeper detail; this page is the human-readable summary.

## Mutations

**Mutations go through Server Actions, not route handlers.** Route handlers (`src/app/**/route.ts`) are for external callers only — webhooks, OAuth callbacks (`/auth/callback`), public APIs. Anything triggered by our own UI is a Server Action with `'use server'`.

## Database

Stack is **Drizzle ORM + Supabase Postgres**. Schema is TypeScript in `src/lib/db/schema/`. Migrations are generated to `./drizzle/` via `pnpm db:generate` and applied via `pnpm db:migrate`.

### Drizzle vs `supabase-js`

- **Drizzle** for server SQL — Server Actions, webhook handlers, scripts, transactions. Connects as the Postgres `postgres` role (via the Supabase pooler in session mode, port 5432). **That role has `BYPASSRLS=t`**, so Drizzle queries skip Row Level Security policies entirely. Authorization on the Drizzle path lives in the calling Server Action's `requireRole(...)` gate, not in policies. Use Drizzle for everything the staff app does today.
- **`supabase-js`** (via `@supabase/ssr`) for auth, session, and any **future** RLS-bound reads from the dealer portal. The portal's PostgREST queries will run as `authenticated` (no BYPASSRLS), so the policies enabled in 0019 Phase 1 (`drizzle/0003_enable_rls.sql`) take effect there. Today `supabase-js` is used only for `auth.getUser()` / `auth.signInWithOtp()` / `auth.admin.*` — never for `.from(table).select()` against a domain table.
- Don't query the same table through both at the same call site. Pick one. (The split exists so the portal's "policy-enforced filter" guarantees aren't undermined by an accidental Drizzle read on the same surface.)
- Why this split: see `closed/0019-security-architecture/plan.md` Decision #1 for the full reasoning. Originally targeted in `closed/0002-nextjs-scaffold/decision.md:10`; the codebase had drifted to "Drizzle owns everything" before 0019 re-aligned the policies to the original hybrid intent.

### Schema defaults

| Concern | Pick |
|---|---|
| IDs | `bigint generated always as identity` via `bigIdentity()`. `mode: 'number'` everywhere — lossy past 2³³, fine for this scale. Profiles are uuid because they FK to `auth.users`. |
| UUID default | `gen_random_uuid()` (v4). `uuidv7()` is PG 18+; project is on **17.6**. |
| Strings | `text`, never `varchar(n)`. Use `CHECK` if you need a length cap. |
| Time | `timestamptz`, never `timestamp`. |
| Money | `numeric(p, s)`, never `float`. |
| Enums | `pgEnum` for stable value sets (`profile_role`, `event_status`). `text + CHECK` for sets that may shift shape. |
| FK indexes | Index every foreign key column. Postgres doesn't auto-index them. |
| Soft-delete | `archived_at` (via `archivable` mixin) for **reference data** only. Domain entities use a `status` enum, not `deleted_at`. |

### Mixins (`_columns.ts`)

| Mixin | Columns | When to use |
|---|---|---|
| `timestamps` | `created_at`, `updated_at` (auto-bumped) | All editable domain tables. |
| `actors` | `created_by_id`, `updated_by_id` (uuid → `auth.users`, `ON DELETE SET NULL`) | Editable domain tables only. **Skip** on lookup tables (`event_styles`, `customer_list_sources`, `blocked_dates`). |
| `archivable` | `archived_at` | Tables that need soft-archive (most lookups, plus `clients`, `coaches`, `contacts`). |

### `auth.uid()` does NOT populate over Drizzle

Drizzle's connection has no JWT context. Server Actions and webhooks must pass `userId` **explicitly** when writing audit columns:

```ts
await db.update(clients)
  .set({ ...patch, updatedById: session.user.id })
  .where(eq(clients.id, id));
```

A `current_setting('request.jwt.claim.sub')` trigger doesn't help here.

### Auth wiring

`auth.users` is Supabase-managed. Reference it via the shadow declared in `src/lib/db/schema/auth.ts`. Do not declare or migrate it.

**drizzle-kit gotcha:** `db:generate` emits `CREATE SCHEMA "auth"` and `CREATE TABLE "auth"."users"` despite `schemaFilter: ['public']` in `drizzle.config.ts`. **Strip those two statements** from the generated SQL before applying. The `REFERENCES "auth"."users"("id")` FK below them is correct and stays.

### Migrations

- `DATABASE_URL` for `db:migrate` must be the **direct** connection (port 5432). The pooled (6543) connection can't run DDL transactionally.
- Until a migration has been applied to a database, prefer editing the schema and regenerating over the same migration file rather than stacking rename/alter migrations on top. Once applied (anywhere), migrations are append-only.
- RLS policies, triggers, `SECURITY DEFINER` functions, and other Supabase-native concerns live as **hand-written `.sql` files** in `./drizzle/`, not from the generator.

### Rollbacks

Drizzle is forward-only. Three patterns:

- **Dev reset** (local only): `DROP SCHEMA public CASCADE; DROP TYPE event_status; DROP TYPE profile_role; CREATE SCHEMA public;` then `pnpm db:migrate`. Never against shared/prod.
- **Forward fix** (prod): if an applied migration is wrong, write the **next** migration that corrects it. Treat applied migrations as append-only history.
- **PITR** (safety net): Supabase paid plans support point-in-time recovery. Free tier gets daily full-DB backup restore.

For destructive changes, **expand → migrate → contract**: add new, backfill, switch reads, ship, then drop in a later migration once verified.

### Backfills

| Pattern | When |
|---|---|
| **SQL inside the migration** | Small tables, constant defaults, pure-SQL transforms. Locks the table — not safe past ~100k rows. |
| **TS script in `scripts/`** | Large tables, external API calls (geocoding, enrichment), restartability needed. Imports the same `db` client app code uses. The legacy import will be `scripts/import-from-sheets.ts`. |
| **Idempotent seed migration** | Known-small lookup tables (`event_styles`, `customer_list_sources`). `INSERT … ON CONFLICT DO NOTHING`. Safe on every environment. |
| **Lazy / read-side** | App code populates missing values on read; one-shot cleanup later. Use only when the table is too hot to lock. |

For `NOT NULL` on existing rows: constant default → `ADD COLUMN x text NOT NULL DEFAULT 'foo'` is one step. Per-row default → three migrations: `ADD COLUMN x` (nullable) → backfill script → `ALTER COLUMN x SET NOT NULL`.

## Git workflow

- **Commit format:** `type(scope): message` — e.g. `feat(download): add claim endpoint`. Subject line only — no body, no description, no trailers.
- **Don't commit unprompted.** No `git commit`, `git push`, or `git add` unless the user explicitly asks.
- **Don't mention Claude / AI / "Generated with" / "Co-Authored-By"** in commits.
- **Never skip hooks** (`--no-verify`) or bypass signing unless explicitly asked. If a hook fails, fix the underlying cause.

## File and folder organization

- `src/app/` — App Router routes, layouts, pages.
- `src/components/` — cross-feature UI primitives.
- `src/features/<name>/` — feature folders. `actions.ts` for Server Actions, `<name>.tsx` for client components.
- `src/lib/db/` — Drizzle client + schema.
- `src/lib/supabase/` — Supabase clients, session helper, middleware logic.
- `src/proxy.ts` — Next 16's renamed `middleware.ts`. Route gate.

See [architecture.md](architecture.md) for a complete tree.

## Documentation

- **`docs/wiki/`** — current state of the system. Edit pages in place when state changes.
- **`docs/designs/YYYY-MM-DD-slug/`** — per-chunk working notes. Append-only after the work ships.
- **`CLAUDE.md`** — schema for the wiki + project-wide agent rules. Local-only.

The full ingest/query/lint pattern for `docs/wiki/` lives in `CLAUDE.md`.
