# Commercial spine + MSA model — 2026-05-11

**Started:** 2026-05-11

Architectural-decision chunk. Locks the commercial spine — **accepted Quote = the binding contract for a project; no separate `orders` table; MSA is per-Client and 12-month** — and makes the schema changes that enable it. Confirmed against the live Salesability MSA text (user-supplied 2026-05-11; key clauses §1.ii, §1.iii, §2.i, §2.iii, §3.i, §9 — see `docs/wiki/commercial-spine.md` after Phase 1).

Done = (a) decision is written and cross-plans reconciled (0025 / 0026 / 0035 plan-doc sketches updated); (b) `master_service_agreements` table exists; (c) `quotes` schema sketch in 0026 Phase 2 carries the moved commercial columns + the flipped FK direction; (d) commercial columns are dropped from `campaigns` once 0026 Phase 2 + 0035 Phase 3 are writing to the new locations.

**Sequencing constraint:** Phases 1–2 of this plan must land **before 0026 Phase 2 ships**. If 0026 Phase 2 lands first with `quotes.campaignId` (current direction), flipping it later is a real migration with downstream code breakage. Phase 4 (drop columns from `campaigns`) must land **after** 0026 Phase 2 and 0035 Phase 3, because those phases need to be writing to the new columns first.

## Progress Tracker

| Phase | Status | Commit |
|-------|--------|--------|
| 1: Decision doc + cross-plan reconciliation | Done | `3b9b18e` |
| 2: `master_service_agreements` schema + migration | Done | - |
| 3: Quotes schema patch into 0026 Phase 2 sketch (FK flip + commercial columns + `audienceSourceId`) | Pending | - |
| 4: Drop commercial columns from `campaigns` (gated on 0026 P2 + 0035 P3) | Pending | - |
| 5: Tests + wiki sweep | Pending | - |

**Overall Progress:** 40% (2/5 phases complete)

## Code Anchors

For each new file/method below, the builder reads the anchor first and matches its shape (length, error handling, naming, query style).

