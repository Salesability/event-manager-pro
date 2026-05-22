# Commercial spine

Reference for how a deal flows through the system: **Client → MSA → Quote → Event/Campaign → Invoice → Payment**. Anchors the legal layer (master agreement + per-deal contract) to the operational layer (the delivery campaign). Locked in 0037 (2026-05-11; shipped 2026-05-12); see [`docs/chunks/closed/0037-commercial-spine-msa/plan.md`](../chunks/closed/0037-commercial-spine-msa/plan.md) for the design history.

> Part of `docs/wiki/`. See [`docs/wiki/index.md`](index.md) for the full catalog and [`docs/wiki/log.md`](log.md) for the maintenance log. Per-chunk working notes (plans, decisions, research) live in `docs/chunks/NNNN-slug/`.

> Source-of-truth contract document: the Salesability *Master Service Agreement* template (user-supplied 2026-05-11). Key clauses cited inline below: **§1.ii** (one or more Quotes per term), **§1.iii** (accepted Quote = the contract), **§2.i** (12-month term), **§2.ii** (30-day termination notice), **§2.iii** (50% cancellation fee within 21 days of Event start), **§3.i** (deposit), **§9** (NS governing law).

## TL;DR

- **The accepted Quote IS the contract for a project.** No separate `orders` table — that abstraction would duplicate what §1.iii already establishes legally.
- **The MSA is per-Client, 12-month, signed once.** All Quotes during that term hang off the same MSA. Renewal is manual in v1.
- **Campaigns are demoted to operational delivery.** They model the Event being run for the dealer (dates, format, coach, day-of contacts) — *not* the commercial terms. Those move onto the Quote.
- **First deal bundles MSA + first Quote into one e-sig envelope.** After that, subsequent Quotes under the same active MSA accept via the staff `acceptQuote` Server Action (coach phones / replies-to-email with the Client, then flips the row — no re-signing the MSA). The originally-planned tokenised public accept link was dropped in 0026 Phase 4 (2026-05-12) after Codex flagged that corporate email security scanners auto-prefetch URLs and would silently accept Quotes on the recipient's behalf; `quotes.accept_token` stays on the schema for forward-compat with a future v2 POST-only confirmation-page button.

## Entities

