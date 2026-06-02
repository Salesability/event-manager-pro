# Quote Line Items Table (with Price Overrides) — Plan

**Intent:** [`intent.md`](intent.md)
**Started:** 2026-05-15
**Supersedes:** [`0052-quote-coach-price-override`](../0052-quote-coach-price-override/plan.md) — JSONB-only override approach.

> **Superseded + closed 2026-06-01** — never started (0/7 phases, no commits). Folded into [`0062-quote-line-item-picker`](../0062-quote-line-item-picker/plan.md), which absorbs this chunk's `quote_line_items` table migration as the backing store for the new SKU **picker** composer (this chunk kept the calculator; 0062 reverses that). Body below is kept as the relational-normalization design history; the live work continues in 0062.

## Progress Tracker

| Phase | Status | Commit |
|-------|--------|--------|
| 1: Schema + backfill migration — `quote_line_items` table, populated from JSONB | Pending | - |
| 2: Read path — `queries.ts` rehydrates `ComputedLine[]` from the table (JSONB still present) | Pending | - |
| 3: Write path — `setQuoteInputs` delete-and-inserts the table; `hashLineItems` re-roots | Pending | - |
| 4: Override columns wired in UI — composer Summary toggle + per-line editable Unit cell | Pending | - |
| 5: Send / PDF — render `effectiveUnit(line)` from table rows | Pending | - |
| 6: Drop `quotes.line_items` JSONB column — second migration, retire defensive paths | Pending | - |
| 7: Tests + smoke verification + wiki update | Pending | - |

This chunk converts `quotes.lineItems` from a JSONB snapshot into a first-class `quote_line_items` table, baking in the per-line override columns as it goes — superseding the 0052 JSONB-only override plan. "Done" looks like: the table is the only line-item source of truth, the composer Summary section has a working override toggle bound to `override_unit_price`, and the prospect-facing PDF emits the tuned unit prices via `effectiveUnit(line) = override_unit_price ?? unit_price`. The migration is two-step inside this chunk (create+backfill in Phase 1; drop JSONB column in Phase 6) so consumers can be switched over in between without writing to two places permanently.

## Code Anchors

| New code | Anchor (`path:line`) | Why this anchor |
|----------|---------------------|-----------------|
| `src/lib/db/schema/quote-line-items.ts` (new table module) | `src/lib/db/schema/dealer-contacts.ts:1-53` | Closest existing child-of-parent table: FK + cascade + composite-unique-index + `actors`/`timestamps` mixin shape |
| Drizzle migration `drizzle/0022_quote_line_items_table.sql` (CREATE TABLE + backfill from JSONB) | `drizzle/0021_rename_provider_document_id.sql:1-17` | Most recent custom-written migration in repo; same multi-line comment-header prose pattern |
| Drizzle migration `drizzle/0023_drop_quotes_line_items_jsonb.sql` (DROP COLUMN at chunk end) | `drizzle/0021_rename_provider_document_id.sql:1-17` | Same custom-written ALTER TABLE shape; comment names the upstream chunk + safety justification |
| `src/lib/db/schema/index.ts` re-export of `quoteLineItems` | `src/lib/db/schema/index.ts` (existing re-exports) | Trivial — match the file's existing pattern |
| `loadQuoteForCompose` rehydration with `quote_line_items` join (`src/features/quotes/queries.ts`) | `src/features/quotes/queries.ts:55-120` (existing single-row `select` shape) | Same module, same return type (`ComputedLine[]`); add a sibling select against the new table and map rows to existing shape |
| `setQuoteInputs` delete-and-insert path (`src/features/quotes/actions.ts`) | `src/features/quotes/actions.ts:293-420` (existing JSONB write) | Same action, same transaction; the patch object swaps JSONB write for table-row write |
| `hashLineItems` over table rows (`src/features/quotes/actions.ts`) | `src/features/quotes/actions.ts:164-170` (existing JSONB hash) | Same module, same intent (no-op-save digest); just hash the rehydrated rows in deterministic order instead of the JSONB blob |
| Composer override toggle + per-line input (`src/features/quotes/quote-composer.tsx`) | `src/features/quotes/quote-composer.tsx:655-669` (existing `taxOverride` input) | Same Summary table, same per-quote-override pattern, same number-input shape — single closest sibling |
| PDF / `sendQuote` `effectiveUnit` switch (`src/features/quotes/actions.ts` + PDF renderer) | `src/features/quotes/actions.ts:745-851` (existing `sendQuote` PDF feed) | Same send path; one preference rule (`override_unit_price ?? unit_price`) flows into the same renderer |
| `effectiveUnit()` helper + `recomputeTotalsWithOverrides()` (`src/lib/quotes/pricing.ts`) | `src/lib/quotes/pricing.ts:46-55` (existing `ComputedLine`) | Same module, same JSONB-row shape (now mirroring the table column shape) |

