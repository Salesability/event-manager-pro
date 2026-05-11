# Quote PDF + email send (7.1) — 2026-05-07

**Started:** 2026-05-07

Sub-plan 7.1 of [`../0025-quote-to-payment/plan.md`](../0025-quote-to-payment/plan.md). Stand up the Quote document end-to-end: data model on top of `campaigns`, branded PDF built programmatically with `pdf-lib`, email send via Resend, accept/decline state. Done = a coach can click "Send quote" on a campaign, the client receives a branded quote PDF + email, and clicking the accept link flips the quote to `accepted` (which becomes the trigger for 7.2 contract send).

This chunk also lays the **PDF rendering + GCS storage foundation** that 7.2 (MSA) and 7.3 (invoice PDF) reuse — so Phase 1 here is foundation work, not quote-specific. **Strategy decided 2026-05-08: code-built layout, not template-fill.** Code is the source of truth for the document look; GCS holds rendered output only.

## Progress Tracker

| Phase | Status | Commit |
|-------|--------|--------|
| 1: PDF library + GCS storage foundation (decisions + adapters) | Done | `3c4b5b9` |
| 2: Quote data model + Server Actions | Pending | - |
| 3: Quote PDF rendering (real data, real layout, persist to GCS) | Pending | - |
| 4: Quote email send + public accept/decline flow | Pending | - |
| 5: Tests + smoke verification | Pending | - |

**Overall Progress:** 20% (1/5 phases complete)

## Code Anchors

For each new file/method below, the builder reads the anchor first and matches its shape (length, error handling, naming, query style).

| New code | Anchor (`path:line`) | Why this anchor |
|----------|---------------------|-----------------|
| `src/lib/storage/gcs.ts` (new) — `putObject`, `getObject`, `signedUrl` | `src/lib/email/send.ts` | Same shape: env-pull-on-call, single-purpose adapter, no global state. 5.5's `f963da7` is the closest precedent for a third-party-integration adapter in this codebase. |
| `src/lib/pdf/render-quote.ts` (new) — code-built Quote PDF | `src/lib/email/send.ts` | Same stateless-module shape; returns a Buffer. `pdf-lib` work happens here, isolated from any feature code. |
| `src/lib/db/schema/quotes.ts` (new) | `src/lib/db/schema/campaigns.ts` | Mirror existing schema-file shape: Drizzle `pgTable`, audit columns per `db-conventions`, fk to `campaigns.id`. |
| `src/features/quotes/actions.ts` (new) — `createQuote`, `sendQuote`, `acceptQuote`, `declineQuote` | `src/features/people/actions.ts` | Mirror the `'use server'` + `requireRole(...)` + `recordAudit(...)` pattern; `useActionState`-compatible return contract. |
| `src/app/quote/[token]/route.ts` (public accept/decline) | `src/app/auth/callback/route.ts` | One of the few existing route handlers; same shape (validate input, do action, redirect to a public confirmation page). The accept link is the public surface — Server Actions stay gated to staff. |
| `src/lib/email/templates/quote.tsx` (new) | (placeholder — first React Email template; anchor on Resend docs) | First React Email component in the codebase; `src/lib/email/send.ts` is the consumer. |

**Conventions referenced:**
- `docs/wiki/conventions.md` — Drizzle ID/audit-column defaults; `db` client connection pool.
- `docs/wiki/security.md` — RLS posture; Server Actions are the gate, RLS is defence-in-depth. The public accept-link route is a *route handler*, not a Server Action — token-validated, no auth context.
- `docs/wiki/auth.md` — `requireRole(['admin', 'coach'])` is the gate for staff-side quote actions; route handlers do their own validation.
- `CLAUDE.md` — Server Actions for our-UI mutations; route handlers for external callers (which the public accept link is).

**Note:**
- Phase 1 sets stack decisions (PDF lib + storage); Phases 2–4 build on it.
- 7.2 (Contract) and 7.3 (Invoice) reuse the GCS adapter + the same code-built layout pattern (separate renderer modules per document type).
- Send-flow uses the existing Resend wiring from 5.5; this chunk adds the first React Email template.
- A single rate-limit pass on the public accept route is required before this ships (0019 follow-up — email rate-limit / replay-prevention parked from 0011).

