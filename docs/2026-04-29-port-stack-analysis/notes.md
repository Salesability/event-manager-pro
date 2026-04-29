# Port stack analysis — 2026-04-29

## Why this work exists

The current app is a single 2,311-line `index.html` (now in `deprecated/`) deployed to Netlify at https://events.salesability.ca/. It uses Google Sheets as its only backend, called directly from the browser with a hardcoded API key. The roadmap is to extend the app into the rest of the sale process — quote generation, e-sign contract, invoice, payment — which the current architecture cannot support.

## What the legacy app actually is

- **One file.** Inline `<style>` (~lines 8–207), markup (~209–605), one inline `<script>` (~606–2309). No build step, no framework, no package manager.
- **State.** Single global `state` object; per-browser config (`eventStyles`, `dataSources`, `blockedDates`) in `localStorage`; logged-in user in `sessionStorage`.
- **Backend.** Google Sheets v4 REST API, browser-direct. `sheetRead` / `sheetWrite` / `appendRow` / `updateSheetRow` / `deleteSheetRow` (legacy lines 786–867).
- **Auth.** `Users!A:E` sheet, plaintext passwords, role check client-side only.
- **Email.** `mailto:` links only — no real outbound mail.
- **Pricing data already shaped.** `Events` row carries `fee`, `deposit %`, `tax %`, `quoteValid`, `travel`, `quoteNotes`, but no quote/contract/invoice UI or PDF generation exists.
- **Calendar.** Custom month grid + ribbon overlay with per-row slot packing for overlapping coaches (`renderCalendar`, `drawRibbons`). The only nontrivial piece — port the algorithm verbatim.
- **Sharing.** `?coach=<id>` URL filter for read-only per-coach views.

## What's exposed (already public on the live site)

| Secret | Status |
|---|---|
| `API_KEY` (Google Sheets) | Live, used for every read/write. Sheet must be world-writable for this to work. |
| `CLIENT_ID` (OAuth) | Public by design — low concern but still tied to your project. |
| `SPREADSHEET_ID` | Combined with the API key = full data access. |
| `HELLOSIGN_API_KEY` | Valid Dropbox Sign key. Unused in code but would let anyone send signature requests / pull signed docs / rack up charges. |
| Plaintext passwords in `Users!A:E` | One `GET` returns every credential. |

CLAUDE.md (now cleared) explicitly called these compromised. They must be rotated regardless of the port path.

## Why the new requirements force a rewrite

A "quote → sign → invoice → payment" loop demands three things Sheets-from-the-browser cannot provide:

1. **Server-side secrets and webhooks.** Stripe and Dropbox Sign / DocuSign require a server to hold the API key and receive `signature_request.signed`, `invoice.paid`, etc.
2. **A real database with money-grade integrity.** Transactions, foreign keys, immutable history (quote v1 → v2 → signed → invoiced) for legal/CRA reasons. Sheets has none of these.
3. **PDF generation + file storage.** Server-rendered quotes/MSAs/invoices, attached to outbound email, signed copies archived from the e-sign provider.

## Stacks considered

### #1 Next.js (App Router, TypeScript) + Postgres + Stripe + Dropbox Sign + Resend — **chosen**

Collapses the whole roadmap into one repo and one deploy. Auth.js or Clerk for hashed passwords + sessions. Postgres on Supabase or Neon, Drizzle or Prisma for schema. `@react-pdf/renderer` server-side for PDFs. Stripe Invoicing handles deposit %, tax, hosted payment, dunning out of the box. Resend + React Email replaces the `mailto:` shim. Stays on Netlify (full Next.js support) or moves to Vercel — same custom domain. Calendar slot-packing ports as a client component.

Tradeoff: more boilerplate than #2 (route handlers, server actions, migrations). Wins: largest hireable talent pool, most docs, cleanest growth path.

### #2 SvelteKit + Supabase + Stripe + Dropbox Sign + Resend

Smaller, faster to learn, less boilerplate; closer in feel to the existing plain-JS code. Supabase rolls Postgres + Auth + Storage + RLS into one product, removing glue. Probably lowest total LOC.

Tradeoff: smaller ecosystem, fewer off-the-shelf components for things like complex tables/calendars.

### #3 Astro + server islands

Lift-and-shift friendly — keep the static shell, add islands and server endpoints only where needed. Easiest port.

Tradeoff: less batteries-included for new surface area (auth, billing) — every piece is a separate decision.

### #4 Rails or Django

Best fit for invoicing/contracts territory — Active Record + ActionMailer + Pay + Devise all "just work."

Tradeoff: two languages, heavier ops, doesn't reuse current JS, slowest first-version solo.

### Skipped

- **Sheets + Netlify Functions.** Buys time but doesn't fix data integrity; will re-port within a year.
- **Firebase.** Firestore fights invoicing/quotes (which want SQL joins and transactions).

## Decision

Going with **#1 — Next.js + Postgres (Supabase) + Stripe + Dropbox Sign + Resend.**

If we later optimize for minimum LOC over ecosystem size, fall back to #2.

## Migration order

1. Stand up new app shell + auth + Postgres with empty Events/Clients/Coaches/Users tables matching today's columns. No UI yet.
2. One-time import from Sheets → Postgres (script that calls existing `sheetRead` ranges).
3. Port the three views: lists, production, calendar (calendar last — most code; reuse ribbon-packing).
4. Cut over by pointing `events.salesability.ca` at the new deploy. Sheets becomes read-only archive.
5. Build the new surface: Quote (PDF + email) → Contract (Dropbox Sign send + webhook → store signed PDF) → Invoice (Stripe Invoice from the quote) → Payment-received webhook flips event to "Paid."
6. Rotate `API_KEY` + `HELLOSIGN_API_KEY`; lock the spreadsheet down.

## Repo conventions decided alongside this

- `deprecated/` — local-only legacy code (gitignored). `index.html` lives here now.
- `.gitignore` — covers `deprecated/`, `.env*`, `node_modules`, build outputs, OS noise.
- `docs/YYYY-MM-DD-kebab-slug/` — folder per chunk of work. Dates not numbers; solo dev, no PRs. Use start-date; same-day collisions get an `a`/`b` suffix.
- No separate `docs/adr/`. If a folder contains a genuine architecture decision, write it as `decision.md` inside that folder.
- `CLAUDE.md` — currently empty. Will be rewritten to describe the new stack once scaffolded.