**Conventions referenced:**
- `db-conventions` skill — Drizzle + Supabase Postgres rules (IDs, audit columns, direct-vs-pooled connection for migrations, backfill patterns). Invoke before writing Phase 1 + Phase 6.
- `docs/wiki/data-model.md` — Phase 7 updates this page: new `quote_line_items` table section + retire the `quotes.lineItems` JSONB callout.
- `CLAUDE.md` → **Conventions** — mutations are Server Actions, not route handlers (no change here, but the Phase 3 rewrite stays inside `setQuoteInputs`).

**Overall Progress:** 0% (0/7 phases complete)

**Note:**
- Phases 1–3 are the relational rebuild; Phases 4–5 are the override feature (which is what makes this chunk supersede 0052); Phase 6 retires the JSONB column; Phase 7 is verification + wiki.
- Backfill in Phase 1 uses `INSERT … SELECT … FROM quotes, jsonb_array_elements(line_items) WITH ORDINALITY` — single-statement, idempotent against the empty `[]` default, and safe to re-run because Phase 1 creates a *new* table (no prior rows).
- The JSONB column stays during Phases 2–5 so the read path can be cut over without a write-side big-bang. Phase 3 writes to the table only (JSONB stops being written); Phase 6 drops the now-orphaned column.
- No prod-data concern for the override columns themselves — they're NULL on backfilled rows, which is correct (no quote has been override-tuned yet).

### Phase Checklist

#### Phase 1: Schema + backfill migration
- [ ] Write `src/lib/db/schema/quote-line-items.ts` — `pgTable('quote_line_items', { id, quoteId (FK cascade), code, label, unit, qty, unitPrice (numeric(10,2)), overrideUnitPrice (numeric(10,2), nullable), lineTotal (numeric(12,2)), displayOrder (integer), ...timestamps, ...actors })`
- [ ] Add `uniqueIndex('quote_line_items_quote_id_code_unique').on(quoteId, code)`
- [ ] Add `index('quote_line_items_quote_id_idx').on(quoteId)`
- [ ] Re-export from `src/lib/db/schema/index.ts`
- [ ] Generate Drizzle migration (`pnpm drizzle-kit generate`) → review the generated `0022_*.sql`
- [ ] Hand-extend the migration with a backfill statement: `INSERT INTO quote_line_items (quote_id, code, label, unit, qty, unit_price, line_total, display_order, created_at, updated_at) SELECT q.id, elem->>'code', elem->>'label', elem->>'unit', (elem->>'qty')::int, (elem->>'unitPrice')::numeric, (elem->>'lineTotal')::numeric, ord, now(), now() FROM quotes q, jsonb_array_elements(q.line_items) WITH ORDINALITY AS t(elem, ord)`
- [ ] Run migration against a fresh local DB; spot-check that row counts match `SELECT sum(jsonb_array_length(line_items)) FROM quotes` pre-migration
- [ ] Unit test (schema): drizzle schema introspection — table exists, columns + indices match

#### Phase 2: Read path — rehydrate from table
- [ ] In `src/features/quotes/queries.ts`, after the main `quotes` select, run a sibling select against `quote_line_items` ordered by `display_order`
- [ ] Map table rows → existing `ComputedLine[]` return shape (with `overrideUnitPrice` now populated from the column)
- [ ] Leave the JSONB column read-path intact for one phase — it stays as the safety-net source until Phase 3 lands
- [ ] Update `loadQuoteSendHistory` and any other consumer that reads `lineItems` from a quote row
- [ ] Unit test: `queries.test.ts` covers (i) table-rows present (returned), (ii) table empty + JSONB has rows (still returns JSONB-derived shape — covers the in-between state during the chunk; tightens in Phase 6)