| New code | Anchor (`path:line`) | Why this anchor |
|----------|---------------------|-----------------|
| `src/lib/db/schema/master-service-agreements.ts` (new) | `src/lib/db/schema/campaigns.ts` | Same shape: `pgTable` with `bigIdentity()`, fk to `dealers.id`, `timestamps`, `actors`. MSA carries lifecycle status enum (mirror `pgEnum` usage already in repo). |
| `drizzle/0010_msa.sql` (or whichever next serial after 0035's migrations) | `drizzle/0006_is_staff_member_excludes_dealer.sql` | Most recent migration; same generate-then-edit flow. |
| Phase 3 edits to `0026-quote-pdf/plan.md` Phase 2 sketch | n/a — plan-doc edit | Adds `fee`, `travel`, `depositPct`, `taxPct`, `quoteValidDays`, `audienceSourceId`, `msaId` to the `quotes` schema sketch; renames `quotes.campaignId` direction to `campaigns.acceptedQuoteId` (move to the campaigns table). |
| Phase 4 migration `drizzle/00XX_drop_campaign_commercial_cols.sql` | `drizzle/0006_*` | Destructive column drops on `campaigns`. Requires 0026 Phase 2 + 0035 Phase 3 to be writing to the new locations. |
| `docs/wiki/commercial-spine.md` (new wiki page) | `docs/wiki/data-model.md` | Reference page describing the spine Client → MSA → Quote → Event/Campaign + Invoice + Payment. |

**Conventions referenced:**
- `docs/wiki/conventions.md` — Drizzle ID/audit-column defaults; `db` client connection pool.
- `docs/wiki/auth.md` — gating for MSA Server Actions (admin + coach, scoped to ownership-by-coach per `project_coach_owned_business` memory).
- `docs/wiki/data-model.md` — gets a substantial update in Phase 1 (Quote-is-the-contract; MSA per-Client; campaign demoted to operational delivery).
- `CLAUDE.md` — Server Actions for our-UI mutations; MSA signing flow is a Server Action triggering Dropbox Sign (7.2's domain — out of scope here).
- `db-conventions` skill — invoke before writing the `master-service-agreements.ts` schema and migration.

**Note:**
- This chunk is **pure foundation.** It defines the spine; it does not implement the MSA send/sign flow (that's 7.2) or the cancellation-fee math (deferred, see Open Question #4).
- Phase 1 reconciles three other plan docs by editing them in place:
  - `0025-quote-to-payment/plan.md` — Sub-plans table gets an "Event/Campaign demotion" line; sequencing note that 7.2 (MSA) must be signable independently of 7.1's send flow.
  - `0026-quote-pdf/plan.md` Phase 2 sketch — schema additions per Phase 3 of this plan; FK direction flip.
  - `0035-quote-composer/plan.md` Phase 3 sketch — composer must check there's an active MSA on the Client before allowing Send; if none, send goes through the bundled MSA + Quote e-sig flow (7.2's domain).

### Phase Checklist

#### Phase 1: Decision doc + cross-plan reconciliation

- [x] Wrote `docs/wiki/commercial-spine.md` — new wiki reference page covering Entities & roles, Lifecycle (incl. happy path + less-happy paths), Why-no-`orders`-table (MSA §1.iii verbatim), MSA renewal (v1 manual), Cancellation fee (deferred), Per-Client one-MSA-at-a-time, Template versioning, What 0037 ships vs doesn't. Cross-linked from `docs/wiki/index.md` Concept pages list.
- [x] ~~Update `docs/wiki/data-model.md` with new MSA + rewritten quotes sections, demote campaigns~~ — **scope adjusted:** the MSA and `quotes` tables don't exist yet (0037 Phase 2 + 0026 Phase 2 work). Per the wiki rule "describes what is true now," substantive sections wait for those tables. Instead, added a forward-looking note in the `campaigns` section pointing to `commercial-spine.md` and flagging that the commercial columns are moving. MSA section lands in 0037 Phase 2; `quotes` section lands when 0026 Phase 2 ships.
- [x] Added an entry to `docs/wiki/log.md`: dated 2026-05-11, headline "Commercial spine locked: accepted Quote = contract; MSA per-Client; campaign demoted to operational delivery (0037 Phase 1)", bullets on the column moves, FK direction flip, sibling-plan reconciliation, and carry-forward.
- [x] Updated `docs/strategy/roadmap.md` preamble (NOT body — imported PRD): added a `⚠ Spine settled differently in-app` callout in the import preamble flagging that the roadmap's Phase 3 sequential-flow description is superseded by the bundled MSA + first-Quote envelope in `commercial-spine.md`. Body untouched.
- [x] **Reconciled `0026-quote-pdf/plan.md` Phase 2 sketch** — added commercial columns (`fee` `travel` `depositPct` `taxPct` `quoteValidDays` `audienceSourceId`) + `msaId` to the `quotes` table; removed `campaignId`; noted that `campaigns.acceptedQuoteId` lives on the campaigns side; updated `createQuote` signature to take `dealerId` not `campaignId`. Partially resolved the tax Open Question (NS HST 15% seller-side per MSA §9; buyer-province auto-compute stays open for 7.3).
- [x] **Reconciled `0035-quote-composer/plan.md` Phase 3 + Phase 4** — composer Send action must check active MSA on Client; if none, route into bundled MSA + first-Quote flow (7.2 owns the e-sig envelope). Added explicit note that draft editing (`setQuoteInputs` / `setQuoteTax` / `setQuoteDealer`) does NOT require an MSA — the gate is on Send only.
- [x] **Reconciled `0025-quote-to-payment/plan.md`** — added a top-level "Commercial spine" bullet to Shared Foundation pointing at 0037; added an "Event/Campaign demotion" line; added under Sequencing that 7.2's MSA send/sign flow is a runtime prerequisite for first-time Quote acceptance (not a post-quote step); added 0037 Phases 1–2 as an explicit prereq.

#### Phase 2: `master_service_agreements` schema + migration

- [x] **Schema decision: `master_service_agreements` columns** — `id` (bigIdentity), `dealerId` (fk → `dealers.id`, NOT NULL), `signedAt` (timestamp, nullable until signed), `expiresAt` (timestamp, nullable; populated as `signedAt + 12 months` on signing per MSA §2.i), `status` (`pgEnum('msa_status', ['pending', 'active', 'expired', 'terminated'])`), `signedPdfStorageKey` (text, nullable; populated by 7.2 on sign completion), `dropboxSignDocumentId` (text, nullable; external id from 7.2), `terminationNoticeDate` (timestamp, nullable; set when either party gives notice per §2.ii), `terminationEffectiveDate` (timestamp, nullable), `templateVersion` (text — captures which MSA wording was signed, so future template revisions don't silently rebind existing signatories), audit cols (`createdAt`, `updatedAt`, `createdById`, `updatedById`).
- [x] New schema file `src/lib/db/schema/master-service-agreements.ts` per anchor.
- [x] Index on `dealerId`, on `(dealerId, status)` for the "find active MSA for this client" query, and on `expiresAt` (for expiry-sweep jobs in the future).
- [x] `pnpm db:generate` → next sequential migration file (`drizzle/0008_bright_lockjaw.sql`).
- [x] Apply migration via session pooler (per `db-conventions`).
- [x] Add `master_service_agreements` to `src/lib/db/schema/index.ts` export.
- [x] **No Server Actions in this phase.** Sign / status-transition actions are owned by 7.2. This phase just stands up the table so 7.2 has somewhere to write.
- [x] Vitest: thin test confirming the table is reachable and the status enum is valid; full action tests land in 7.2.

#### Phase 3: Quotes schema patch into 0026 Phase 2 sketch (FK flip + commercial columns + `audienceSourceId`)

This phase produces **plan-doc edits, not code** — the actual `quotes` table is built by 0026 Phase 2. The point of this phase is to lock the shape *before* 0026 Phase 2 ships so the FK direction and column placement are correct from day one.

- [ ] Edit `0026-quote-pdf/plan.md` Phase 2 schema sketch to add to the `quotes` table:
  - `fee` (numeric — flat fee component; cross-checked against `inputs` × catalog at edit time, persisted alongside)
  - `travel` (numeric — flat travel amount; mirrors `inputs.travelAmount`)
  - `depositPct` (numeric, default `0`)
  - `taxPct` (numeric, default `15` per NS HST seller-side)
  - `quoteValidDays` (integer, default `30`)
  - `audienceSourceId` (fk → `audience_sources.id`, nullable — carried forward from the lead on convert)
  - `msaId` (fk → `master_service_agreements.id`, nullable until the Quote is accepted under a specific MSA term)
  - Remove `campaignId` from quotes; the campaign FK lives on the campaigns side instead.
- [ ] Edit `0026-quote-pdf/plan.md` Phase 2 sketch for `campaigns`: add `acceptedQuoteId` (fk → `quotes.id`, nullable; populated when an accepted quote spawns a delivery campaign). Existing campaigns without an accepted quote stay valid (the column is nullable for backwards compatibility until commercial columns are dropped in this plan's Phase 4).
- [ ] Edit `0026-quote-pdf/plan.md` Open Questions: resolve the "Tax calculation" question by noting that NS HST 15% is the seller-side default (confirmed by MSA §9 / Dartmouth NS address); buyer-province auto-compute stays open for 7.3.
- [ ] Edit `0035-quote-composer/plan.md` Phase 3 to note that `setQuoteInputs` and friends do **not** require an MSA; the MSA gate lives on the Send action, not on draft editing.

#### Phase 4: Drop commercial columns from `campaigns`

**Gated on:** 0026 Phase 2 (creates `quotes` table with the new columns) AND 0035 Phase 3 (composer writes to the new columns) shipping. Until both land, `campaigns` is still the source of commercial fields for any UI that reads them (notably the legacy /production view).

- [ ] Confirm no code reads `campaigns.fee`, `campaigns.travel`, `campaigns.depositPct`, `campaigns.taxPct`, `campaigns.quoteValidDays`, `campaigns.audienceSourceId` for any commercial purpose. (Some reads may still want `audienceSourceId` for attribution reports — if so, those reports get rewritten to read from `quotes.audienceSourceId` instead.)
- [ ] If any legacy/production data sits on `campaigns` and needs to survive, backfill: for each campaign with non-zero commercial fields, synthesize a `quotes` row at `status='accepted'`, link `campaigns.acceptedQuoteId = newQuoteId`, and copy the commercial values onto the quote. Likely **not needed** if there's no real production data yet — confirm with user before running.
- [ ] Migration: drop `fee`, `travel`, `depositPct`, `taxPct`, `quoteValidDays`, `audienceSourceId` from `campaigns`.
- [ ] Remove those columns from `src/lib/db/schema/campaigns.ts`.
- [ ] Sweep for any remaining references in code; update or delete.

#### Phase 5: Tests + wiki sweep

- [ ] `pnpm tsc --noEmit` clean.
- [ ] `pnpm lint` clean.
- [ ] `pnpm test` — new MSA schema reachability test passes; no regressions in existing campaign/quote tests.
- [ ] Re-read `docs/wiki/commercial-spine.md`, `docs/wiki/data-model.md`, and the three reconciled plan docs (0025/0026/0035) for internal consistency. Fix any drift introduced during Phases 2–4.
- [ ] Append to `docs/wiki/log.md`: "0037 shipped — commercial spine + MSA model locked; `master_service_agreements` table live; commercial columns dropped from campaigns."
- [ ] Update `docs/designs/CURRENT.md` — flip Active to the next plan (likely 0026 unparking, given the sequencing).

## Open questions

- ~~**#1 — §2.ii termination-notice value `XX days` is unfilled** in the MSA template the user supplied.~~ **Resolved 2026-05-11: 30 days.** The MSA template's `XX days` placeholder is filled with `30`. Schema implication: the gap between `master_service_agreements.terminationNoticeDate` and `.terminationEffectiveDate` must be ≥ 30 days, validated at app-layer when 7.2 builds the termination UI. Carry-forward: someone with edit access to the actual MSA document needs to fill the `XX days` placeholder with `30` so the wording the Client signs matches the schema enforcement.
- ~~**#2 — Quote validity period.**~~ **Resolved 2026-05-11: 30 days remains the default.** Today's `campaigns.quoteValidDays` defaults to 30; moves to `quotes.quoteValidDays` carrying the same default. Coaches can override per-quote.
- **#3 — MSA renewal flow.** After 12 months an MSA expires. **Working assumption for v1: manual.** A coach clicks "Renew MSA" on the Client, which kicks off a fresh sign envelope. No auto-prompt 60 days out, no auto-renewal — defer to a later UX chunk. The `status='expired'` rollover does need a daily/nightly sweep job at some point; out of scope here.
- **#4 — Cancellation-fee math.** MSA §2.iii says 50% of Quote total within 21 days of Event start. Lives in `src/lib/quotes/cancellation.ts` eventually; invoiced as a separate line item. **Out of scope for v1.** Flagged so it's not forgotten.
- **#5 — Bundled e-sig envelope shape.** "Sign MSA + Accept first Quote" confirmed as a single envelope (user 2026-05-11). Two implementation choices for 7.2: (a) one Dropbox Sign envelope with two documents (MSA + Quote PDF), each requiring signature; (b) one merged PDF that concatenates them. **Working assumption: (a) — two documents in one envelope** so each can be archived separately at the right `signedPdfStorageKey` (MSA → `master_service_agreements.signedPdfStorageKey`; Quote → no signed-PDF storage today since the Quote PDF is unsigned; revisit if we want a counter-signed Quote).
- **#6 — `templateVersion` on MSA rows.** Including this column so future MSA wording revisions don't silently rebind existing signed agreements. **Working assumption: store a short string like `2026-05` keyed off the date the template body was last revised**, hardcoded server-side when signing starts. A separate `msa_templates` table is overkill for v1.
- ~~**#7 — Lead-stage attribution flow into `quotes.audienceSourceId`.**~~ **Resolved 2026-05-11 — no lead/intake entity in v1.** Manual in-app entry (existing booking modal + 0035 P2 inline-create dealer) creates dealer + contact + campaign directly; public web intake (`future/0016-book-your-event-intake`) is v2 work. `quotes.audienceSourceId` is set at composer time alongside the rest of audience selection — there's no upstream "lead" to carry the source forward from. **Dealership-acquisition source** (how the dealer found us) is a separate concept and lives on `dealers.acquiredVia` per 0035 Phase 2 — the funnel review that drove this resolution surfaced that the lookup (then named `sales_lead_sources`, renamed to `audience_sources` in 0038) was being overloaded between *audience source* (consumer list used in the dealer's campaign) and *acquisition source* (how the dealership found Salesability).
- **#8 — Quotes per MSA term.** §1.ii says "one or more Quotes." **Working assumption: unlimited Quotes per active MSA term; no per-quote re-signing needed.** When the MSA expires/renews, all subsequent Quotes carry the renewed `msaId`. Confirm.
