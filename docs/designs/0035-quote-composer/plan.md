# Quote composer + service catalog + prospect dealers — 2026-05-08

**Started:** 2026-05-08

Sub-plan of [`../0025-quote-to-payment/plan.md`](../0025-quote-to-payment/plan.md) (sibling of [`../0026-quote-pdf/plan.md`](../0026-quote-pdf/plan.md)). Stand up the **composer side** of the Quote loop: a coach picks line items from a DB-backed service catalog, edits quantities, sees a live total, optionally creates a prospect dealer inline, previews the PDF, and sends. Done = a coach can build a quote end-to-end starting from either a campaign-detail page or a dealer page, without leaving the app, against either an existing dealer or a freshly-created prospect.

This chunk does **not** own the `quotes` table or `renderQuotePdf` or the send/accept flow — those are 0026 Phases 2–4. 0035 is the **layer that calls into them.** Sequencing: 0026 Phase 2 (table + bare-bones actions) must ship before 0035 Phase 3; 0026 Phase 3 (PDF render wired to real data) must ship before 0035 Phase 4's preview pane lights up; 0026 Phase 4 (send + accept route) must ship before 0035 Phase 4's "Send" button works.

## Progress Tracker

| Phase | Status | Commit |
|-------|--------|--------|
| 1: Service catalog data model + admin UI | Done | `bfaeff7` |
| 2: Prospect status on dealers + inline-create flow | Pending | - |
| 3: Pricing logic + quote composer page | Pending | - |
| 4: PDF preview pane + send wiring | Pending | - |
| 5: Tests + smoke verification | Pending | - |

**Overall Progress:** 20% (1/5 phases complete)

## Code Anchors

For each new file/method below, the builder reads the anchor first and matches its shape (length, error handling, naming, query style).

| New code | Anchor (`path:line`) | Why this anchor |
|----------|---------------------|-----------------|
| `src/lib/db/schema/service-items.ts` (new) | `src/lib/db/schema/campaign-styles.ts` | Same shape: small lookup table with `label`, `sortOrder`, `archivable`. Service items extend the same pattern with `unitPrice`, `unit`, `code`. |
| `src/lib/db/schema/dealers.ts` (modify — add `status`) | `src/lib/db/schema/dealers.ts:4-19` | In-place column add to existing schema; mirror the `archivable` mixin shape for the new `status` enum. Use `pgEnum` like other typed enum columns in the repo. |
| `drizzle/0012_round_skrulls.sql` (schema) + `drizzle/0013_seed_service_items.sql` (seed) + `drizzle/0014_service_items_rls.sql` (RLS — carry-forward from pass-1 eval) | `drizzle/0006_is_staff_member_excludes_dealer.sql` + `drizzle/0009_msa_rls.sql` | Generated migration + `--custom` seed + hand-written RLS mirror of the MSA pattern. |
| `src/features/services/services-admin.tsx` (new) | `src/features/schedule/lookup-admin.tsx` | Direct precedent: existing single-section admin UI for lookup tables (campaign-styles + sales-lead-sources). Same `<Can>` gating, same `useActionState`, same `toLegacyResult` adapter. |
| `src/features/services/actions.ts` (new) — `createServiceItem`, `updateServiceItem`, `archiveServiceItem` | `src/features/schedule/actions.ts` (createCampaignStyle / updateCampaignStyle / archiveCampaignStyle) | Identical shape on a sibling lookup table. `capabilityClient('lookup:edit')` per existing lookup actions. |
| `src/lib/quotes/pricing.ts` (new) — `computeQuoteTotal({ items, audienceSize })` | `src/lib/csv.ts` | Pure-function utility module precedent in `src/lib/`. Stateless, deterministic, fully unit-testable. |
| `src/features/dealers/dealer-form.tsx` (modify — add `status` field, default `'prospect'` for inline create) | `src/features/dealers/dealer-form.tsx:1-186` | In-place modification; add the new field next to existing `name`/`address` fields using the same Radix Form + `useTouched()` pattern. |
| `src/app/(app)/dealerships/page.tsx` (modify — status filter pills) | `src/app/(app)/admin/people/page.tsx` (filter pills + DataTable pattern from 0021) | Closest precedent for status-filtered admin tables in the repo. |
| `src/app/(app)/quotes/new/page.tsx` (new — composer) | `src/app/(app)/admin/people/page.tsx` | Page shell + `<Can>` gating + `requireRole(['admin','coach'])` server-side. |
| `src/features/quotes/quote-composer.tsx` (new — client component) | `src/features/dealers/dealer-form.tsx` | Same Radix Form shape from 0024; structured-inputs panel uses the same labeled-text/number-field pattern. Dealer picker still reuses the 0024 Combobox. |
| `src/features/quotes/quote-line-output.tsx` (new — read-only computed-lines table) | `src/features/people/people-columns.tsx` | Closest precedent for a read-only labeled rows + right-aligned numeric column shape. Computed-lines table renders the output of `computeQuote()`; not a TanStack DataTable since rows are derived not interactive. |
| `src/features/quotes/actions.ts` (extend — composer-side actions: `setQuoteInputs`, `setQuoteTax`, `setQuoteDealer`) | `src/features/people/actions.ts` | Long actions file with multiple gated actions; mirror `capabilityClient('quote:edit')` pattern. **Note:** the `quotes` table + `createQuote`/`sendQuote` arrive in 0026 Phase 2; 0035 extends what's there. Each setter recomputes lines + totals and persists both the input snapshot and the computed lines. |

