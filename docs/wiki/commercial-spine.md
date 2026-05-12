# Commercial spine

Reference for how a deal flows through the system: **Client → MSA → Quote → Event/Campaign → Invoice → Payment**. Anchors the legal layer (master agreement + per-deal contract) to the operational layer (the delivery campaign). Locked in 0037 (2026-05-11); see [`docs/designs/closed/0037-…/plan.md`] once shipped for the design history.

> Part of `docs/wiki/`. See [`docs/wiki/index.md`](index.md) for the full catalog and [`docs/wiki/log.md`](log.md) for the maintenance log. Per-chunk working notes (plans, decisions, research) live in `docs/designs/NNNN-slug/`.

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
| **MSA** | `master_service_agreements` (added in 0037 Phase 2) | `pending → active → expired \| terminated` | 12-month term per §2.i. One row per signed agreement; renewals create new rows (don't mutate). Tracks `signedAt`, `expiresAt`, `signedPdfStorageKey`, `dropboxSignDocumentId`, `templateVersion`, termination dates. |
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
   Quote.draft
     │
     ▼  Send (0035 Phase 4)
   Quote.sent  ── PDF email to Client; Client phones/replies ──┐
                                                                │
       ┌────────────────────────────────────────────────────────┘
       │
       ▼  Coach runs staff `acceptQuote` Server Action (v1; no public surface)
   MSA exists?
     │
     ├── YES (active MSA on Client) ──▶ Quote.accepted
     │
     └── NO  ──▶ Bundled e-sig envelope (MSA + first Quote, both signed in
                 Dropbox Sign per OQ #5 working assumption) ──▶ MSA.signed +
                 Quote.accepted in the webhook callback
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

### Less-happy paths

- **Cancellation within 21 days of Event start** — 50% × Quote total per §2.iii. Owned by `src/lib/quotes/cancellation.ts` eventually; invoiced as a separate Stripe line item. **Out of v1 scope** (see 0037 OQ #4).
- **Quote expired before acceptance** — Quote's `quoteValidDays` window (default 30) closes; coach must clone-and-resend with refreshed pricing. The expiry guard belongs on the staff `acceptQuote` Server Action (planned — not yet wired): refuse `sent → accepted` when `sentAt + quoteValidDays < now()`.
- **MSA terminated mid-term** — either party gives notice per §2.ii. Schema records `terminationNoticeDate` and `terminationEffectiveDate`; the gap must be ≥ 30 days (OQ #1 resolution). Quotes under the terminated MSA cannot be accepted after `terminationEffectiveDate`; existing accepted Quotes (already-running campaigns) honor their commitments.
- **MSA expires (12 months elapse, no termination)** — daily sweep (deferred) flips `status='expired'`. Composer Send rejects until renewed. Renewal = coach clicks "Renew MSA" on the Client → new `master_service_agreements` row + fresh e-sig envelope (v1 manual flow per OQ #3).

## Per-Client, one MSA at a time

The MSA is signed at the **Client (dealer) level**, not per-Quote. Implications:

- A Client with an active MSA can accept any number of Quotes under that term without re-signing (§1.ii, OQ #8 working assumption).
- A Client whose MSA expired or terminated cannot accept new Quotes until they sign a new MSA.
- A Client without an MSA who is sent their first Quote signs both at once via the bundled envelope.
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
Phase 4 — drop the commercial columns from `campaigns` once 0026 Phase 2 + 0035 Phase 3 are writing to the new locations.
Phase 5 — wiki + test sweep.

What 0037 does **NOT** do:

- Build the MSA send/sign UI (0025 Phase 7.2).
- Build the cancellation-fee invoicing (deferred, OQ #4).
- Build the daily expiry-sweep job (deferred, OQ #3).
- Migrate any production data (none yet — confirm before Phase 4).

## Cross-links

- [`docs/wiki/data-model.md`](data-model.md) — the per-table reference. `master_service_agreements` section lands in 0037 Phase 2; `quotes` section lands when 0026 Phase 2 ships.
- [`docs/wiki/auth.md`](auth.md) — gating conventions for MSA-related Server Actions (admin + coach with per-Client ownership).
- [`docs/wiki/conventions.md`](conventions.md) — Drizzle ID/audit-column defaults; session-pooler for migrations.
- [`docs/strategy/roadmap.md`](../strategy/roadmap.md) — long-horizon framing of the quote→MSA→e-sig surface area.
