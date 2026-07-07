# Commercial spine

Reference for how a deal flows through the system: **Client → MSA → Quote → Event/Campaign → Invoice → Payment**. Anchors the legal layer (master agreement + per-deal contract) to the operational layer (the delivery campaign). Locked in 0037 (2026-05-11; shipped 2026-05-12); see [`docs/chunks/closed/0037-commercial-spine-msa/plan.md`](../chunks/closed/0037-commercial-spine-msa/plan.md) for the design history.

> Part of `docs/wiki/`. See [`docs/wiki/index.md`](index.md) for the full catalog and [`docs/wiki/log.md`](log.md) for the maintenance log. Per-chunk working notes (plans, decisions, research) live in `docs/chunks/NNNN-slug/`.

> Source-of-truth contract document: the Salesability *Master Service Agreement* template (user-supplied 2026-05-11). Key clauses cited inline below: **§1.ii** (one or more Quotes per term), **§1.iii** (accepted Quote = the contract), **§2.i** (12-month term), **§2.ii** (30-day termination notice), **§2.iii** (50% cancellation fee within 21 days of Event start), **§3.i** (deposit), **§9** (NS governing law).

## TL;DR

- **The accepted Quote IS the contract for a project.** No separate `orders` table — that abstraction would duplicate what §1.iii already establishes legally.
- **The MSA is per-Client, 12-month, signed once.** All Quotes during that term hang off the same MSA. Renewal is manual in v1.
- **Campaigns are demoted to operational delivery.** They model the Event being run for the dealer (dates, format, coach, day-of contacts) — *not* the commercial terms. Those move onto the Quote.
- **The MSA and the Quote are independent artifacts (0082).** The MSA is e-signed on **its own** BoldSign envelope (MSA pages only), sent from the dealer page. **Every** Quote — first or later — is accepted via the staff `acceptQuote` Server Action (coach phones / replies-to-email with the Client, then flips the row); Quotes never touch BoldSign. Accepting **any** Quote requires the dealer to have an **active MSA** (the accepted Quote is the contract, so the master agreement must be signed first). The originally-planned tokenised public accept link was dropped in 0026 Phase 4 (2026-05-12) after Codex flagged that corporate email security scanners auto-prefetch URLs and would silently accept Quotes on the recipient's behalf; `quotes.accept_token` stays on the schema for forward-compat with a future v2 POST-only confirmation-page button. *(Before 0082 the first deal merged the Quote + MSA into one signed PDF — see [The MSA envelope](#the-msa-envelope-standalone-0082).)*

## Entities

