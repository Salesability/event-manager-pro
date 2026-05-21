# Decisions made during the scaffold — 2026-04-29

## ORM: Drizzle (over Prisma or raw client)

Considered: Drizzle, Prisma, raw `@supabase/supabase-js` client.

Picked **Drizzle** because:
- Closer to SQL — invoicing/quote lineage will need real joins and transactions, and Drizzle queries read like SQL.
- Lighter than Prisma (no separate engine binary, no `prisma generate` step in CI).
- Plays cleanly with Supabase: Drizzle owns the schema + migrations, Supabase owns the runtime + Auth + Storage + RLS.
- Raw Supabase client stays available for simple CRUD where Drizzle would be overkill — it's not either/or.

Tradeoff: smaller community than Prisma, fewer "just google the error" moments. Acceptable.

## Local DB: cloud Supabase project for now

Considered: Supabase CLI + Docker (`supabase start`) vs. hitting the cloud project directly.

Picked **cloud-only** for the scaffold step because there's no schema yet — nothing to develop locally. Will revisit when the table-creation chunk starts; at that point `supabase start` + `db push` becomes worth the Docker dependency.

## Package manager: pnpm

Picked **pnpm** over npm because:
- Faster, smaller `node_modules` (matters less for a solo project, but no reason not to).
- Strict by default — won't silently resolve unlisted transitive deps, which catches real bugs.

Installed globally via `npm install -g pnpm` (works cleanly with nvm).

## .vscode/launch.json is committed

`.gitignore` ignores `.vscode/` wholesale; we add an exception for `launch.json` only. User-specific settings stay ignored, project-shared debug config is shared.

## What was considered and rejected

- **Firebase for persistence** — raised mid-scaffold, rejected for the same reasons as the port-stack doc (document store fights joins/transactions/lineage required by invoicing).
- **AI SDK + chat UI** — in the original Claude prompt, confirmed as a copy-paste error and dropped.