### Phase Checklist

#### Phase 1: PDF library + GCS storage foundation
- [x] **Decision: `pdf-lib` over `@react-pdf/renderer`** (2026-05-08, confirmed). Server-rendered, programmatic layout with full control over fonts, images, and coordinates. `architecture.md` updated.
- [x] **Decision: GCS over Supabase Storage** (2026-05-08, confirmed). Cloud Run is already on GCP; uses workload identity in prod, optional `GCS_CREDENTIALS_JSON` inline JSON for local dev.
- [x] **Decision: code-built layout, not template-fill** (2026-05-08, pivoted mid-Phase-1 — earlier in the same conversation the working assumption was template-fill from GCS; user reversed it). Code is the source of truth for the document look (logo, fonts, margins, T&C text). GCS holds rendered output only at `quotes/{quoteId}/{revision}.pdf`. No designer-uploaded template asset to maintain; layout iteration is dev-side via `src/lib/pdf/render-*.ts` modules.
- [x] `pnpm add pdf-lib @google-cloud/storage server-only` — deps installed (`server-only` added so `import 'server-only'` resolves outside Next bundler context, e.g. in vitest mocks).
- [x] New `src/lib/storage/gcs.ts` — exports `putObject({bucket,key,body,contentType})`, `getObject(bucket,key)`, `signedUrl(bucket,key,ttlSeconds)`. Env-pulled credentials (`GCS_PROJECT_ID` + optional `GCS_CREDENTIALS_JSON`), cached client, soft-error `{error}` return contract mirroring `src/lib/email/send.ts`.
- [x] New `src/lib/pdf/render-quote.ts` — exports `renderQuotePdf(quote): Promise<RenderResult>`. Code-built single-page Quote layout with: `public/saledayevents-logo.jpg` embedded top-right; sender block (Salesability Canada Inc. + placeholder address — TODO-flagged in code, swap when confirmed) right-aligned under the logo in grey; QUOTE header + Quote # + Issued date on the left; Bill To block with optional multi-line `clientAddress`; Event line; line-items table with right-aligned numerics (Qty / Unit / Total) via `font.widthOfTextAtSize` measurement; totals stack with currency formatted via `Intl.NumberFormat('en-CA', {style:'currency', currency:'CAD'})` so values render as `$5,650.00`; T&C + Invoicing & Payment language (verbatim from user 2026-05-08). Phase 3 wires this to real quote data + persists output to GCS.
- [x] Env vars added to `.env.example`: `GCS_PROJECT_ID`, `GCS_BUCKET`, `GCS_CREDENTIALS_JSON`.
- [x] Smoke: 3 vitest cases in `src/lib/pdf/render-quote.test.ts` verify PDF magic header, single US-Letter page round-trip, and zero-line-item resilience. `WRITE_SMOKE_PDF=1 pnpm vitest run src/lib/pdf` writes `/tmp/quote-smoke.pdf` for visual eyeball.

**Phase 1 carry-forwards into Phase 3:**
- `getObject`/`putObject`/`signedUrl` smoke against a real GCS bucket — gated until creds are wired in `.env.local` for local dev or workload-identity for the deploy.
- Multi-page handling if line-item count grows past one US-Letter page; current renderer hard-caps at one page.
- Confirm Salesability Canada Inc. real mailing address + phone/email and replace the `SENDER` constant placeholder in `render-quote.ts`.
- Optional polish once real data shape is final: signature block, "Valid until" / expiry date next to "Issued", brand-color hairline rule under QUOTE.

#### Phase 2: Quote data model + Server Actions

