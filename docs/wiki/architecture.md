# Architecture

How the system is shaped, where things live, and which choices are load-bearing.

> Part of `docs/wiki/`. See [data-model.md](data-model.md) for schema, [auth.md](auth.md) for identity, [conventions.md](conventions.md) for cross-cutting rules.

## What this is

In-house event scheduling software for `salesability.ca`. Coaches book training events at dealership clients; the new surface area being built is the **quote → contract → invoice → payment** loop on top of the existing booking workflow.

Replaces a single-file legacy app (`deprecated/index.html`, ~2,300 lines) that used Google Sheets as its backend with a hardcoded API key. The legacy app stays in `deprecated/` for reference until cutover.

## Stack

| Layer | Pick | Why |
|---|---|---|
| Framework | **Next.js 16** (App Router, TypeScript strict) | Largest hireable talent pool, cleanest growth path for the new surface area. Server Actions remove the need for most route handlers. |
| Styling | **Tailwind CSS** | Standard. |
| UI primitives | **Sonner** (toasts) + **Headless UI** (Dialog, Listbox/Combobox) | Sonner for the simple `toast.success(…)` API; Headless UI for accessible Tailwind-native dialog/listbox primitives. Tooltip is deferred — when needed, add Floating UI or Radix Tooltip à la carte. We tried Base UI (`@base-ui/react`) first and backed out: see [docs/designs/shipped/0007-lists-crud/plan.md](../designs/shipped/0007-lists-crud/plan.md) Decisions for the swap rationale (mui/base-ui#4234). |
| Package manager | **pnpm** | Strict by default, smaller `node_modules`. |
| Persistence | **Supabase Postgres 17.6** | Real DB with money-grade integrity (transactions, FKs) — required for quote/invoice/contract immutability. Also rolls in Auth + Storage. |
| ORM | **Drizzle** | Closer to SQL than Prisma; pairs well with Supabase migrations; lighter footprint. |
| Auth | **Supabase Auth** (Google OAuth + magic link) | See [auth.md](auth.md). |
| Future integrations | Stripe (invoicing/payments), Dropbox Sign (e-sign), Resend + React Email (outbound mail), `@react-pdf/renderer` (server-rendered PDFs) | Each lands in its own chunk per the migration order in `docs/designs/shipped/0001-port-stack-analysis/notes.md`. |
| Deploy | **Cloud Run** with "allow unauthenticated invocations" | Container is publicly reachable; access control is app-side via the auth middleware. Per-coach public share links (legacy `?coach=<id>`) stay un-gated. No Google LB / IAP — keeps things portable. |

Decision rationale lives in `docs/designs/shipped/0001-port-stack-analysis/notes.md` (the alternatives considered: SvelteKit + Supabase, Astro + islands, Rails/Django) and `docs/designs/shipped/0002-nextjs-scaffold/decision.md` (ORM + cloud-vs-local picks).

## Folder layout

```
src/
├── app/                       # Next.js App Router (routes, layouts, pages)
│   ├── auth/
│   │   ├── callback/route.ts  # OAuth + magic-link code exchange
│   │   └── auth-error/page.tsx
│   ├── login/page.tsx
│   ├── layout.tsx             # renders <SessionBanner />
│   └── page.tsx
├── components/                # cross-feature UI primitives
│   └── auth/session-banner.tsx
├── features/<name>/           # one folder per feature
│   ├── actions.ts             # 'use server' Server Actions
│   └── <name>.tsx             # client / server components
├── lib/
│   ├── db/
│   │   ├── index.ts           # Drizzle client over postgres driver
│   │   └── schema/            # one file per table — see data-model.md
│   └── supabase/
│       ├── client.ts          # browser Supabase client
│       ├── server.ts          # server (cookies-aware) Supabase client
│       ├── session.ts         # getUser() helper
│       └── middleware.ts      # session refresh logic
└── proxy.ts                   # Next 16's renamed middleware.ts — route gate
```

Top-level:
- `drizzle/` — generated SQL migrations (and hand-written ones for triggers/RLS).
- `drizzle.config.ts` — points at `src/lib/db/schema` and `DATABASE_URL`.
- `docs/wiki/` — this folder. Persistent reference docs.
- `docs/designs/` — per-chunk working notes (date-prefixed).
- `deprecated/` — legacy app. Local-only, gitignored.

## Patterns

### Server Actions for mutations, route handlers for external callers

Anything triggered by **our own UI** is a Server Action (`'use server'`). Route handlers (`src/app/**/route.ts`) are for **external callers only** — webhooks, OAuth callbacks (`/auth/callback`), public APIs.

This is enforced by convention, not code. When in doubt: if the caller is a Stripe webhook, Dropbox Sign callback, or another server, use a route handler. Otherwise, Server Action.

### Feature folders

Each substantive feature gets `src/features/<feature-name>/` with `actions.ts` (Server Actions) and any feature-local components. Cross-feature primitives live in `src/components/`. The placeholder `ping/` folder under `features/` exists only as the example wiring for the scaffold; delete once a real feature lands there.

### Drizzle vs supabase-js

- **Drizzle** for server SQL — Server Actions, webhook handlers, scripts, transactions. No RLS context.
- **`supabase-js`** (via `@supabase/ssr`) for auth, session reads, RLS-bound queries, future realtime.
- Don't query the same table through both at one call site. Pick one.

See [conventions.md](conventions.md) for the full rule set.

## Migration roadmap

Per `docs/designs/shipped/0001-port-stack-analysis/notes.md`, work is sequenced as:

1. ✅ **App shell + auth + Postgres tables** — scaffold (`docs/designs/shipped/0002-nextjs-scaffold/`), auth (`docs/designs/shipped/0003-supabase-auth/`), schema (in flight, see [data-model.md](data-model.md)).
2. **One-time Sheets → Postgres import** — TS script reading legacy ranges via existing API key, fanning out into `clients` + `contacts` etc.
3. **Port the three views** — lists, production, calendar (calendar last; reuse the legacy ribbon-packing algorithm).
4. **Cutover** — point `events.salesability.ca` at the new deploy; Sheets becomes read-only archive.
5. **New surface** — Quote (PDF + email) → Contract (Dropbox Sign send + webhook → store signed PDF) → Invoice (Stripe Invoice from quote) → Payment-received webhook flips event to "Paid."
6. **Rotate compromised secrets** — `API_KEY`, `HELLOSIGN_API_KEY`; lock the legacy spreadsheet.

## What's deliberately out of scope (for now)

- No AI / chat UI — was in the original Claude prompt for the scaffold; ruled out as copy-paste, not a real requirement.
- No Stripe / Dropbox Sign / Resend until their respective chunks land.
- No RBAC beyond logged-in vs not — middleware gates routes uniformly. Per-route role checks come with the user-table chunk.
- No password auth, no auto-provisioning on Google OAuth — see [auth.md](auth.md).

## Compromised legacy secrets

The legacy `deprecated/index.html` shipped with public credentials: `API_KEY` (Google Sheets), `HELLOSIGN_API_KEY` (Dropbox Sign, valid + unused), plaintext passwords in `Users!A:E`. These must be rotated regardless of port path. Tracked as the final step of migration cutover. Until then, treat the legacy spreadsheet as a known-leaky resource.
