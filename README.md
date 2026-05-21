# event-manager-pro

In House Event Schedule Software.

## Stack

Next.js 16 (App Router) · TypeScript · Tailwind CSS · Server Actions · Supabase (Postgres + Auth + Storage) · Drizzle ORM · pnpm.

See `docs/chunks/2026-04-29-port-stack-analysis/notes.md` for the rationale and migration plan.

## Setup

Requires Node 20+ and pnpm 10+.

```bash
pnpm install
cp .env.example .env.local   # then fill in your Supabase project values
pnpm dev                     # http://localhost:3000
```

## Scripts

| Command | What it does |
|---|---|
| `pnpm dev` | Run the dev server (Turbopack). |
| `pnpm build` | Production build. |
| `pnpm start` | Serve the production build. |
| `pnpm lint` | ESLint. |
| `pnpm exec tsc --noEmit` | Type-check without emitting. |

## Layout

```
src/
├── app/                 # Next.js App Router
├── components/          # cross-feature UI primitives
├── features/<name>/     # feature folders (server actions + components)
└── lib/
    ├── db/              # Drizzle client + schema
    └── supabase/        # Supabase server + browser clients
```

## Docs

Per-chunk working notes live under `docs/chunks/YYYY-MM-DD-kebab-slug/`; persistent reference docs live under `docs/wiki/`. See `CLAUDE.md` (local-only) for agent guidance.