> **Commercial-spine alignment (locked in [0037](../0037-commercial-spine-msa/plan.md), 2026-05-11):** Phase 2's `quotes` schema **must** carry the commercial columns moved off `campaigns` (`fee`, `travel`, `depositPct`, `taxPct`, `quoteValidDays`, `audienceSourceId`) plus `msaId`. The FK direction is **`campaigns.acceptedQuoteId` → `quotes.id`** (lives on campaigns), NOT `quotes.campaignId`. See [`docs/wiki/commercial-spine.md`](../../wiki/commercial-spine.md). 0037 Phase 4 then drops the legacy commercial columns off `campaigns` once this phase + 0035 Phase 3 are writing to the new locations.

- [ ] New schema file `src/lib/db/schema/quotes.ts`:
  - `quotes` table: `id` (uuid), `dealerId` (fk → `dealers.id`, NOT NULL — the Quote always knows its Client), `msaId` (fk → `master_service_agreements.id`, nullable until the Quote is accepted under a specific MSA term), `status` (enum `draft|sent|accepted|declined`), `acceptToken` (uuid, unique — used for the public accept/decline link), `pdfStorageKey` (nullable; populated when sent), `inputs` (jsonb — typed `QuoteInputs` snapshot; see [0035 Phase 3](../0035-quote-composer/plan.md) for the shape: `audienceSize`, `eventDays`, `bdcCallCount`, `letterCount`, `digitalCount`, `recordRetrievalAmount`, `travelAmount`, `travelNotes`, `quoteNotes`), `fee` (numeric — flat fee, cross-checked against `inputs` × catalog at edit time), `travel` (numeric — flat travel amount), `depositPct` (numeric, default `0`), `taxPct` (numeric, default `15` per NS HST seller-side — see Open Q resolution), `quoteValidDays` (integer, default `30`), `audienceSourceId` (fk → `audience_sources.id`, nullable), `subtotal`, `tax`, `total` (numeric), `lineItems` (jsonb — *computed* output snapshot derived from `inputs` × catalog at edit/send time; revisit normalization in 7.3), `previousQuoteId` (self-fk, nullable; for the revision chain), audit cols (`createdAt`, `updatedAt`, `createdBy`).
  - **No `campaignId` column on `quotes`** — the FK lives on the campaigns side as `campaigns.acceptedQuoteId` (added in this phase or 0037 Phase 3; nullable for backwards compat with pre-0037 campaigns).
  - Index on `dealerId`, `(dealerId, status)` for the "find latest quote for this dealer" query, `acceptToken`, and `msaId`.
  - Same migration adds `campaigns.acceptedQuoteId` (fk → `quotes.id`, nullable; populated when an accepted quote spawns a delivery campaign).
  - **0035 dependency:** the `inputs` column is the contract that lets the invoice (7.3) recompute totals from the same inputs against the same catalog. Don't drop it from the schema even if the v1 quote PDF doesn't read it directly.
- [ ] `pnpm db:generate` → `drizzle/0007_*.sql` (next after `0006_is_staff_member_excludes_dealer.sql`).
- [ ] Apply migration via session pooler (per `db-conventions` connection rule).
- [ ] Server Actions in `src/features/quotes/actions.ts`:
  - `createQuote(dealerId, inputs, ...)` — `capabilityClient('quote:edit')` + `recordAudit('quote.create', ...)`. Returns the new quote's id. (Argument shape adjusted post-0037: Quote attaches to a Client/dealer at creation; `campaigns.acceptedQuoteId` gets populated on accept, not at creation.)
  - `sendQuote(quoteId)` — `requireRole(...)`, render PDF (Phase 3), upload to GCS, send email (Phase 4), flip status to `sent`. Idempotent on the `sent` transition.
  - `acceptQuote(quoteId)` — internal helper; called from the public accept route on token match.
  - `declineQuote(quoteId)` — staff-side decline + public-side decline (token).
- [ ] Vitest suite for each action (parser + side-effect mocks for GCS + Resend).

#### Phase 3: Quote PDF rendering
- [ ] Wire `renderQuotePdf` into `sendQuote`: assemble `QuoteData` from the row (line items, totals, dealer info, dates), call the renderer, persist the buffer.
- [ ] Verify rendered output across line-item count edge cases (1 item, 50 items). If a quote can overflow a single page, add a multi-page path to the renderer or define a hard cap on line items.
- [ ] Persist rendered PDF at `quotes/{quoteId}/{revision}.pdf` in GCS via `putObject`; save `pdfStorageKey` on the quote row. (Revisions stay pinned — re-rendering an old quote is not a v1 concern, since the layout lives in code and a code change would change historical quotes if we re-rendered.)

