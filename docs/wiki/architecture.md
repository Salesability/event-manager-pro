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
| UI primitives | **Sonner** (toasts) + **Headless UI** (Dialog, Listbox/Combobox) | Sonner for the simple `toast.success(…)` API; Headless UI for accessible Tailwind-native dialog/listbox primitives. Tooltip is deferred — when needed, add Floating UI or Radix Tooltip à la carte. We tried Base UI (`@base-ui/react`) first and backed out: see [docs/chunks/closed/0007-lists-crud/plan.md](../chunks/closed/0007-lists-crud/plan.md) Decisions for the swap rationale (mui/base-ui#4234). |
| Package manager | **pnpm** | Strict by default, smaller `node_modules`. |
| Persistence | **Supabase Postgres 17.6** | Real DB with money-grade integrity (transactions, FKs) — required for quote/invoice/contract immutability. Also rolls in Auth + Storage. |
| ORM | **Drizzle** | Closer to SQL than Prisma; pairs well with Supabase migrations; lighter footprint. |
| Auth | **Supabase Auth** (Google OAuth + magic link) | See [auth.md](auth.md). |
| PDF generation | **`pdf-lib`** (server-rendered, code-built layout) | Picked over `@react-pdf/renderer` (2026-05-08, Phase 1 of [0026-quote-pdf](../chunks/closed/0026-quote-pdf/plan.md)). Documents are built programmatically — code is the source of truth for layout (logo, fonts, margins, text); no template-fill, no designer-uploaded PDF asset to maintain. First renderer at `src/lib/pdf/render-quote.ts`. |
| Blob storage | **Google Cloud Storage** (rendered Quote/Contract/Invoice PDFs) | Cloud Run is on GCP so workload identity in prod, optional inline `GCS_CREDENTIALS_JSON` for local dev. Picked over Supabase Storage (2026-05-08, Phase 1 of [0026-quote-pdf](../chunks/closed/0026-quote-pdf/plan.md)). Adapter at `src/lib/storage/gcs.ts`. Bucket holds rendered output only (`quotes/{id}/{rev}.pdf`, `contracts/{id}.pdf`, etc.) — branded layout lives in code. |
| Outbound mail | **Resend + React Email** | Resend wired in 5.5; first React Email template (`src/lib/email/templates/quote.tsx`) shipped 0026 Phase 4. `sendEmail` (in `src/lib/email/send.ts`) accepts optional `html` body + `attachments` (Resend `attachments` shape: `filename` / `content` / `contentType`) — passes the buffered PDF straight through. |
| E-signature | **BoldSign** (`boldsign` SDK, `DocumentApi`) | Bundled MSA + first-Quote envelopes (inline-uploaded PDFs; no provider-side template — MSA prose lives in `src/lib/pdf/render-msa.ts`). Sandbox vs production via `APP_ENV` (basePath swap). Webhook at `/api/boldsign/webhook` with `X-BoldSign-Signature` HMAC-SHA256 over `t + "." + body`. Migrated from Dropbox Sign in 0051. See [commercial-spine.md](commercial-spine.md) for the lifecycle. |
| Future integrations | Stripe (invoicing/payments) | Each lands in its own chunk per the migration order in `docs/chunks/closed/0001-port-stack-analysis/notes.md`. |
| Deploy | **Cloud Run** with "allow unauthenticated invocations" | Container is publicly reachable; access control is app-side via the auth middleware. Per-coach public share links (legacy `?coach=<id>`) stay un-gated. No Google LB / IAP — keeps things portable. |

Decision rationale lives in `docs/chunks/closed/0001-port-stack-analysis/notes.md` (the alternatives considered: SvelteKit + Supabase, Astro + islands, Rails/Django) and `docs/chunks/closed/0002-nextjs-scaffold/decision.md` (ORM + cloud-vs-local picks).

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
- `docs/chunks/` — per-chunk working notes (date-prefixed).
- `deprecated/` — legacy app. Local-only, gitignored.

## Patterns

### Server Actions for mutations, route handlers for external callers

Anything triggered by **our own UI** is a Server Action (`'use server'`). Route handlers (`src/app/**/route.ts`) are for **external callers only** — webhooks, OAuth callbacks (`/auth/callback`), public APIs.

This is enforced by convention, not code. When in doubt: if the caller is a Stripe webhook, BoldSign callback, or another server, use a route handler. Otherwise, Server Action.

### Feature folders

Each substantive feature gets `src/features/<feature-name>/` with `actions.ts` (Server Actions) and any feature-local components. Cross-feature primitives live in `src/components/`. The placeholder `ping/` folder under `features/` exists only as the example wiring for the scaffold; delete once a real feature lands there.

### Drizzle vs supabase-js

- **Drizzle** for server SQL — Server Actions, webhook handlers, scripts, transactions. No RLS context.
- **`supabase-js`** (via `@supabase/ssr`) for auth, session reads, RLS-bound queries, future realtime.
- Don't query the same table through both at one call site. Pick one.

See [conventions.md](conventions.md) for the full rule set.

### Quote composer — SKU line-item picker (0062)

The Quote composer (`src/app/(app)/quotes/new/page.tsx` + `src/features/quotes/quote-composer.tsx`) is a **SKU line-item picker**. The coach adds lines by picking services from the `service_items` catalogue; each line carries a quantity and a price (catalogue-seeded, editable per quote). The picked lines are the source of truth — they persist as `quote_line_items` rows, render on the PDF, and roll up to subtotal/tax/total. The accepted quote's stored rows *are* the contract (invoicing later sums them; no recompute-from-inputs).

> **History.** Through 0035–0061 this was a parametric **calculator**: the coach edited a structured `QuoteInputs` payload (audience size, days, per-channel counts) and `computeQuote()` auto-derived the line items from 8 hardcoded catalogue codes. 0062 reversed that (owner: *"the preloaded is too complicated and buggy"* — a SKU the owner added in `services-admin` could never appear on a quote). The `quotes.line_items` jsonb column was dropped and `computeQuote()` deleted.

Load-bearing pieces:

1. **Pricing module** — `src/lib/quotes/pricing.ts`. Pure: `computePickedTotals(lines, { ratePct })` (= `effectiveUnit(line) × qty` summed + auto province-rate tax — 0080 removed the manual `override`) + `validatePickedLines` + `effectiveUnit(line) = overrideUnitPrice ?? unitPrice`. `MAX_DOLLARS=9_999_999`, `MAX_QTY=1M`; `roundCents` is the single rounding boundary.
2. **SKU catalogue** — `service_items` table (see [data-model.md](data-model.md) → `service_items`). Owner-maintained from `services-admin` (gated `lookup:edit`); any SKU added (label + description + seed `unit_price`) appears in the picker.
3. **Composer Server Actions** — `src/features/quotes/actions.ts`, gated `quote:edit`:
   - `setQuoteInputs` / `createQuote` — accept the composer's `lines` payload (picked SKUs + qty + price), resolve each against the catalogue (snapshotting code/label/description/unit_price + deriving the override), recompute totals, and **delete-and-insert** the `quote_line_items` rows inside a guarded UPDATE (optimistic-lock on `updatedAt`); `quoteNotes` merges onto the preserved `inputs` bag.
   - `setQuoteDealer` — dealer-swap setter; re-derives the auto province-rate tax for the new dealer. (0080 retired `setQuoteTax` — tax is no longer manually overridable; the field is display-only.)
4. **Render lines** — `src/lib/quotes/render-lines.ts`. `renderLinesColumn` (a correlated `jsonb_agg` subquery over `quote_line_items`) lets `sendQuote` / `previewQuotePdf` / `sendMsaEnvelope` read the lines inline on their existing quote `select`; `mapRenderLines` maps to the PDF shape (label → line, catalogue description → sub-line, `effectiveUnit` → price).

**Send-time MSA gate (planned — 0035 Phase 4 + 0025 Phase 7.2).** Draft editing requires no MSA today. The MSA gate is the **planned** posture for Send: when 0035 Phase 4 lands, `sendQuote` will check the Client's `master_service_agreements.status='active'` row; if present, fire the standard PDF-only flow (already wired); if absent, route into the bundled MSA + first-Quote e-sig envelope (0025 Phase 7.2, BoldSign envelope, two documents). The current `sendQuote` already renders the PDF (`renderQuotePdf`), persists `pdfStorageKey` inside the atomic `draft → sent` guarded UPDATE, uploads the buffer to GCS at `quotes/{id}/1.pdf` via `putObject`, renders the React Email template + plain-text fallback, sends with `sendEmail` (PDF attached), then emits a `quote.sent` audit row carrying `{ pdfStorageKey, emailId }` — all shipped 0026 Phase 3 + Phase 4. The MSA-gate check itself remains the Phase 4 add (not yet flagged in code). See [commercial-spine.md](commercial-spine.md) for the full lifecycle and [data-model.md](data-model.md) `### quotes` for the degraded-state semantics on partial-success.

**Entry points.** Two surfaces link into the composer today: the per-row "Quote" action on `/dealerships` (hidden on archived rows, gated `quote:edit`) and the "Create Quote" button on the campaign-detail dialog inside `/calendar` — both pass `?dealerId=` (the campaign-detail variant also passes `?campaignId=`). The inline "Add new prospect" entry point inside the composer's dealer picker is **deferred** (the current Combobox primitive doesn't support an inline-add affordance cleanly); the DealerForm itself already accepts `defaultStatus='prospect'`, so wiring this up later is a small chunk. Until then, the dealer-creation path is `/dealerships` → `Add` (admin-only — coaches do not have `dealer:create`), and the composer picks up the new row with a `(prospect)` suffix on prospect dealers.

