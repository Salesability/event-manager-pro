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
| UI primitives | **Sonner** (toasts) + **Headless UI** (Dialog, Listbox/Combobox) | Sonner for the simple `toast.success(…)` API; Headless UI for accessible Tailwind-native dialog/listbox primitives. Tooltip is deferred — when needed, add Floating UI or Radix Tooltip à la carte. We tried Base UI (`@base-ui/react`) first and backed out: see [docs/designs/closed/0007-lists-crud/plan.md](../designs/closed/0007-lists-crud/plan.md) Decisions for the swap rationale (mui/base-ui#4234). |
| Package manager | **pnpm** | Strict by default, smaller `node_modules`. |
| Persistence | **Supabase Postgres 17.6** | Real DB with money-grade integrity (transactions, FKs) — required for quote/invoice/contract immutability. Also rolls in Auth + Storage. |
| ORM | **Drizzle** | Closer to SQL than Prisma; pairs well with Supabase migrations; lighter footprint. |
| Auth | **Supabase Auth** (Google OAuth + magic link) | See [auth.md](auth.md). |
| PDF generation | **`pdf-lib`** (server-rendered, code-built layout) | Picked over `@react-pdf/renderer` (2026-05-08, Phase 1 of [0026-quote-pdf](../designs/0026-quote-pdf/plan.md)). Documents are built programmatically — code is the source of truth for layout (logo, fonts, margins, text); no template-fill, no designer-uploaded PDF asset to maintain. First renderer at `src/lib/pdf/render-quote.ts`. |
| Blob storage | **Google Cloud Storage** (rendered Quote/Contract/Invoice PDFs) | Cloud Run is on GCP so workload identity in prod, optional inline `GCS_CREDENTIALS_JSON` for local dev. Picked over Supabase Storage (2026-05-08, Phase 1 of [0026-quote-pdf](../designs/0026-quote-pdf/plan.md)). Adapter at `src/lib/storage/gcs.ts`. Bucket holds rendered output only (`quotes/{id}/{rev}.pdf`, `contracts/{id}.pdf`, etc.) — branded layout lives in code. |
| Outbound mail | **Resend + React Email** | Resend wired in 5.5; first React Email template (`src/lib/email/templates/quote.tsx`) shipped 0026 Phase 4. `sendEmail` (in `src/lib/email/send.ts`) accepts optional `html` body + `attachments` (Resend `attachments` shape: `filename` / `content` / `contentType`) — passes the buffered PDF straight through. |
| Future integrations | Stripe (invoicing/payments), Dropbox Sign (e-sign) | Each lands in its own chunk per the migration order in `docs/designs/closed/0001-port-stack-analysis/notes.md`. |
| Deploy | **Cloud Run** with "allow unauthenticated invocations" | Container is publicly reachable; access control is app-side via the auth middleware. Per-coach public share links (legacy `?coach=<id>`) stay un-gated. No Google LB / IAP — keeps things portable. |

Decision rationale lives in `docs/designs/closed/0001-port-stack-analysis/notes.md` (the alternatives considered: SvelteKit + Supabase, Astro + islands, Rails/Django) and `docs/designs/closed/0002-nextjs-scaffold/decision.md` (ORM + cloud-vs-local picks).

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

### Quote composer — calculator, not a line-item picker

The Quote composer (`src/app/(app)/quotes/new/page.tsx` + `src/features/quotes/quote-composer.tsx`) is shaped as a **structured-input calculator**, not a list-picker. The coach edits a small `QuoteInputs` payload (`audienceSize`, `eventDays`, per-channel touch counts, `recordRetrievalAmount`, `travelAmount`, plus freeform `travelNotes` / `quoteNotes`); the line-item table is **computed read-only output**. The same input snapshot is persisted on the `quotes` row so the downstream Invoice (7.3) can recompute against the same inputs against the same catalog and always reconcile.

Three load-bearing pieces:

1. **Pricing module** — `src/lib/quotes/pricing.ts`. Pure function `computeQuote(inputs, catalog, taxOverride?)`. Stateless: no Date, no randomness, no DB — same inputs + catalog produce the same lines, subtotal, tax, total. Sanity caps (`MAX_AUDIENCE=1M`, `MAX_DAYS=365`, `MAX_TOUCHES=1M`, `MAX_DOLLARS=9_999_999`) live here; `validateQuoteInputs` throws `QuoteInputsError` on NaN/Infinity/negatives/non-integer counts/oversized notes. `roundCents` is the single rounding boundary. Fail-closed on `range`-unit catalog rows with null/non-finite `unit_price_min/max`.
2. **Service-item catalog** — `service_items` table (see [data-model.md](data-model.md) → `service_items`). The 8 v1 rows are seeded by `drizzle/0013_seed_service_items.sql` and edited from `/admin/lookups` (gated `lookup:edit`). The `unit` enum (`flat | per-record | per-touch | per-day | range`) discriminates how each row's qty is derived from `QuoteInputs` at compute time.
3. **Composer Server Actions** — `src/features/quotes/actions.ts`. Three composer-side setters, all gated `quote:edit` (admin || coach) and all using the guarded-UPDATE-then-classify-the-miss pattern (mirrors `cancelCampaign`):
   - `setQuoteInputs` — full-snapshot setter: parses the incoming `inputs` JSON via `parseQuoteInputs` (field-by-field canonicalization drops unknown keys), recomputes lines + subtotal + tax + total against the active catalog, and persists both the input snapshot AND the computed `lineItems` on the `quotes` row.
   - `setQuoteTax` — tax-override only: parses the override against `TAX_RE` (then `Number()`), recomputes total from existing subtotal, and writes only `tax` + `total` (lineItems untouched).
   - `setQuoteDealer` — dealer swap only: opens a transaction with `FOR UPDATE` on the candidate dealer row to close the archive-race window, then writes only `dealerId` (no recompute).

   Tax parsing on the composer setter is `TAX_RE` + `Number()`. The `quotes` row mixes precisions — `fee` / `travel` are `numeric(10,2)` (input-shape money) while `subtotal` / `tax` / `total` are `numeric(12,2)` (computed aggregates that need the wider band). The string-only `MONEY_RE` + `numeric(10,2)` discipline (and the un-archive-by-`code` behaviour, and the `MAX_PG_INTEGER`-capped `sortOrder`) belongs to the **service-item catalog actions** at `src/features/services/actions.ts`, not the composer setters.

**Send-time MSA gate (planned — 0035 Phase 4 + 0025 Phase 7.2).** Draft editing requires no MSA today. The MSA gate is the **planned** posture for Send: when 0035 Phase 4 lands, `sendQuote` will check the Client's `master_service_agreements.status='active'` row; if present, fire the standard PDF-only flow (already wired); if absent, route into the bundled MSA + first-Quote e-sig envelope (0025 Phase 7.2, Dropbox Sign, two documents). The current `sendQuote` already renders the PDF (`renderQuotePdf`), persists `pdfStorageKey` inside the atomic `draft → sent` guarded UPDATE, uploads the buffer to GCS at `quotes/{id}/1.pdf` via `putObject`, renders the React Email template + plain-text fallback, sends with `sendEmail` (PDF attached), then emits a `quote.sent` audit row carrying `{ pdfStorageKey, emailId }` — all shipped 0026 Phase 3 + Phase 4. The MSA-gate check itself remains the Phase 4 add (not yet flagged in code). See [commercial-spine.md](commercial-spine.md) for the full lifecycle and [data-model.md](data-model.md) `### quotes` for the degraded-state semantics on partial-success.

**Entry points.** Two surfaces link into the composer today: the per-row "Quote" action on `/dealerships` (hidden on archived rows, gated `quote:edit`) and the "Create Quote" button on the campaign-detail dialog inside `/calendar` — both pass `?dealerId=` (the campaign-detail variant also passes `?campaignId=`). The inline "Add new prospect" entry point inside the composer's dealer picker is **deferred** (the current Combobox primitive doesn't support an inline-add affordance cleanly); the DealerForm itself already accepts `defaultStatus='prospect'`, so wiring this up later is a small chunk. Until then, the dealer-creation path is `/dealerships` → `Add` (admin-only — coaches do not have `dealer:create`), and the composer picks up the new row with a `(prospect)` suffix on prospect dealers.

## Migration roadmap

Per `docs/designs/closed/0001-port-stack-analysis/notes.md`, work is sequenced as:

1. ✅ **App shell + auth + Postgres tables** — scaffold (`docs/designs/closed/0002-nextjs-scaffold/`), auth (`docs/designs/closed/0003-supabase-auth/`), schema (in flight, see [data-model.md](data-model.md)).
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