#### Phase 4: Quote email send + public accept/decline flow
- [ ] React Email template at `src/lib/email/templates/quote.tsx` — branded body with quote summary + Accept-link button + Decline-link button. PDF attached.
- [ ] `sendQuote` calls the existing `src/lib/email/send.ts` helper with the rendered PDF as attachment + the React Email template as the body.
- [ ] Public route handler `src/app/quote/[token]/route.ts` — validates token, dispatches to `acceptQuote` or `declineQuote` based on action query param, redirects to a small public confirmation page.
- [ ] Public confirmation page at `src/app/quote/[token]/page.tsx` — read-only summary + "Quote accepted on YYYY-MM-DD" or equivalent.
- [ ] Audit-log emit on accept/decline with `actorRole='client'` + `actorId=null` to mark public-source actions (extend `recordAudit` if needed; document the new actor convention in `docs/wiki/auth.md`).
- [ ] Rate-limit the public token route (0019 carry-forward) — even if just an in-memory or per-IP bucket for v1.

#### Phase 5: Tests + smoke verification
- [ ] `pnpm test` — quote action tests, GCS adapter tests (mocked), PDF render smoke tests, accept/decline route handler tests.
- [ ] `pnpm tsc --noEmit` clean.
- [ ] `pnpm lint` clean.
- [ ] Dev smoke: create a real campaign → create quote → send → check inbox → click Accept link → verify status flip + audit row.
- [ ] Update `docs/wiki/architecture.md` "Future integrations" row to reflect `pdf-lib` + GCS decisions.
- [ ] Update `docs/wiki/data-model.md` with the new `quotes` table.

## Open questions

- **Line items shape:** flat jsonb on the row, or a normalized `quote_line_items` table? Normalized makes per-item editing + reporting cleaner; jsonb is faster to ship and quotes are typically immutable once sent. **Working assumption: jsonb for v1; revisit if invoicing (7.3) needs per-line reporting.**
- **Quote revisions:** if a quote is declined and a new one is sent, is it a new quote row or a new revision on the same row? **Working assumption: new row, with `previousQuoteId` self-fk for the chain.**
- **Tax calculation:** ~~confirmed via the salesability.ca/terms-conditions fetch (2026-05-08) that Salesability Canada Inc. is **Nova Scotia-based**~~ **Partially resolved 2026-05-11 (0037):** the live Salesability MSA §9 (Dartmouth, NS governing law) confirms **NS HST 15% as the seller-side default**. `quotes.taxPct` defaults to `15` in the schema. **Still open for 7.3:** the CRA "place-of-supply" question — whether on-site events should auto-compute against the buyer's province (HST varies — ON 13%, NS/NB/PE/NL 15%, GST/PST elsewhere) rather than honoring seller-side. Until 7.3 builds the auto-compute path, the per-quote `taxPct` is editable by the coach. Confirm with bookkeeping before any real send.
- **Cascade into 7.2 Contract send:** does 7.1 stop at "quote accepted, status flipped" or auto-trigger the MSA send? **Working assumption: stop at 7.1; 7.2 picks up the accepted-quote signal via its own Server Action invoked by a coach (manual gate before signing the MSA) or a DB trigger if we want fully automatic.**
- **Layout-change pinning:** if the renderer code changes (logo, fonts, layout, T&C wording) after a quote was sent, do we re-render old quotes or pin them? **Decided: pin. Store the rendered PDF in GCS; never re-render. A code change must not silently change a sent document.**
- **Quote line-item editor UI:** is editing in the booking modal, on the campaign-detail page, or in a dedicated `/admin/quotes/...` flow? **Open — pick before Phase 2.**
- **Currency:** CAD only for v1 (all dealerships are Canadian)? **Working assumption: yes; no `currency` column on `quotes`.**
