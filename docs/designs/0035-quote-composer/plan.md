# Quote composer + service catalog + prospect dealers — 2026-05-08

**Started:** 2026-05-08

Sub-plan of [`../0025-quote-to-payment/plan.md`](../0025-quote-to-payment/plan.md) (sibling of [`../closed/0026-quote-pdf/plan.md`](../closed/0026-quote-pdf/plan.md)). Stand up the **composer side** of the Quote loop: a coach picks line items from a DB-backed service catalog, edits quantities, sees a live total, optionally creates a prospect dealer inline, previews the PDF, and sends. Done = a coach can build a quote end-to-end starting from either a campaign-detail page or a dealer page, without leaving the app, against either an existing dealer or a freshly-created prospect.

This chunk does **not** own the `quotes` table or `renderQuotePdf` or the send/accept flow — those are 0026 Phases 2–4. 0035 is the **layer that calls into them.** Sequencing: 0026 Phase 2 (table + bare-bones actions) must ship before 0035 Phase 3; 0026 Phase 3 (PDF render wired to real data) must ship before 0035 Phase 4's preview pane lights up; 0026 Phase 4 (send + accept route) must ship before 0035 Phase 4's "Send" button works.

## Progress Tracker

| Phase | Status | Commit |
|-------|--------|--------|
| 1: Service catalog data model + admin UI | Done | `bfaeff7` |
| 2: Prospect status on dealers + inline-create flow | Done | `dcc80bc` |
| 3: Pricing logic + quote composer page | Done | `0a17124` |
| 4: PDF preview pane + send wiring | Done | `fea4d82` |
| 5: Tests + smoke verification | Done | `3f9edbe` |

**Overall Progress:** 100% (5/5 phases complete)

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
| `src/features/quotes/actions.ts` (extend P4 — `previewQuotePdf`) | `src/features/quotes/actions.ts:504` (`sendQuote`) | Same load-quote+dealer+validatePersistedLines+renderQuotePdf path as `sendQuote`, minus the lifecycle UPDATE / GCS upload / email-send side effects. Returns `{ ok: true, dataUrl }` where `dataUrl` is `data:application/pdf;base64,…`. Capability gate `quote:edit`. |
| `src/features/quotes/quote-composer.tsx` (extend P4 — Preview + Send buttons + two `Dialog`s) | `src/features/quotes/quote-composer.tsx:70` (current shape) + `src/components/ui/dialog.tsx` (Radix wrapper) | Add an `isEdit` Preview button that loads a data-URL PDF into an iframe modal; add a draft-only Send button that opens a confirm modal and fires `sendQuote`. `router.refresh()` after send picks up the read-only state already wired at `quote-composer.tsx:81`. |
| `src/features/__tests__/action-gate-matrix.ts` (extend — `previewQuotePdf` row) | `:280` (`sendQuote` row) | Single new row, `quote:edit` admit, same `fd()` factory. Adds 7 gate-matrix cases (one per role). |

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