## Migration roadmap

Per `docs/chunks/closed/0001-port-stack-analysis/notes.md`, work is sequenced as:

1. ✅ **App shell + auth + Postgres tables** — scaffold (`docs/chunks/closed/0002-nextjs-scaffold/`), auth (`docs/chunks/closed/0003-supabase-auth/`), schema (in flight, see [data-model.md](data-model.md)).
2. **One-time Sheets → Postgres import** — TS script reading legacy ranges via existing API key, fanning out into `clients` + `contacts` etc.
3. **Port the three views** — lists, production, calendar (calendar last; reuse the legacy ribbon-packing algorithm).
4. **Cutover** — point `eventpro.salesability.ca` at the new deploy; Sheets becomes read-only archive.
5. **New surface** — Quote (PDF + email) → Contract (BoldSign send + webhook → store signed PDF) → Invoice (Stripe Invoice from quote) → Payment-received webhook flips event to "Paid."
6. **Rotate compromised secrets** — `API_KEY`, `HELLOSIGN_API_KEY`; lock the legacy spreadsheet.

## What's deliberately out of scope (for now)

- No AI / chat UI — was in the original Claude prompt for the scaffold; ruled out as copy-paste, not a real requirement.
- No Stripe until its chunk lands. (Resend shipped in 0026 Phase 4; BoldSign shipped in 0041 + 0051.)
- No RBAC beyond logged-in vs not — middleware gates routes uniformly. Per-route role checks come with the user-table chunk.
- No password auth, no auto-provisioning on Google OAuth — see [auth.md](auth.md).

## Compromised legacy secrets

The legacy `deprecated/index.html` shipped with public credentials: `API_KEY` (Google Sheets), `HELLOSIGN_API_KEY` (Dropbox Sign, valid + unused), plaintext passwords in `Users!A:E`. These must be rotated regardless of port path. Tracked as the final step of migration cutover. Until then, treat the legacy spreadsheet as a known-leaky resource.