| Entity | Maps to | Lifecycle | Notes |
|--------|---------|-----------|-------|
| **Client** | `dealers` table | Persistent — once a Client, always a Client (archivable) | Schema-level still named `dealers` for legacy reasons; STAR vocab calls this *Dealer Profile* (BC 1). The MSA is signed at the Client level, not per-Quote. |
| **MSA** | `master_service_agreements` (added in 0037 Phase 2) | `pending → active → expired \| terminated` | 12-month term per §2.i. One row per signed agreement; renewals create new rows (don't mutate). Tracks `signedAt`, `expiresAt`, `signedPdfStorageKey`, `providerDocumentId`, `templateVersion`, termination dates. |
| **Quote** | `quotes` (built in 0026 Phase 2) | `draft → sent → accepted \| declined` | Built per-project. Carries the commercial terms (`fee`, `travel`, `depositPct`, `taxPct`, `quoteValidDays`, `audienceSourceId`) + a structured `inputs` jsonb that the invoice recomputes against. **No FK to the MSA** — the `quotes.msaId` column was dropped in 0082; the Quote and MSA are independent (the accept gate looks up the dealer's active MSA at accept time, not via a row link). Default validity = 30 days (overridable per quote). |
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
     ▼  composer — coach builds Quote by picking SKUs from the catalogue (0062 picker; was a calculator pre-0062)
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
   Dealer has an ACTIVE MSA?   (0082 accept gate — D3)
     │
     ├── NO  ──▶ accept REJECTED: "Sign the master agreement first".
     │           The MSA signs on its own BoldSign envelope (sent from the
     │           dealer page); a Signed webhook flips MSA.pending → active.
     │           The MSA flip has NO quote side effect.
     │
     └── YES ──▶ Quote.accepted (staff "Mark accepted" on /quotes/[id])
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

### The MSA envelope (standalone, 0082)

The MSA is e-signed on **its own** BoldSign envelope — MSA pages only, no Quote merged in. The Quote runs an independent send → accept lifecycle and never touches BoldSign. 0082 unwound the bundled-PDF design that 0055/0061 had built.

- **Where it's sent** — from the **per-dealer MSA panel** on `/dealerships/[id]` (admin-only — the page is `admin:access`-gated). The panel shows the MSA's status / signed / expires / signed-PDF, and a **"Send for signature"** action when the dealer has no usable MSA (none / expired / terminated; `MsaSendForSignatureButton` → `MsaCreateDialog` → `createMsaDraft` then `sendMsaEnvelope`). 0061 had moved this onto the (coach-reachable) quote composer *because* it carried the quote; with the quote decoupled, the action returns to a dealer-centric surface. **Access note:** sending an MSA is now effectively admin-only (the dealer page gates `admin:access`), which fits the MSA as the once-per-Client master contract.
- **Composition** — `sendMsaEnvelope` (`src/features/msa/actions.ts`) renders the MSA PDF (`renderMsaPdf`) and posts the single file `agreement-<msaId>.pdf` with the MSA's own signature anchor and metadata `{ msaId }`. No quote render, no `combineQuoteAndMsa` (that helper + `src/lib/pdf/merge.ts` were deleted in 0082).
- **Signing field** — the Client's **"For the Client"** box carries a **BoldSign signature** at the underline plus two signer-filled **TextBox** fields below it: **`ClientPrintedName`** (the signer's full legal name) and **`ClientTitle`** (their title with the company). Below those, the renderer prints the client **email**, the **client address** (moved off page 1 — legal review 0099), and the static attestation **"I confirm I have the authority to bind the Client to this Agreement."** The envelope stays **single-signer**: only the Client signs via BoldSign. The Quote-initials field is gone (there's no quote in the envelope). **Full-name sourcing:** `resolveQuoteRecipient` returns the contact's `lastName` alongside `firstName`; `sendMsaEnvelope` composes the full name and passes it as BoldSign's `signer.name`, so the adopted-signature default is the **full** name (a first name alone is not legally binding). These changes bumped `MSA_TEMPLATE_VERSION` → `2026-07-07` (chunk **0099**; see [`docs/chunks/0099-msa-signature-legal/`](../chunks/0099-msa-signature-legal/plan.md)). **Per-page initials were considered and declined** — BoldSign cryptographically tamper-seals the whole document, so one signature authenticates all pages; the `Initial` field type stays wired but unused for the MSA.
- **Salesability counter-signature (pre-applied).** The left-column **"For Salesability"** block is **baked into the rendered PDF**, not collected as a second BoldSign signer — `renderMsaPdf` (`src/lib/pdf/render-msa.ts`) embeds `public/shannon-signature.png` above the left underline, with "Shannon Tilley, President", her email, and a **"Signed: <issuedDate>"** line. The Client therefore receives an **already-counter-signed** MSA and only adds their own signature. A real second BoldSign signer was deliberately avoided — the `onBehalfOf` ownership transfer 403-locked the signed-PDF webhook (chunk 0092). The asset is **required**: a missing `public/shannon-signature.png` fails the render loud (error) rather than shipping a blank Salesability block. The committed PNG is a **generated script-font rendering** of "Shannon Tilley" (Brush Script), adopted as Salesability's execution mark — the same mechanism e-sign platforms use when they render a typed name as an adopted signature (owner decision, 2026-06-23). Swappable for a handwritten scan later at the same path with no code change.
- **Coordinate gotcha (BoldSign).** The MSA renderer emits the signature anchor in **72-DPI PDF points, top-left origin** (`FieldAnchor` in `src/lib/pdf/anchors.ts`); BoldSign positions in **96-DPI pixels**, so `buildFormField` in `src/lib/boldsign/client.ts` scales by `96/72`. Without it, fields render at `0.75×`.
- **Signed → MSA-only flip** — the BoldSign `Signed` webhook (`src/app/api/boldsign/webhook/route.ts`) downloads the signed PDF to GCS (`msa/{msaId}/signed.pdf`), then `markMsaSigned` (`src/features/msa/lifecycle.ts`) does the atomic guarded `pending → active` flip + a `msa.signed` audit row (`system` actor). **No quote or dealer side effect** — signing the MSA flips only the MSA. The prospect-dealer promotion now happens at quote-accept (below), not at MSA-sign.

### Accepting a Quote (0082)

There is **no customer self-serve accept** — acceptance is **staff-recorded**. The coach emails the quote PDF (`sendQuote`), the Client replies/phones, and the coach flips the row from a **"Customer decision"** card on `/quotes/[id]`:

- **`QuoteStatusActions`** (`src/features/quotes/quote-status-actions.tsx`) renders **"Mark accepted"** + **"Decline"** for a `sent` quote (each behind a confirm dialog), wired to the existing `acceptQuote` / `declineQuote` Server Actions (both `quote:edit`).
- **The accept gate (D3)** — `acceptQuote` loads the quote's `{ dealerId, status }`; a `sent` quote with **no `active` MSA** is rejected with *"Sign the master agreement first…"*. The gate fires only on the real `sent → accepted` transition (a non-`sent` row skips it, so an idempotent re-accept is preserved). The **Accept** button mirrors the gate: disabled with helper copy when the dealer has no active MSA (or the quote has expired). This is the explicit replacement for the old implicit gate (where signing the bundled envelope *was* the only way to accept the first quote).
- **On accept** — `acceptQuote` emits `quote.accepted` (`payload.source = 'staff'`), promotes a `prospect` dealer → `active` (reusing the `dealerId` it already loaded for the gate), and **snapshots the quote's delivery metrics onto its campaign** (0094 — see below). Decline emits `quote.declined`.
- **Verifying the send path (0067)** — an admin-only **Send Test MSA** tool at `/admin/send-test-msa` (`sendTestMsa` in `src/features/msa/actions.ts`, gated `admin:access`) renders the MSA prose with placeholder data and posts a **real** MSA-only BoldSign envelope, surfacing the returned `documentId`. It creates **no** `master_service_agreements` row, so it stamps `metaData: { test: 'true' }`; the `Signed` webhook acks such an envelope `200` on that flag instead of 404ing. In prod it's a real, non-sandbox send — used to confirm prod BoldSign after a config change. See [`docs/chunks/closed/0067-send-test-msa/plan.md`](../chunks/closed/0067-send-test-msa/plan.md).

Design history: the standalone split is [`docs/chunks/closed/0082-quote-msa-decouple/`](../chunks/closed/0082-quote-msa-decouple/decision.md); the superseded bundle was [`0055-quote-msa-one-document`](../chunks/closed/0055-quote-msa-one-document/plan.md) + [`0061-move-msa-action-to-quote`](../chunks/closed/0061-move-msa-action-to-quote/plan.md).

### Calendar surfaces commercial status — encourage upfront (0093)

The workflow is **date-first**: a coach books an event (a `campaigns` row, via "+ Book Event"), then the Quote and MSA are follow-up tasks. Before 0093 booking dead-ended (saved the date, closed the dialog), leaving the event an **exposed date-hold** — no cancellation-fee protection, since §2.iii needs an *accepted Quote* + an *active MSA*. SME pushback (2026-06-24) reframed this: **encourage the commercial work upfront**.

- **Quote ⇄ event link.** `quotes.campaign_id` (nullable FK → `campaigns.id`, `SET NULL`, **0093**) ties each Quote to its event. **App-required** for new quotes — `createQuote` rejects a missing `campaignId` and guards that the event belongs to the dealer. Existing **accepted** quotes were backfilled from `campaigns.accepted_quote_id` (migration `0047`). The column stays nullable so legacy draft/sent quotes tolerate it. Every quote-creation entry point now flows through a **required Event `<select>` in the composer** (decision C — `QuoteComposer` already picks the dealer inline, so the event belongs there too).
- **Per-event commercial status.** `loadCommercialStatusByCampaign` (`src/features/schedule/commercial-status.ts`) resolves, per campaign: the latest linked quote's display status + the dealer's active-or-pending MSA, and **`exposed = !(quote accepted && MSA active)`**. Batched (2 queries, no N+1); the calendar page passes it to the view.
- **Booking → "Create quote now?" hand-off.** On Book Event success the dialog shows a directive prompt (primary **Create quote now →** which navigates to the prefilled composer, **Send MSA for signature**, quiet **I'll do this later**). `createCampaign` returns the new `{ campaignId, dealerId }` to prefill. Skippable — not a hard block.
- **Visibility as backstop.** The **event-detail card** shows Quote + MSA badges + a **"⚠ Commercially exposed" / "✓ Protected"** banner + the two CTAs; the **calendar ribbon** carries an **amber dot** on exposed events. MSA is per-client, so "Send MSA" only shows when the client has no active MSA.
- **Cancellation-fee *math* stays out of scope** (0037) — 0093 encodes the *principle* (protect the commitment early) in the flow, not the fee calculation. See [`docs/chunks/closed/0093-calendar-quote-msa-status/`](../chunks/closed/0093-calendar-quote-msa-status/intent.md).

### Delivery metrics: sourced from the accepted quote (0094)

The four **delivery metric** columns on `campaigns` — `qty_records` / `sms_email` / `letters` / `bdc` — are *operational volume* numbers (records prepared, SMS/email touches, letters mailed, BDC calls). The **quote owns that scope**; the campaign carries the derived delivery numbers. Booking schedules, the quote scopes, production delivers.

- **They left the Book Event dialog (0094).** The booking form used to capture them at the *scheduling* step — before any quote existed, so they sat blank and got re-entered. Now the booking form captures only scheduling (date / dealer / day-of contact / coach / notes) **plus Event Format + Data Source** (`style_id` / `audience_source_id`, which no SKU derives). A newly-booked campaign shows **blank** metrics until its quote is accepted.
- **Derived at quote-accept.** `applyAcceptedQuoteToCampaign` (`src/features/quotes/campaign-delivery.ts`) rolls the accepted quote's `quote_line_items` into the four numbers via the pure `deriveDeliveryMetrics` (`src/lib/quotes/delivery-metrics.ts`) and writes them onto the campaign (via `quotes.campaign_id`), also populating `campaigns.accepted_quote_id`. Run on every confirmed-accepted `acceptQuote` (not only the transition) → idempotent + self-healing.
- **SKU → metric mapping** (catalogue codes from `drizzle/0013_seed_service_items.sql`): `bdc` ← Σ`bdc-call`.qty · `letters` ← Σ`letter-postage`.qty · `sms_email` ← Σ`digital-record`.qty · `qty_records` ← `500 × Σ base-event.qty` (the base package "includes 500 records") + Σ`additional-contact`.qty. `additional-day` / `record-retrieval` / `travel` carry no delivery metric.
- **Override for true production differences** stays a **billing/invoice concern** on `/reports` — `billing_adjustments` (0059) still layers `override ?? campaign.value` there, where `campaign.value` is now quote-derived. The `/production` page shows the raw quote-derived numbers (no overlay) — the override is *not* reflected back onto Production (owner decision, 0094 D6).
- **One-time backfill.** `scripts/backfill-campaign-delivery-metrics.ts` (dry-run default, `--write` to commit) rewrites every campaign that has an accepted quote from that quote (D3 backfill-all), reusing the same pure mapping. Idempotent. Does not touch `billing_adjustments`.
- Design history: [`docs/chunks/0094-decouple-booking-metrics/`](../chunks/closed/0094-decouple-booking-metrics/decision.md).

### Less-happy paths

- **Cancellation within 21 days of Event start** — 50% × Quote total per §2.iii. Owned by `src/lib/quotes/cancellation.ts` eventually; invoiced as a separate Stripe line item. **Out of v1 scope** (see 0037 OQ #4).
- **Quote expired before acceptance** — Quote's `quoteValidDays` window (default 30) elapses since the most-recent send. Two recoveries: (a) coach hits **Re-send Quote** on the same row to replace the recipient's copy with refreshed pricing — `sent_at` resets to now, the validity window resets, and a fresh `quote.sent` audit row joins the Send-history Section (0046); (b) build a new Quote from scratch if pricing has materially changed enough that the line-items diff would be confusing. The expiry guard on `acceptQuote` (0044) refuses `sent → accepted` when `sentAt + quoteValidDays < now()` regardless of recovery path.
- **Coach needs to fix a typo / swap a line item / re-send to a different contact** — Quote stays editable through `sent` (0046 retired the draft-only edit guard). `setQuoteInputs` accepts saves on any non-terminal status; clicking **Re-send Quote** re-renders the PDF, overwrites the storage object, re-emails the recipient, advances `sent_at` to now, and emits a fresh `quote.sent` audit row. The *accepted* / *declined* terminal states stay immutable — those are the contract artifacts and the composer flips back to read-only.
- **MSA terminated mid-term** — either party gives notice per §2.ii. Schema records `terminationNoticeDate` and `terminationEffectiveDate`; the gap must be ≥ 30 days (OQ #1 resolution). Quotes under the terminated MSA cannot be accepted after `terminationEffectiveDate`; existing accepted Quotes (already-running campaigns) honor their commitments.
- **MSA expires (12 months elapse, no termination)** — daily sweep (deferred) flips `status='expired'`. The 0082 accept gate then **rejects new Quote accepts** ("Sign the master agreement first") until renewed — sending/re-sending a Quote is still allowed, only acceptance is blocked. Renewal = admin uses **"Send for signature"** on the dealer page → new `master_service_agreements` row + fresh standalone MSA envelope (v1 manual flow per OQ #3).

### Supporting documents on the quote email (0078)

A coach can attach supporting paperwork — a registration form, banking instructions, a waiver — that travels *with* the quote rather than as a disconnected side email. From the **Send Quote** dialog on `/quotes/[id]`, the **Documents** section uploads one or more local files (`uploadQuoteAttachment` → GCS + a `quote_attachments` row) and lists them with a Remove affordance (`removeQuoteAttachment`). On send, `sendQuote` loads the set, fetches each object from GCS, and appends them to the outgoing email's `attachments` array next to the rendered quote PDF; the `quote.sent` audit payload denorms what went out (filenames + count). The set **persists on the quote**, so a **Re-send re-attaches the same documents** without re-uploading. Guards: type allowlist (PDF / images / docx / xlsx), ≤10 MB per file and ≤20 MB total payload (fails closed *before* the status transition so an over-size send never half-fires), and a missing/unreadable object fails the send with a repairable "remove and re-upload" message. Gated by `quote:edit` (same capability as send). Retention is keep-forever in GCS. The shared library/"from the system" source is the deferred **0079** chunk, which extends this spine with a nullable `document_id` FK — see [`data-model.md`](data-model.md). Caps + allowlist live in `src/features/quotes/attachments.ts`.

## Per-Client, one MSA at a time

The MSA is signed at the **Client (dealer) level**, not per-Quote. Implications:

- A Client with an active MSA can accept any number of Quotes under that term without re-signing (§1.ii, OQ #8 working assumption).
- A Client whose MSA expired or terminated cannot accept new Quotes until they sign a new MSA — enforced by the 0082 accept gate (`acceptQuote` requires an `active` MSA).
- A Client without an active MSA must sign one **first** — sent standalone from the dealer page (0082; see [The MSA envelope](#the-msa-envelope-standalone-0082)) — before their first Quote can be accepted.
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