- [x] Migration `drizzle/0015_cultured_tinkerer.sql`: `pgEnum('dealer_status', ['prospect', 'active'])`; `status` column to `dealers` with default `'active'` for the backfill (numbering bumped from sketch — sequence advanced past `0008` via intervening work).
- [x] Same migration adds `acquired_via` text column (nullable) — free-form text in v1; formalize into a lookup once web intake lands and the values stabilize.
- [x] Update `src/lib/db/schema/dealers.ts` — both `status` (pgEnum, NOT NULL DEFAULT 'active') and `acquiredVia` columns + status index.
- [x] **Status semantics:** `prospect` = quote drafted, no signed relationship yet. `active` = quote accepted OR admin manually flips. **Archived state is owned by the existing `archivedAt` timestamp from the `archivable` mixin** (resolved Open Question #1) — no `'archived'` enum value. A dealer is archived iff `archivedAt IS NOT NULL`, independent of `status`. The /dealerships filter pills compute "Archived" as `archivedAt IS NOT NULL` regardless of status.
- [x] Modify `src/features/dealers/dealer-form.tsx` — expose the `status` field (default `'active'` from /dealerships, hidden + value=`'prospect'` only when `defaultStatus='prospect'` passed in **create** mode — edit mode always renders the visible select per pass-1 Codex Low #3) AND the `acquiredVia` text field (nullable, helper text).
- [ ] ~~Inline-create entry point: from the quote composer's dealer picker, an "Add new prospect" affordance opens DealerForm in dialog mode with status pre-set to `'prospect'`.~~ **Deferred to Phase 3.** The composer doesn't exist yet (it's Phase 3 scope); the DealerForm now accepts the `defaultStatus` prop that Phase 3 will wire up via the composer's dealer picker. The form itself is ready; only the entry-point button + dialog plumbing remain for P3.
- [x] `/dealerships` page: status filter pills (Active / Prospect / Archived) with per-pill counts; default Active. New `loadDealersIncludingArchived()` query feeds this surface; other call sites (`loadDealers`) still filter archived.
- [x] Server Action: `convertProspectToActive(dealerId)` — guarded UPDATE keyed on `(id, status='prospect', archivedAt IS NULL)`; idempotent no-op on already-active or archived rows; emits `dealer.activated` audit on transition. Wired via "Mark active" button on prospect rows.
- [x] **Carry-forward:** audit enum gained `dealer.activated` — migration `drizzle/0016_flat_typhoid_mary.sql` (`ALTER TYPE audit_action ADD VALUE 'dealer.activated' BEFORE 'campaign.cancelled'`).
- [x] **Carry-forward from pass-1 Codex Mediums:** `updateDealer` rewritten with patch-style parsing (`status` and `acquiredVia` are omitted from SET when absent from FormData, preventing clobber of a concurrent `convertProspectToActive` flip) and a guarded UPDATE atomic with `archivedAt IS NULL` (closes archive race). Edit button hidden on archived rows. `formData.has('acquiredVia')` correctly distinguishes absent vs empty-submitted (`null` clears the column only when explicitly submitted empty).
- [x] Vitest: `dealers/actions.test.ts` (new, 16 cases) — createDealer status defaults + acquiredVia persistence + invalid-status rejection; updateDealer patch semantics + not-found path + clear-acquiredVia; convertProspectToActive happy-path + idempotency on already-active + idempotency on archived + invalid-id. `action-gate-matrix.ts` gains `convertProspectToActive` row (admin-only `dealer:edit`).

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
- [x] New `src/lib/quotes/pricing.ts` — `computeQuote(inputs, catalog, taxOverride=0)` pure function. Implements the locked rules (base-event always; additional-contact/day; bdc/letter/digital per-touch; record-retrieval range-bound; travel variable). **Carry-forward from pass-2 Codex:** range-bound items fail closed when catalog row has null/non-finite `unitPriceMin/Max`. `validateQuoteInputs` throws `QuoteInputsError` on NaN/Infinity/negatives/non-integer counts/oversized notes; sanity caps `MAX_AUDIENCE=1M`, `MAX_DAYS=365`, `MAX_TOUCHES=1M`, `MAX_DOLLARS=9_999_999`. `roundCents` helper.
- [x] Vitest `pricing.test.ts` — 25 cases covering all rules + edge cases + range-bound enforcement.
- [x] New page `src/app/(app)/quotes/new/page.tsx` — gated by `assertCan('quote:edit')` (admin || coach per capabilities.ts). Reads `?campaignId=` / `?dealerId=` from query string; preloads dealers + catalog.
- [x] New client component `src/features/quotes/quote-composer.tsx` — two-column layout: header (dealer Combobox + optional campaign label) + inputs panel + computed line-items table + Save Draft.
  - [ ] ~~"Add new prospect" affordance in dealer picker~~ **Deferred.** Combobox primitive doesn't support an inline-add button cleanly; prospect dealers added via /dealerships show up in the picker labelled `(prospect)`. Re-visit when a richer picker component lands (post-0035) — the DealerForm already accepts `defaultStatus='prospect'` for when this affordance is wired.
- [x] Composer-side Server Actions: `setQuoteInputs` (full-snapshot setter; recomputes lines + totals server-side; guarded UPDATE returning + race-classification per pass-1 Codex High), `setQuoteTax` (overrides tax, recomputes total; same race-classification), `setQuoteDealer` (verifies new dealer is active inside a transaction with `FOR UPDATE` on the dealer row per pass-1 Codex M4). Capability gate `quote:edit`. **Carry-forward from pass-1+2+3 Codex Mediums:** `parseQuoteInputs` canonicalizes field-by-field (drops unknown JSON keys); `parseTax` rejects `>MAX_DOLLARS` and `>2-decimal-place` inputs to keep all three persistence paths writing the same cents.
- [x] **Data-model handoff to 0026 Phase 2:** already in place from 0026 P2 (the `quotes` table has `inputs` jsonb NOT NULL + `lineItems` jsonb default '[]'). No additional migration needed.
- [x] Entry-point button on `src/features/dealers/dealers-columns.tsx` — per-row Quote link to `/quotes/new?dealerId=<id>`, gated `quote:edit`, hidden on archived rows.
- [x] Entry-point button on the campaign-detail dialog (`src/app/(app)/calendar/event-detail.tsx`) — "Create Quote" button next to Cancel Campaign, links to `/quotes/new?campaignId=<id>&dealerId=<dealerId>`, gated `quote:edit`.
- [x] Vitest extended: composer-action coverage (`createQuote` Save-Draft path, all three setters, race-classification on the setters, JSON-canonicalization, range-bound enforcement, tax decimal-precision). Three new rows in `action-gate-matrix.ts` (admin || coach for each setter). Repo total: 591 → 655.

#### Phase 4: PDF preview pane + send wiring

> **Commercial-spine alignment ([0037](../closed/0037-commercial-spine-msa/plan.md), 2026-05-11):** the Send action **must check for an active MSA on the Client** before committing to the send path. Two routes: (a) Client has an active MSA → standard `sendQuote` (PDF-only email, public accept link); (b) Client has no active MSA (or it's expired/terminated) → route into the bundled MSA + first-Quote e-sig envelope (Dropbox Sign, two documents) — owned by 0025 Phase 7.2. **Draft editing (`setQuoteInputs`, `setQuoteTax`, `setQuoteDealer`) does NOT require an MSA** — the MSA gate is on Send only. See [`docs/wiki/commercial-spine.md`](../../wiki/commercial-spine.md) for the full lifecycle.

> **MSA-gate deferral (2026-05-12):** the bundled-envelope path (route (b) above) lives in 0025 Phase 7.2 which is **not yet scaffolded**, and there is no in-app surface to create an MSA today either. Shipping route (a) only would block every Send in dev (no MSA rows exist). For Phase 4 v1, the Send button calls `sendQuote` directly with no MSA gate; the bundled-envelope routing returns when 0025 P7.2 lands. This matches the narrower scope captured in `CURRENT.md` for 0035 P4 ("Send button on the composer that calls `sendQuote`").

- [x] **Depends on:** 0026 Phase 3 (`renderQuotePdf` wired to real `quotes` row) AND 0026 Phase 4 (`sendQuote` end-to-end). ~~Routing into the bundled-envelope path also depends on 0025 Phase 7.2 (`sendMsaPlusQuoteEnvelope` or equivalent).~~ MSA-gate deferred per above. 0026 P3/P4 shipped (closed 2026-05-12).
- [x] PDF preview pane in `quote-composer.tsx`: live render via Server Action `previewQuotePdf` that returns a `data:application/pdf;base64,…` URL (works for both `draft` and `sent`; re-renders from the persisted `lineItems`/`subtotal`/`tax`/`total` snapshot so the iframe never drifts from what `sendQuote` would emit). Use `<iframe src=...>` for v1. Preview is opt-in (button-triggered modal) — not every input edit re-renders. **Shipped:** `previewQuotePdf` in `src/features/quotes/actions.ts` (mirrors `sendQuote`'s load+validate+render path, no side effects) + `PreviewDialog` in `quote-composer.tsx` (Radix `Dialog` with `max-w-4xl` + `h-[70vh]` iframe).
- [x] Send button on `/quotes/[id]` (edit mode, draft only) fires `sendQuote` directly. ~~On success, redirect to a success view + show "Sent at YYYY-MM-DD HH:MM" + Resend / Dropbox Sign envelope ID.~~ Simpler: `router.refresh()` re-hydrates the composer in read-only mode; the page header's status pill flips to `sent` and the existing read-only banner surfaces the new status. No separate success route. **Shipped:** the Send button only renders for `isEdit && status === 'draft'` and is disabled when `resolveQuoteRecipient` failed server-side (no customer contact / no primary email).
- [x] Confirm dialog before send (shows recipient email + line-item count + total). ~~+ whether this is a bundled MSA-included send or a plain Quote send.~~ MSA-bundled distinction removed per deferral above. **Shipped:** `ConfirmSendDialog` in `quote-composer.tsx`.
- [x] After send, the composer becomes read-only (status flips `draft → sent`); coach can still revoke via a future "Resend" action that bumps the revision. **Shipped:** `router.refresh()` after a successful `sendQuote` reloads the page; the existing `isReadOnly = isEdit && initial.status !== 'draft'` line at `quote-composer.tsx:84` disables the fieldset and hides Save / Send.

#### Phase 5: Tests + smoke verification

- [x] `pnpm test` — pricing module + service-items CRUD + dealer status transitions + composer Server Actions. Aim for ≥ 25 new test cases. **Green from P1–P3 ship: 542 → 655 (+113 cases) covering pricing rules, range-bound enforcement, decimal-precision, overflow caps, race-classification on all three composer setters, JSON canonicalization, tax canonicalization, gate-matrix coverage for the new `quote:edit` + `lookup:edit` + `dealer:edit` rows.**
- [x] `pnpm tsc --noEmit` clean. **Verified green at each P1/P2/P3 eval pass.**
- [x] `pnpm lint` clean. **Verified green at each P1/P2/P3 eval pass.**
- [x] Smoke (web-test): `goto /admin/lookups`; section "Services" lists 8 v1 items with prices; `Add` form present. **Verified green via web-test in 0035 P1 eval (pass-2).**
- [x] Smoke (web-test): `goto /dealerships`; status filter pills present (Active / Prospect / Archived); default view Active. **Verified green via web-test in 0035 P2 eval (pass-2).**
- [x] Smoke (web-test): `goto /quotes/new`; composer renders dealer picker + audience input + line-items table + total panel. **Verified green via web-test in 0035 P3 eval (pass-3).**
- [ ] ~~Smoke (web-test): click "Add new prospect" in the dealer picker; DealerForm dialog opens with status pre-set to "Prospect".~~ **Deferred** — the inline "Add new prospect" affordance was itself deferred in Phase 3 (Combobox primitive doesn't support inline-add cleanly); prospects are added via `/dealerships` and picked up in the composer labelled `(prospect)`. DealerForm already accepts `defaultStatus='prospect'` for when the affordance is wired in a future chunk.
- [x] Update `docs/wiki/data-model.md` with the new `service_items` table + `dealers.status` column. **Landed 2026-05-12: tables-at-a-glance updated, `dealers` section grew a "Lifecycle columns" subsection, new `service_items` section between MSA and Lookup tables, STAR vocab preamble + mixins reference + audit-columns paragraph all picked up the new entities.**
- [x] Update `docs/wiki/architecture.md` quote-composer section. **Landed 2026-05-12: new "Quote composer — calculator, not a line-item picker" subsection under Patterns covering the pricing module, catalog, composer Server Actions, Send-time MSA gate, entry points, and deferred inline-add-prospect affordance.**

## Open questions

- ~~**#1 — `dealers.status='archived'` vs `archivable.archivedAt`:**~~ **Resolved 2026-05-08: `archivedAt` is the source of truth for archived state.** `status` enum is `'prospect' | 'active'` only — no `'archived'` value. A dealer is archived iff `archivedAt IS NOT NULL`, regardless of `status`. The /dealerships filter pills compute: Active = `status='active' AND archivedAt IS NULL`; Prospect = `status='prospect' AND archivedAt IS NULL`; Archived = `archivedAt IS NOT NULL` (status ignored). Keeps the existing `archivable` mixin authoritative and avoids the "is the dealer archived or just status-archived" ambiguity.
- ~~**#2 — Audience overage UX:**~~ **Resolved 2026-05-08: full-sync auto-derive.** Composer pivoted from line-item-picker to structured-input calculator (see Phase 3). Audience size is the source of truth; the Additional Contacts line is computed read-only from `max(0, audienceSize-500)`. Same logic generalizes to per-channel counts and event days — every per-unit qty is derived from a coach input, never free-form. Drives the quote→invoice contract: at send time, the input snapshot is locked on the `quotes` row and the invoice recomputes from the same inputs against the same catalog → totals always reconcile.
- **#3 — Capability for composer-side actions:** reuse `lookup:edit` (already gates the catalog admin) or introduce a new `quote:edit` capability? **Working assumption: new `quote:edit` capability** scoped to admin + coach so the catalog admin (`lookup:edit`, admin-only) is independent. Adds one row to the capability matrix.
- ~~**#4 — Additional Contact price:**~~ **Resolved 2026-05-11: $3.00 per record.** Seed migration writes `additional-contact` with `unit='per-record'`, `unitPrice='3.00'`. Round, easy mental math; comfortable add-on uplift on a $6,900-per-500 base. Revisit when pricing data accumulates.
- **#5 — Travel sub-fields:** single freeform "Travel" line where the coach types one dollar amount + a note (Hotel/Mileage/Air mix), or three separate lines (Hotel, Mileage, Air)? **Working assumption: one line with a notes field** — simpler v1, easier to compute, and dealer-facing PDF shows a clean "Travel" row.
- **#6 — Composer entry-point on campaigns:** today's `EventDetail` modal lives in `/production`; does the "Create Quote" button live there, or does the modal need to upgrade into a full `/campaigns/[id]` page first? **Working assumption: button in the existing modal for v1**; full campaign-detail page is a separate chunk.
- **#7 — Quote ↔ campaign relationship:** can one campaign have multiple quotes (different revisions)? Can a quote exist without a campaign (pure-prospect lead)? **Working assumption: campaign-id is nullable on quotes** (pre-campaign quotes are valid); revisions follow 0026's `previousQuoteId` chain.
- **#8 — Custom one-off lines (v2):** the structured-input shape rules out free-form custom line items in v1 (every line is derived from a typed input). What flow handles a one-off case — a special discount, a custom service the catalog doesn't carry, a line-item override negotiated with a specific dealer? **Working assumption (v2): expand the catalog or add a `customLines: Array<{label, amount}>` array to `QuoteInputs`.** Until v2, coaches use the `quoteNotes` textarea to flag exceptions and adjust the `tax` override field for net-effect pricing changes.