#### Phase 3: Write path — `setQuoteInputs` against the table
- [ ] In `src/features/quotes/actions.ts`, swap the JSONB-write block (around `:293-420`) for a transaction that: optimistic-locks `quotes.updatedAt` → `DELETE FROM quote_line_items WHERE quote_id = ?` → `INSERT … SELECT` from the recomputed `ComputedLine[]` (with `overrideUnitPrice` merged in from the new `overrides` form payload)
- [ ] Continue writing `quotes.subtotal/tax/total` in the same transaction (unchanged shape, override-aware totals)
- [ ] Stop writing `quotes.lineItems` JSONB (the column is still there; we just don't mutate it). Pre-existing rows keep their JSONB until Phase 6 drops the column
- [ ] `hashLineItems` (`actions.ts:164`) swaps from "hash JSONB blob" to "hash table rows ordered by display_order" — same intent (detect no-op save), table-rooted
- [ ] Unit test: a `setQuoteInputs` save persists rows in `quote_line_items` with correct totals; second identical save is a no-op (no audit row); a save with an override perturbs `override_unit_price` only and recomputes `line_total`
- [ ] Integration test: real DB, two consecutive saves, third with override flip — assert row counts + total math

#### Phase 4: Override UI — toggle + editable Unit cells
- [ ] Add `pricesOverridden: boolean` and `overrides: Record<string, number>` to the composer's RHF/Zod form schema; defaults to `false` / `{}`
- [ ] Above the Summary table at `quote-composer.tsx:609`, render a Catalyst Checkbox "Override unit prices for this prospect"
- [ ] When `pricesOverridden === true`, swap the read-only Unit cell at `:638` for a number input bound to `overrides[l.code]` (mirror the `taxOverride` input shape at `:662-668` — same min/step/right-aligned tabular-nums)
- [ ] In override mode, render the catalogue `unitPrice` beside/under the input as a small dim line ("Catalogue: $X.XX") so the coach sees the original
- [ ] On submit, include `overrides` and `pricesOverridden` in the FormData payload posted to `setQuoteInputs`
- [ ] Composer's local `display` computation honors overrides — reuse Phase 1's `effectiveUnit()` / `recomputeTotalsWithOverrides()`
- [ ] When the toggle is flipped off, clear the `overrides` map and re-render with catalogue totals
- [ ] Read-only mode (`isReadOnly`) shows override values as plain text — no inputs
- [ ] Composer load: rehydrate `overrides` from the persisted table rows where `override_unit_price IS NOT NULL`

#### Phase 5: Send / PDF — render `effectiveUnit(line)`
- [ ] Locate the PDF line-item renderer reached from `sendQuote` (`src/features/quotes/actions.ts:745-851`) and the underlying React-PDF / HTML template
- [ ] Update the Unit / Line-total cells to read `effectiveUnit(line)` instead of `line.unitPrice`
- [ ] Confirm the PDF's subtotal/tax/total come from `quotes.subtotal/tax/total` (already override-aware after Phase 3) — no second compute path
- [ ] Audit any other consumer of the rehydrated `ComputedLine[]` (share page, email body, receipt) and apply the same `effectiveUnit` rule
- [ ] Manually inspect a generated PDF for an override-on quote and confirm only the tuned price is visible to the prospect

#### Phase 6: Drop `quotes.line_items` JSONB column
- [ ] Generate (or hand-write) `drizzle/0023_drop_quotes_line_items_jsonb.sql` — `ALTER TABLE quotes DROP COLUMN line_items;`
- [ ] Remove `lineItems` column from `src/lib/db/schema/quotes.ts` and update the table comment block (lines 28–32) to point at `quote_line_items` and retire the "deferred to 7.3" note
- [ ] Remove the JSONB fallback branch from `queries.ts` (Phase 2's safety net)
- [ ] Remove the JSONB-side type fields from `QuoteRow` / `loadQuoteForCompose` return shape
- [ ] Sweep for any straggler reference: `grep -rn "lineItems\b" src/` should return only the in-memory `ComputedLine[]` type field (no DB column references)
- [ ] Run migration; spot-check `\d quotes` no longer shows `line_items`

#### Phase 7: Tests + smoke verification + wiki update
- [ ] Service-level integration test: create draft quote → `setQuoteInputs` with overrides → reload → assert table rows have `override_unit_price` populated and `quotes.subtotal/tax/total` reflect override math
- [ ] Integration test: `sendQuote` on an override-on quote — assert the persisted `sent` row's totals match the override math and the rendered PDF carries the tuned numbers
- [ ] Unit test (PDF renderer): line cell renders `override_unit_price` when set, `unit_price` when null
- [ ] Smoke (web-test): `goto /quotes/<draft-id>`; expect heading "Summary" + checkbox "Override unit prices for this prospect"
- [ ] Smoke (web-test): click the override checkbox; the Unit column rows expose number inputs bound to per-line override
- [ ] Smoke (web-test): type an override into one line; subtotal/total update inline
- [ ] Smoke (web-test): uncheck override; inputs disappear, totals revert to catalogue
- [ ] Update `docs/wiki/data-model.md`: add a `quote_line_items` section (FK, unique-on-(quote_id, code), display_order semantics, override column meaning); retire the JSONB callout on the `quotes` section
- [ ] Update `docs/wiki/log.md` with a one-line entry (date + headline + bullets)
- [ ] Run `/eval`; resolve any Must-Fix; commit
