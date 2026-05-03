# Next.js scaffold — 2026-04-29

The **app shell** half of step 1 in `../0001-port-stack-analysis/notes.md` ("Stand up new app shell + auth + Postgres with empty Events/Clients/Coaches/Users tables..."). Auth wiring and table creation are separate chunks. Done when `pnpm lint`, `pnpm exec tsc --noEmit`, and `pnpm build` all pass on a fresh clone (stub env vars are fine for build), and `pnpm dev` renders the `<Ping />` example at `/`.

## Progress Tracker

| Phase | Status | Commit |
|-------|--------|--------|
| 1: Base scaffold (create-next-app + reconcile .gitignore / README) | Complete | - |
| 2: Supabase + Drizzle wiring | Complete | - |
| 3: Env files + VS Code launch + example feature | Complete | - |
| 4: Verification (lint, typecheck, build) | Complete | - |

**Overall Progress:** 100% (4/4 phases complete)

**Note:**
- Each phase includes both implementation and verification.
- "Integration tests" doesn't apply yet — no DB schema or real features. Phase 4 is a static-checks gate (lint, tsc, build) instead.

### Phase Checklist

#### Phase 1: Base scaffold
- [x] Run `pnpm create next-app` into temp dir with TS strict, Tailwind, ESLint, App Router, src/, import alias `@/*`, pnpm, turbopack
- [x] Merge into repo root without overwriting `CLAUDE.md`, `README.md`, `designs/`, `deprecated/`
- [x] Reconcile `.gitignore` (preserve `deprecated/`, `.env*`, add Next-specific entries if missing)
- [x] Extend `README.md` with setup steps (don't replace)

#### Phase 2: Supabase + Drizzle wiring
- [x] Add deps: `@supabase/supabase-js`, `@supabase/ssr`, `drizzle-orm`, `postgres`
- [x] Add devDeps: `drizzle-kit`
- [x] `src/lib/supabase/server.ts` — cookies-aware server client
- [x] `src/lib/supabase/client.ts` — browser client
- [x] `src/lib/db/index.ts` — Drizzle client over `postgres` driver
- [x] `src/lib/db/schema/` — empty placeholder dir (table chunk fills it)
- [x] `drizzle.config.ts` — points at `src/lib/db/schema` and `DATABASE_URL`

#### Phase 3: Env + debug + example feature
- [x] `.env.example` with `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL`
- [x] Empty `.env.local` (gitignored)
- [x] `.gitignore` exception for `.vscode/launch.json`
- [x] `.vscode/launch.json` — Next.js debug (server + client compounds)
- [x] `src/features/ping/actions.ts` — `'use server'` action returning a timestamp
- [x] `src/features/ping/ping.tsx` — client component calling the action
- [x] Wire `<Ping />` into `src/app/page.tsx`

#### Phase 4: Verification
- [x] `pnpm lint` passes
- [x] `pnpm exec tsc --noEmit` passes
- [x] `pnpm build` passes with stub env vars
- [x] `pnpm dev` starts and `/` renders the ping example

## Picks

| Concern | Pick | Why |
|---|---|---|
| Framework | Next.js 15 + App Router | Per port-stack decision (#1). |
| Language | TypeScript, `strict: true` | Standard. |
| Styling | Tailwind CSS | Per port-stack decision. |
| Backend pattern | Server Actions | Per port-stack decision. |
| Package manager | pnpm | Smaller node_modules, strict by default. |
| Persistence | Supabase (Postgres) | Per port-stack decision. |
| ORM | Drizzle | Closer to SQL than Prisma; pairs well with Supabase migrations; lighter footprint. |
| Local DB dev | Cloud project for now; defer Supabase CLI / Docker until schema work begins. |
| Auth | Deferred to next chunk. |

## What this scaffold deliberately does NOT include

- No DB schema, no migrations — just the Drizzle client wired up with empty config.
- No auth (Supabase Auth comes with the table chunk).
- No Stripe / Dropbox Sign / Resend — each gets its own chunk per the port doc's migration order.
- No AI / chat UI — was in the original Claude prompt, ruled out as a copy-paste.

## Seams left for later chunks

- `src/lib/supabase/{server,client}.ts` — clients exist, just no tables to call yet.
- `src/lib/db/index.ts` — Drizzle client + empty `schema/` directory.
- `.env.example` — slots for `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL` (Drizzle).
- `src/features/<feature>/` folder pattern — `ping` is the placeholder example, delete once a real feature lands.

## File layout target

```
event-manager-pro/
├── .env.example
├── .env.local                       # gitignored
├── .vscode/launch.json              # gitignore exception
├── drizzle.config.ts
├── next.config.ts
├── package.json
├── tsconfig.json
├── src/
│   ├── app/
│   │   ├── layout.tsx
│   │   └── page.tsx                 # renders <Ping />
│   ├── components/                  # cross-feature UI primitives (empty for now)
│   ├── features/
│   │   └── ping/
│   │       ├── actions.ts           # 'use server' server action
│   │       └── ping.tsx             # client component calling the action
│   └── lib/
│       ├── db/
│       │   ├── index.ts             # drizzle(postgres(...))
│       │   └── schema/              # empty
│       └── supabase/
│           ├── client.ts            # browser client
│           └── server.ts            # server client (cookies-aware)
└── designs/
    └── 0002-nextjs-scaffold/
        ├── plan.md                  # this file
        └── decision.md              # ORM + cloud-vs-local picks
```