**Conventions referenced:**
- `docs/wiki/conventions.md` — Drizzle ID/audit-column defaults; `db` client connection pool.
- `docs/wiki/auth.md` — capability gates for catalog edit (`lookup:edit`) and quote actions (TBD: `quote:edit` or reuse `lookup:edit`-style for composer surface). Composer page is admin+coach.
- `docs/wiki/security.md` — RLS posture; composer is gated server-side; no public surface introduced by 0035 (the public accept-link is 0026's domain).
- `db-conventions` skill — invoke before writing the `service-items.ts` schema, the `dealers.status` migration, and the v1 catalog seed.

**Note:**
- Phase 1 + 2 are independent and can ship in either order; both must land before Phase 3.
- Phase 3 depends on 0026 Phase 2 (`quotes` table + minimal `createQuote`).
- Phase 4 depends on 0026 Phase 3 (`renderQuotePdf` wired to real data) AND 0026 Phase 4 (`sendQuote` end-to-end). If 0026 Phase 4 hasn't landed when 0035 reaches Phase 4, mark Phase 4 as `Blocked on 0026/4`.

### Phase Checklist

#### Phase 1: Service catalog data model + admin UI

- [x] **Schema decision: `service_items` columns** — `id`, `code` (unique kebab-case key, e.g. `base-event` / `bdc-call`), `label`, `unit` (`flat` / `per-record` / `per-touch` / `per-day` / `range`), `unitPrice` (numeric — single price for `flat`/`per-*`), `unitPriceMin` + `unitPriceMax` (nullable; populated only when `unit='range'`), `description` (nullable), `sortOrder`, `archivable`.
- [x] New schema file `src/lib/db/schema/service-items.ts` per anchor.
- [x] `pnpm db:generate` → `drizzle/0012_round_skrulls.sql` (numbering bumped from sketch — 0007–0011 already taken by intervening MSA/quotes migrations).
- [x] Apply migration via session pooler (per `db-conventions`). Journal `when` bumped to stay monotonic past `0011_slim_wonder_man`.
- [x] **Seed v1 catalog** in `drizzle/0013_seed_service_items.sql` (idempotent `ON CONFLICT (code) DO NOTHING`):
  - `base-event` — flat, $6,900, label "Base Event (includes 500 records)"
  - `additional-contact` — per-record, **$3.00** (OQ #4 resolved 2026-05-11), label "Additional Contact"
  - `bdc-call` — per-touch, $2.25, label "BDC Call"
  - `letter-postage` — per-touch, $2.50, label "Letter / Postage"
  - `digital-record` — per-touch, $0.59, label "Digital (SMS / Email)"
  - `additional-day` — per-day, $995, label "Additional Day with Trainer"
  - `record-retrieval` — range, $100–$400, label "Record Retrieval and Preparation"
  - `travel` — flat (variable; `unit_price` NULL, coach types actual cost at quote time), label "Travel (Hotel / Mileage / Air)"
- [x] **Carry-forward: RLS migration** `drizzle/0014_service_items_rls.sql` (matches `0009_msa_rls.sql` shape — surfaced because pass-1 eval flagged `service_items` would otherwise drop out of the RLS baseline). `service_items` also added to `tests/integration/rls.test.ts`'s `RLS_TABLES`.
- [x] Server Actions in `src/features/services/actions.ts` — `createServiceItem` / `updateServiceItem` / `archiveServiceItem`. Capability gate `lookup:edit`. **Carry-forward from pass-1 Codex Mediums:** `createServiceItem` un-archives by `code` (avoids permanent code lockout after archive — mirrors `createCampaignStyle`); money parsing is string-only against `MONEY_RE = /^(0|[1-9]\d{0,7})(\.\d{1,2})?$/` (no IEEE-754 rounding, caps at `numeric(10,2)`); `sortOrder` capped at `MAX_PG_INTEGER`.
- [x] Admin section in `src/features/services/services-admin.tsx` — anchored on `lookup-admin.tsx`. Render at the bottom of `/admin/lookups` (single page) under heading "Services".
- [x] Vitest: `service-items.test.ts` — 24 cases (CRUD + archive + duplicate-code rejection + un-archive + decimal-precision + numeric/integer overflow). Three new rows in `src/features/__tests__/action-gate-matrix.ts` (admin-only `lookup:edit`) — adds 21 gate-matrix cases. Repo total: 542 → 568.

#### Phase 2: Prospect status on dealers + inline-create flow

- [ ] Migration `drizzle/0009_dealers_add_status.sql`: `pgEnum('dealer_status', ['prospect', 'active'])`; add `status` column to `dealers` with default `'active'` for the backfill of existing rows. **Same migration adds `acquired_via` text column (nullable)** — captures how the dealership found Salesability ("Book Your Event form", "referral", "outbound", "trade show"). Distinct from `audience_sources` (audience-source for a campaign — renamed from `sales_lead_sources` in 0038); see 0037 OQ #7 resolution for the rationale. Free-form text in v1; formalize into a lookup once web intake lands and the values stabilize.
- [ ] Update `src/lib/db/schema/dealers.ts` to add both the `status` column and the `acquiredVia` text column.
- [ ] **Status semantics:** `prospect` = quote drafted, no signed relationship yet. `active` = quote accepted OR coach manually flips. **Archived state is owned by the existing `archivedAt` timestamp from the `archivable` mixin** (resolved Open Question #1) — no `'archived'` enum value. A dealer is archived iff `archivedAt IS NOT NULL`, independent of `status`. The /dealerships filter pills compute "Archived" as `archivedAt IS NOT NULL` regardless of status.
- [ ] Modify `src/features/dealers/dealer-form.tsx` to expose the `status` field (default `'prospect'` for new-dealer inline-create from the composer; default `'active'` from /dealerships) AND the `acquiredVia` text field (nullable, helper text "How did this dealer find us?"). Hidden status field in the inline-create case; `acquiredVia` visible for both entry points.
- [ ] Inline-create entry point: from the quote composer's dealer picker, an "Add new prospect" affordance opens DealerForm in dialog mode with status pre-set to `'prospect'`.
- [ ] `/dealerships` page: add status filter pills (Active / Prospect / Archived); default view is Active. Anchor the filter shape on the people-admin filter bar.
- [ ] Server Action: `convertProspectToActive(dealerId)` — flips status; called automatically when 0026's `acceptQuote` lands, manually from a "Mark active" button on the dealer detail in v1.
- [ ] Vitest: `dealers/actions.test.ts` extended for status transitions + default-status behaviors.

#### Phase 3: Pricing logic + quote composer page (structured-input shape)

**Composer is a calculator, not a line-item picker.** Coach edits a small set of structured inputs (audience, days, per-channel touches, retrieval bracket, travel, notes); the line-item table is **computed read-only output**. Resolved 2026-05-08 after the audience-numbers-change-often + quote-feeds-invoice argument: full-sync auto-derive eliminates the drift class of bug, and the same input-snapshot becomes the contract the invoice recomputes against (see Open Question #2 resolution).

- [ ] **Quote-input shape:**
  ```ts
  type QuoteInputs = {
    audienceSize: number;          // default 500; drives Additional Contacts qty
    eventDays: number;             // default 1; drives Additional Day qty (= max(0, days-1))
    bdcCallCount: number;          // default 0
    letterCount: number;           // default 0
    digitalCount: number;          // default 0
    recordRetrievalAmount: number; // 0 / 100 / 200 / 300 / 400 (or coach-typed within range)
    travelAmount: number;          // 0 default; coach types actual cost
    travelNotes: string;           // optional — Hotel/Mileage/Air breakdown freeform
    quoteNotes: string;            // optional — additional notes rendered on PDF
  };
  ```
- [ ] New `src/lib/quotes/pricing.ts`:
  - `computeQuote(inputs: QuoteInputs, catalog: ServiceItem[]): { lines: ComputedLine[]; subtotal: number; tax: number; total: number }` — pure function. Walks the catalog, applies the input rules:
    - `base-event` always present, qty 1
    - `additional-contact` qty = `max(0, audienceSize - 500)`; line omitted if 0
    - `additional-day` qty = `max(0, eventDays - 1)`; line omitted if 0
    - `bdc-call` / `letter-postage` / `digital-record` qty = corresponding count input; line omitted if 0
    - `record-retrieval` line emitted iff `recordRetrievalAmount > 0`; unit price = the chosen amount (range item)
    - `travel` line emitted iff `travelAmount > 0`; unit price = `travelAmount` (variable)
  - `tax`: 0035 returns 0 by default; coach can override via the `tax` field on the quote (final tax decision deferred to 0026 Open Question on NS HST vs buyer-province).
  - All inputs validated: `Number.isFinite`, `>= 0`, integer for counts, currency-cents-or-dollars consistent with `service_items.unitPrice` storage.
  - **No coach-side line-item editing.** `ComputedLine[]` is output; if pricing changes are needed, the inputs change.
- [ ] Vitest `pricing.test.ts`: ≥ 15 cases — base-only, audience > 500, multi-channel mix, multi-day event, record-retrieval present/absent, travel present/absent, all-zero counts, NaN/Infinity guards, negative inputs rejected, very large numbers, catalog rows missing/archived.
- [ ] New page `src/app/(app)/quotes/new/page.tsx` — gated by `requireRole(['admin', 'coach'])`. Reads `?campaignId=...` and/or `?dealerId=...` from query string; preloads dealer + campaign + catalog.
- [ ] New client component `src/features/quotes/quote-composer.tsx`:
  - **Header:** dealer picker (Combobox; "Add new prospect" affordance opens inline-create dialog from Phase 2). Below: campaign linkage (read-only if `campaignId` passed; campaign picker otherwise).
  - **Inputs panel** (left or top):
    - Audience size (number input)
    - Event days (number input)
    - Per-channel touches: BDC calls / Letters / Digital records (three number inputs)
    - Record retrieval: radio for $0 / $100 / $200 / $300 / $400 (or freeform within range)
    - Travel: dollar input + optional notes textarea
    - Quote notes (textarea — renders on PDF)
  - **Output panel** (right or below): computed line-items table (read-only, with `ⓘ auto` badge on each row), subtotal, tax (coach can override the dollar amount only), total. Audience-overage and additional-day rows appear/disappear live as inputs change.
  - **No `+ Add line item` button in v1** — the catalog is the menu and the inputs are the only knobs. Custom one-off lines are a v2 add (Open Question #8).
  - **Save Draft** button — calls 0026's `createQuote` with the input snapshot + computed lines + `status='draft'`.
- [ ] Composer-side Server Actions in `src/features/quotes/actions.ts`: `setQuoteInputs(quoteId, inputs: Partial<QuoteInputs>)` (single setter — coalesces all input edits), `setQuoteTax(quoteId, amount)`, `setQuoteDealer(quoteId, dealerId)`. Capability gate `quote:edit`. Each setter recomputes lines + totals server-side and persists them alongside the inputs. **No MSA check on draft editing** (per [0037](../0037-commercial-spine-msa/plan.md)) — coaches can compose a Quote for any Client whether they have an active MSA or not; the MSA gate lives on Phase 4's Send action.
- [ ] **Data-model handoff to 0026 Phase 2:** the `quotes` table gains an `inputs` jsonb column storing the typed `QuoteInputs` snapshot, plus the `lineItems` jsonb (computed output). Both are persisted on every input edit so the row is always self-consistent. **Note in 0026 plan:** Phase 2's table sketch needs the `inputs` column added before 0035 Phase 3 starts.
- [ ] Entry-point button on `src/features/dealers/dealers-columns.tsx` (per-row "Quote" action) — links to `/quotes/new?dealerId=<id>`.
- [ ] Entry-point button on the campaign-detail dialog (today's `EventDetail` modal in `/production`) — links to `/quotes/new?campaignId=<id>`.

#### Phase 4: PDF preview pane + send wiring

> **Commercial-spine alignment ([0037](../0037-commercial-spine-msa/plan.md), 2026-05-11):** the Send action **must check for an active MSA on the Client** before committing to the send path. Two routes: (a) Client has an active MSA → standard `sendQuote` (PDF-only email, public accept link); (b) Client has no active MSA (or it's expired/terminated) → route into the bundled MSA + first-Quote e-sig envelope (Dropbox Sign, two documents) — owned by 0025 Phase 7.2. **Draft editing (`setQuoteInputs`, `setQuoteTax`, `setQuoteDealer`) does NOT require an MSA** — the MSA gate is on Send only. See [`docs/wiki/commercial-spine.md`](../../wiki/commercial-spine.md) for the full lifecycle.

- [ ] **Depends on:** 0026 Phase 3 (`renderQuotePdf` wired to real `quotes` row) AND 0026 Phase 4 (`sendQuote` end-to-end). Routing into the bundled-envelope path also depends on 0025 Phase 7.2 (`sendMsaPlusQuoteEnvelope` or equivalent).
- [ ] PDF preview pane in `quote-composer.tsx`: live render via Server Action that returns the GCS-stored PDF URL (or a fresh render if the quote is in `draft` and hasn't been sent). Use `<iframe src=...>` for v1.
- [ ] Send button decision: before firing, query the Client's MSA state. If an active MSA exists → fire 0026's `sendQuote`. If none → fire 0025 P7.2's `sendMsaPlusQuoteEnvelope` (bundles MSA + Quote PDF into one Dropbox Sign envelope). On success, redirect to a success view + show "Sent at YYYY-MM-DD HH:MM" + Resend / Dropbox Sign envelope ID.
- [ ] Confirm dialog before send (shows recipient email + line-item count + total + whether this is a bundled MSA-included send or a plain Quote send).
- [ ] After send, the composer becomes read-only (status flips `draft → sent`); coach can still revoke via a future "Resend" action that bumps the revision.

#### Phase 5: Tests + smoke verification

- [ ] `pnpm test` — pricing module + service-items CRUD + dealer status transitions + composer Server Actions. Aim for ≥ 25 new test cases.
- [ ] `pnpm tsc --noEmit` clean.
- [ ] `pnpm lint` clean.
- [ ] Smoke (web-test): `goto /admin/lookups`; section "Services" lists 8 v1 items with prices; `Add` form present.
- [ ] Smoke (web-test): `goto /dealerships`; status filter pills present (Active / Prospect / Archived); default view Active.
- [ ] Smoke (web-test): `goto /quotes/new`; composer renders dealer picker + audience input + line-items table + total panel.
- [ ] Smoke (web-test): click "Add new prospect" in the dealer picker; DealerForm dialog opens with status pre-set to "Prospect".
- [ ] Update `docs/wiki/data-model.md` with the new `service_items` table + `dealers.status` column.
- [ ] Update `docs/wiki/architecture.md` quote-composer section.

## Open questions

- ~~**#1 — `dealers.status='archived'` vs `archivable.archivedAt`:**~~ **Resolved 2026-05-08: `archivedAt` is the source of truth for archived state.** `status` enum is `'prospect' | 'active'` only — no `'archived'` value. A dealer is archived iff `archivedAt IS NOT NULL`, regardless of `status`. The /dealerships filter pills compute: Active = `status='active' AND archivedAt IS NULL`; Prospect = `status='prospect' AND archivedAt IS NULL`; Archived = `archivedAt IS NOT NULL` (status ignored). Keeps the existing `archivable` mixin authoritative and avoids the "is the dealer archived or just status-archived" ambiguity.
- ~~**#2 — Audience overage UX:**~~ **Resolved 2026-05-08: full-sync auto-derive.** Composer pivoted from line-item-picker to structured-input calculator (see Phase 3). Audience size is the source of truth; the Additional Contacts line is computed read-only from `max(0, audienceSize-500)`. Same logic generalizes to per-channel counts and event days — every per-unit qty is derived from a coach input, never free-form. Drives the quote→invoice contract: at send time, the input snapshot is locked on the `quotes` row and the invoice recomputes from the same inputs against the same catalog → totals always reconcile.
- **#3 — Capability for composer-side actions:** reuse `lookup:edit` (already gates the catalog admin) or introduce a new `quote:edit` capability? **Working assumption: new `quote:edit` capability** scoped to admin + coach so the catalog admin (`lookup:edit`, admin-only) is independent. Adds one row to the capability matrix.
- ~~**#4 — Additional Contact price:**~~ **Resolved 2026-05-11: $3.00 per record.** Seed migration writes `additional-contact` with `unit='per-record'`, `unitPrice='3.00'`. Round, easy mental math; comfortable add-on uplift on a $6,900-per-500 base. Revisit when pricing data accumulates.
- **#5 — Travel sub-fields:** single freeform "Travel" line where the coach types one dollar amount + a note (Hotel/Mileage/Air mix), or three separate lines (Hotel, Mileage, Air)? **Working assumption: one line with a notes field** — simpler v1, easier to compute, and dealer-facing PDF shows a clean "Travel" row.
- **#6 — Composer entry-point on campaigns:** today's `EventDetail` modal lives in `/production`; does the "Create Quote" button live there, or does the modal need to upgrade into a full `/campaigns/[id]` page first? **Working assumption: button in the existing modal for v1**; full campaign-detail page is a separate chunk.
- **#7 — Quote ↔ campaign relationship:** can one campaign have multiple quotes (different revisions)? Can a quote exist without a campaign (pure-prospect lead)? **Working assumption: campaign-id is nullable on quotes** (pre-campaign quotes are valid); revisions follow 0026's `previousQuoteId` chain.
- **#8 — Custom one-off lines (v2):** the structured-input shape rules out free-form custom line items in v1 (every line is derived from a typed input). What flow handles a one-off case — a special discount, a custom service the catalog doesn't carry, a line-item override negotiated with a specific dealer? **Working assumption (v2): expand the catalog or add a `customLines: Array<{label, amount}>` array to `QuoteInputs`.** Until v2, coaches use the `quoteNotes` textarea to flag exceptions and adjust the `tax` override field for net-effect pricing changes.