| Entity | Maps to | Lifecycle | Notes |
|--------|---------|-----------|-------|
| **Client** | `dealers` table | Persistent — once a Client, always a Client (archivable) | Schema-level still named `dealers` for legacy reasons; STAR vocab calls this *Dealer Profile* (BC 1). The MSA is signed at the Client level, not per-Quote. |
| **MSA** | `master_service_agreements` (added in 0037 Phase 2) | `pending → active → expired \| terminated` | 12-month term per §2.i. One row per signed agreement; renewals create new rows (don't mutate). Tracks `signedAt`, `expiresAt`, `signedPdfStorageKey`, `providerDocumentId`, `templateVersion`, termination dates. |
| **Quote** | `quotes` (built in 0026 Phase 2) | `draft → sent → accepted \| declined` | Built per-project. Carries the commercial terms (`fee`, `travel`, `depositPct`, `taxPct`, `quoteValidDays`, `audienceSourceId`) + a structured `inputs` jsonb that the invoice recomputes against. Joins to its MSA via `quotes.msaId`. Default validity = 30 days (overridable per quote). |
| **Event / Campaign** | `campaigns` table | `draft → booked → cancelled \| completed` | The delivery work — what gets scheduled on the calendar, who coaches, day-of contacts, channels used. After 0037 ships, `campaigns.acceptedQuoteId` (nullable) links back to the Quote that spawned it. Pre-0037 campaigns without a quote stay valid (the column is nullable). |
| **Invoice** | (built in 0025 Phase 7.3) | Stripe-managed | One per accepted Quote. Issued at acceptance; the deposit collects per §3.i. Recomputes against `quotes.inputs` so totals can't drift from what was accepted. |
| **Payment** | (built in 0025 Phase 7.4) | Stripe webhook flips `campaigns.status` | Webhook-driven. When Stripe reports the invoice paid, the campaign flips to `booked` (or whatever status the loop's payment phase lands on). |

### Why no `orders` table

Adding an `Order` between Quote and Campaign would duplicate what MSA §1.iii already establishes legally:

> *"Each Quote issued by Salesability and accepted by the Client shall constitute a separate distinct and independent agreement and contractual obligation of the Parties hereto."* (MSA §1.iii)

The accepted Quote *is* the binding agreement. There's no business event between "Quote accepted" and "Campaign booked" that an `Order` would model — the legal handoff is the signed/clicked accept, and the operational handoff is the FK link `campaigns.acceptedQuoteId`. An intermediate entity would be vestigial.

## Lifecycle — happy path

```
   Lead (in-app entry today; web intake = v2 — see 0016)
     │
     ▼  composer (0035) — coach builds Quote with audience inputs + pricing
   Quote.draft  (composer fully editable; setQuoteInputs accepts saves)
     │
     ▼  Send (0035 Phase 4)
   Quote.sent  (composer still editable — 0046; Re-send Quote replaces
                the recipient's copy + resets sent_at + emits a fresh
                quote.sent audit row) ── PDF email to Client; Client phones/replies ──┐
                                                                │
       ┌────────────────────────────────────────────────────────┘
       │
       ▼  Coach runs staff `acceptQuote` Server Action (v1; no public surface)
   MSA exists?
     │
     ├── YES (active MSA on Client) ──▶ Quote.accepted
     │
     └── NO  ──▶ Bundled e-sig envelope — ONE merged PDF (Quote first,
                 Agreement last); Client initials the Quote page + signs once
                 at the end (BoldSign) ──▶ a single Signed webhook flips
                 MSA.signed + Quote.accepted (0055)
     │
     ▼  Quote.accepted triggers:
   1. campaigns.acceptedQuoteId = quote.id (link back)
   2. campaigns.status = 'booked' (operational)
   3. Stripe invoice issued (0025 Phase 7.3) — deposit per §3.i
     │
     ▼  Stripe paid webhook (0025 Phase 7.4)
   campaigns.status stays at 'booked' (payment confirms delivery is funded)
     │
     ▼  Event runs, coach completes day-of work
   campaigns.status = 'completed'
```

### The bundled first-deal envelope (single artifact)

When a Client has no active MSA, their first Quote ships as **one merged PDF**, not two separate documents. 0055 collapsed the prior two-file (MSA + Quote) BoldSign envelope into a single signable artifact:

- **Composition** — `combineQuoteAndMsa` (`src/lib/pdf/merge.ts`) concatenates the rendered Quote (first) and the verbatim Agreement (last) via pdf-lib `copyPages`. Page content streams are cloned byte-for-byte, so neither half reflows.
- **Signing fields** — the Client **initials** the Quote page and applies **one signature** at the bottom of the Agreement (the end of the combined doc). Anchors are computed in merged-doc coordinates: the signature anchor's page number shifts by the Quote's page count; the Quote initials anchor keeps its (Quote-first) page. `sendMsaEnvelope` (`src/features/msa/actions.ts`) renders the Quote with `{ withInitials: true }`, combines, then posts the single file `agreement-<msaId>.pdf` carrying both field types.
- **Coordinate gotcha (BoldSign).** The PDF renderers emit field anchors in **72-DPI PDF points, top-left origin** (`FieldAnchor` in `src/lib/pdf/anchors.ts`). BoldSign positions field bounds in **96-DPI pixels**, so `buildFormField` in `src/lib/boldsign/client.ts` scales anchors by `96/72` before sending. Without the scale, fields render at `0.75×` (too high and too far left). Verified by the 0055 live smoke (2026-05-22); see `d06082b`.
- **Correlation** — the Quote links to its MSA via the existing `quotes.msaId` column, set at send time (no migration; nothing else writes that column).
- **One signed artifact → cascading flips** — the BoldSign `Signed` webhook (`src/app/api/boldsign/webhook/route.ts`) downloads the single signed PDF to GCS (`msa/{msaId}/signed.pdf`), then `markMsaSigned` (`src/features/msa/lifecycle.ts`) runs the transitions **sequentially, not in one DB transaction**: the MSA `pending → active` flip is the atomic guarded-UPDATE pivot; the bundled-quote accept (`draft → accepted`, audit `payload.via = 'msa-envelope'`) and prospect-dealer promote (`prospect → active`) run **best-effort and isolated** afterward (a missing/already-accepted quote is a silent no-op so a replayed webhook never errors the MSA flip). All side effects are written as the `system` actor (`actor_user_id = null`, `actor_role = 'system'`).
- **Statement vs. Agreement** — the Quote half carries a short *Terms and Conditions* / *Invoicing & Payment* statement (`render-quote.ts` constants) that incorporates the Master Agreement by reference; the Agreement half is the lawyer's verbatim §1–§10 (`render-msa.ts`, restored to verbatim in 0055 Phase 1). Each signed MSA row records which revision it used via `templateVersion` (env-driven `MSA_TEMPLATE_VERSION`).

Design history: [`docs/chunks/closed/0055-quote-msa-one-document/plan.md`](../chunks/closed/0055-quote-msa-one-document/plan.md).

### Less-happy paths

- **Cancellation within 21 days of Event start** — 50% × Quote total per §2.iii. Owned by `src/lib/quotes/cancellation.ts` eventually; invoiced as a separate Stripe line item. **Out of v1 scope** (see 0037 OQ #4).
- **Quote expired before acceptance** — Quote's `quoteValidDays` window (default 30) elapses since the most-recent send. Two recoveries: (a) coach hits **Re-send Quote** on the same row to replace the recipient's copy with refreshed pricing — `sent_at` resets to now, the validity window resets, and a fresh `quote.sent` audit row joins the Send-history Section (0046); (b) build a new Quote from scratch if pricing has materially changed enough that the line-items diff would be confusing. The expiry guard on `acceptQuote` (0044) refuses `sent → accepted` when `sentAt + quoteValidDays < now()` regardless of recovery path.
- **Coach needs to fix a typo / swap a line item / re-send to a different contact** — Quote stays editable through `sent` (0046 retired the draft-only edit guard). `setQuoteInputs` accepts saves on any non-terminal status; clicking **Re-send Quote** re-renders the PDF, overwrites the storage object, re-emails the recipient, advances `sent_at` to now, and emits a fresh `quote.sent` audit row. The *accepted* / *declined* terminal states stay immutable — those are the contract artifacts and the composer flips back to read-only.
- **MSA terminated mid-term** — either party gives notice per §2.ii. Schema records `terminationNoticeDate` and `terminationEffectiveDate`; the gap must be ≥ 30 days (OQ #1 resolution). Quotes under the terminated MSA cannot be accepted after `terminationEffectiveDate`; existing accepted Quotes (already-running campaigns) honor their commitments.
- **MSA expires (12 months elapse, no termination)** — daily sweep (deferred) flips `status='expired'`. Composer Send rejects until renewed. Renewal = coach clicks "Renew MSA" on the Client → new `master_service_agreements` row + fresh e-sig envelope (v1 manual flow per OQ #3).

## Per-Client, one MSA at a time

The MSA is signed at the **Client (dealer) level**, not per-Quote. Implications:

- A Client with an active MSA can accept any number of Quotes under that term without re-signing (§1.ii, OQ #8 working assumption).
- A Client whose MSA expired or terminated cannot accept new Quotes until they sign a new MSA.
- A Client without an MSA who is sent their first Quote signs both at once via the bundled envelope — a single merged document (Quote + Agreement) they initial and sign once (0055; see [The bundled first-deal envelope](#the-bundled-first-deal-envelope-single-artifact)).
- Coaches are scoped per-Client: a coach can build/send Quotes for any Client they own (per `project_coach_owned_business` memory), but the MSA exists at the dealership level regardless of which coach handles the relationship.

The "find active MSA for this Client" query is the hot path — supported by an index on `(dealer_id, status)` per the schema plan.

## Template versioning

MSA wording isn't immutable. The legal team may revise clauses (notice period, governing law, payment terms). Every signed MSA row carries `templateVersion` (a short string like `2026-05` keyed off the template's revision date, hardcoded server-side at signing time per OQ #6 working assumption). This means:

- Future template revisions don't silently rebind existing signatories — a renewed MSA gets the new `templateVersion`; the old one stays at its original version.
- If a dispute hinges on which wording the Client signed, `templateVersion` + the archived `signedPdfStorageKey` tell the full story.
- We do NOT maintain a separate `msa_templates` table in v1 — one column is enough until the template body gains structured fields.

## What 0037 actually ships

Phase 1 (this doc + cross-plan reconciliation) — pure docs.
Phase 2 — `master_service_agreements` schema + migration; no Server Actions (those belong to 0025 Phase 7.2's MSA send/sign flow).
Phase 3 — plan-doc edits to lock the `quotes` schema shape *before* 0026 Phase 2 ships.
Phase 4 — drop the strictly-commercial columns from `campaigns` (`fee`, `travel`, `deposit_pct`, `tax_pct`, `quote_valid_days`) once 0026 Phase 2 + 0035 Phase 3 are writing to the new locations on `quotes`. **Scope narrowed 2026-05-12 during the `/build` chunk loop:** `audience_source_id` deferred to a follow-up because the booking-form Data Source dropdown + production/reports/calendar reads still consume it (none for commercial purposes) and the composer-driven flow that would replace them isn't fully wired yet. The five strictly-commercial drops shipped at `b089d47`.
Phase 5 — wiki + test sweep.

What 0037 does **NOT** do:

- Build the MSA send/sign UI (0025 Phase 7.2).
- Build the cancellation-fee invoicing (deferred, OQ #4).
- Build the daily expiry-sweep job (deferred, OQ #3).
- Migrate any production data (none yet — confirm before Phase 4).

## Cross-links

- [`docs/wiki/data-model.md`](data-model.md) — the per-table reference. Carries the current `master_service_agreements` and `quotes` table descriptions, plus the updated `campaigns` walkthrough framing the table as operational-delivery after 0037 Phase 4's commercial-column drop.
- [`docs/wiki/auth.md`](auth.md) — gating conventions for MSA-related Server Actions (admin + coach with per-Client ownership).
- [`docs/wiki/conventions.md`](conventions.md) — Drizzle ID/audit-column defaults; session-pooler for migrations.
- [`docs/strategy/roadmap.md`](../strategy/roadmap.md) — long-horizon framing of the quote→MSA→e-sig surface area.
