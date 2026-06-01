# Quote Line-Item Picker — Plan

**Intent:** [`intent.md`](intent.md)
**Started:** 2026-06-01
**Supersedes:** [`0053-quote-line-items-table`](../closed/0053-quote-line-items-table/plan.md) (folds in its table migration). **Reverses:** the calculator decision in [`closed/0035-quote-composer`](../closed/0035-quote-composer/plan.md).

## Progress Tracker

| Phase | Status | Commit |
|-------|--------|--------|
| 1: Schema + backfill migration — `quote_line_items` table from JSONB | Done | `2b735dd` |
| 2: Pricing module — retire calculator derivation, add picked-line totals | Pending | - |
| 3: Read path — rehydrate picked lines + expose catalogue to the picker | Pending | - |
| 4: Write path — `setQuoteInputs` delete-and-inserts picked lines | Pending | - |
| 5: Composer UI — replace Inputs panel with the add-line picker | Pending | - |
| 6: Send / PDF — render picked lines + description; empty-quote guard | Pending | - |
| 7: Drop `quotes.line_items` JSONB + retire dead calculator code | Pending | - |
| 8: Tests + smoke verification + wiki update | Pending | - |

This chunk pivots the quote composer from a parametric calculator to a SKU line-item picker. "Done" looks like: a coach opens a draft quote, clicks **Add line**, picks a SKU from the catalogue (the owner's library, including new ones like "VIP EVENT"), the catalogue price prefills and stays editable, qty is set per line, and the assembled lines persist to `quote_line_items`, render on the PDF (label + description + qty + effective price + line total), and roll up to subtotal/tax/total. The structured-input calculator is gone from the UI and the `computeQuote()` derivation is retired; `quotes.inputs` / `audience_source_id` columns stay on the schema so production/reports/calendar are untouched.

## Code Anchors

| New code | Anchor (`path:line`) | Why this anchor |
|----------|---------------------|-----------------|
| `src/lib/db/schema/quote-line-items.ts` (new child table) | `src/lib/db/schema/dealer-contacts.ts:1-53` | Closest child-of-parent table: FK + cascade + composite index + `actors`/`timestamps` mixins |
| `drizzle/0024_quote_line_items_table.sql` (CREATE + backfill from JSONB) | `drizzle/0021_rename_provider_document_id.sql:1-17` | Most recent hand-written migration; same comment-header prose + multi-statement shape |
| `drizzle/0025_drop_quotes_line_items_jsonb.sql` (DROP COLUMN, chunk end) | `drizzle/0021_rename_provider_document_id.sql:1-17` | Same ALTER-TABLE drop shape; comment names upstream chunk + safety note |

> **Migration numbering:** `0022` + `0023` are already taken (`0022_update_travel_label_estimated`, `0023_volatile_killer_shrike`) and applied to the shared DB. The two migrations this chunk adds take the next free numbers **0024** + **0025**. Let `drizzle-kit generate` pick the create-table number, then rename to a descriptive slug; verify the journal `when` is greater than `0023`'s (project memory: Drizzle journal `when` gotcha).
| `PickedLine` type + `computePickedTotals()` helper (`src/lib/quotes/pricing.ts`) | `src/lib/quotes/pricing.ts:273-296` (`recomputeTotalsWithOverrides`) | Same module, same `ComputedLine`/totals shape; the picker totals are this function minus the derivation |
| `effectiveUnit()` reuse | `src/lib/quotes/pricing.ts:258` | Already the override-aware unit-price rule — picker keeps it verbatim |
| `loadQuoteForCompose` rehydrate from table + catalogue (`src/features/quotes/queries.ts`) | `src/features/quotes/queries.ts:55-120` | Same module, same return type; add a sibling select against `quote_line_items` + pass the catalogue list through |
| `setQuoteInputs` delete-and-insert (`src/features/quotes/actions.ts`) | `src/features/quotes/actions.ts:293-420` | Same action, same transaction; swap the `computeQuote` write for a picked-rows write |
| `hashLineItems` over table rows (`src/features/quotes/actions.ts`) | `src/features/quotes/actions.ts:164-170` | Same intent (no-op-save digest); hash the picked rows in `display_order` instead of the JSONB blob |
| Composer add-line picker + per-line price/qty (`src/features/quotes/quote-composer.tsx`) | dealer Combobox `quote-composer.tsx:~596` (picker shape) + override input `:~760-770` (editable price cell) | Same component; the SKU picker mirrors the dealer Combobox, the price cell mirrors the 0052 override input |
| PDF line render (label + description + effective price) (`src/lib/pdf/render-quote.ts`) | existing line-item block in `src/lib/pdf/render-quote.ts` | Same renderer; add a description sub-line + read `effectiveUnit(line)` |

**Conventions referenced:**
- `db-conventions` skill — invoke before Phase 1 (table + migration) and Phase 7 (drop column): IDs, audit columns, session-pooler for migrations, in-migration backfill pattern, the Drizzle journal `when` gotcha.
- `docs/wiki/data-model.md` — Phase 8 adds the `quote_line_items` section + retires the `quotes.lineItems` JSONB callout.
- `docs/wiki/architecture.md` — Phase 8 flips the "Quote composer — calculator, not a line-item picker" subsection to describe the picker.
- `docs/wiki/commercial-spine.md` — composer flow lines; accepted-quote-is-the-contract framing now lands directly on `quote_line_items` rows.
- `CLAUDE.md` → Conventions — mutations stay Server Actions; the Phase 4 rewrite stays inside `setQuoteInputs`.

**Overall Progress:** 13% (1/8 phases complete)

**Note:**
- Phases 1–4 are the data + server rebuild (table, pricing, read, write); Phase 5 is the UI pivot (the visible change); Phase 6 is send/PDF; Phase 7 retires the old column + dead calculator; Phase 8 is verification + wiki.
- The JSONB column stays through Phases 1–6 so the read path can cut over without a write-side big-bang. Phase 4 writes the table only; Phase 7 drops the now-orphaned column.
- Backfill (Phase 1) maps existing JSONB lines (`code`/`label`/`unit`/`qty`/`unitPrice`/`lineTotal`) into the table — existing sandbox quotes survive the pivot as ordinary picked lines.
- **Keep `quotes.inputs` + `audience_source_id` columns.** The composer stops reading/writing the pricing inputs but keeps writing `inputs.quoteNotes` (PDF notes). Nothing in this chunk touches the production/reports/calendar readers of those columns.

### Phase Checklist

#### Phase 1: Schema + backfill migration
- [x] Invoke `db-conventions` skill before writing schema/migration.
- [x] Write `src/lib/db/schema/quote-line-items.ts` — `pgTable('quote_line_items', { id: bigIdentity(), quoteId (FK → quotes.id, onDelete cascade), serviceItemId (FK → service_items.id, onDelete set null, nullable), code text, label text, description text (nullable), qty integer, unitPrice numeric(10,2), overrideUnitPrice numeric(10,2) nullable, lineTotal numeric(12,2), displayOrder integer, ...timestamps, ...actors })`
- [x] Index `quote_line_items_quote_id_idx` on `(quoteId, displayOrder)`. **No** `(quote_id, code)` unique — a picker may repeat a SKU (intent OQ). Also FK indexes on `service_item_id` + the two actor columns (matches the `dealer_contacts` anchor).
- [x] Re-export `quoteLineItems` from `src/lib/db/schema/index.ts`
- [x] `pnpm drizzle-kit generate` → `0024_quote_line_items_table.sql` (renamed from `0024_fast_hawkeye`; journal tag synced). Journal `when` = `1780328402209` > `0023`'s `1780156800000` ✓ (gotcha did not fire — real clock is ahead). No `CREATE SCHEMA "auth"` emitted, so nothing to strip; the `auth.users` FK `REFERENCES` are correct and stay.
- [x] Hand-extend with backfill: `INSERT … SELECT … FROM quotes q CROSS JOIN LATERAL jsonb_array_elements(coalesce(q.line_items, '[]'::jsonb)) WITH ORDINALITY` — `coalesce` guards null/empty; description/serviceItemId left null on backfill.
- [ ] ~~Run against fresh local DB; spot-check row count~~ **Deferred to deploy.** `.env.local`'s `DATABASE_URL` targets the **shared** Supabase pooler — applying migrations is the explicit deploy-time `pnpm db:migrate` step (per the 0057→0061 history), not a build action. Phase 1 is verified by the schema-introspection test + SQL review; the backfill runs at deploy and is spot-checked then (`SELECT sum(jsonb_array_length(line_items)) FROM quotes` vs new row count).
- [x] Unit test (schema introspection): `src/lib/db/schema/quote-line-items.test.ts` — columns, money-column types/nullability, index set, FK targets (cascade/set-null). 5 tests pass (no DB needed; `getTableConfig`).

#### Phase 2: Pricing module — retire derivation, add picked-line totals
- [ ] Add `PickedLine` type to `pricing.ts` (`{ serviceItemId?: number; code: string; label: string; description?: string; qty: number; unitPrice: number; overrideUnitPrice?: number; lineTotal: number }`) — superset of `ComputedLine`'s persisted fields
- [ ] Add `computePickedTotals(lines: PickedLine[], taxOverride): QuoteComputation` — `lineTotal = roundCents(effectiveUnit(line) * qty)`, `subtotal = Σ`, `tax`, `total` (mirror `recomputeTotalsWithOverrides`, no catalogue derivation)
- [ ] Add `validatePickedLines()` — qty ≥ 1 integer, prices finite/non-negative ≤ `MAX_DOLLARS`, label non-empty, code present
- [ ] Mark `computeQuote()` + `QuoteInputs` derivation as deprecated (kept compiling for now; deleted in Phase 7). Keep `effectiveUnit`, `roundCents`, `MAX_DOLLARS`, money helpers.
- [ ] Unit tests: `computePickedTotals` (override honored, multi-line, empty → 0), `validatePickedLines` rejects qty 0 / negative price / over-max

#### Phase 3: Read path — rehydrate picked lines + catalogue
- [ ] In `src/features/quotes/queries.ts`, after the `quotes` select, sibling-select `quote_line_items` ordered by `display_order` → map to `PickedLine[]`
- [ ] Surface the active catalogue (`loadServiceItems()`) to the composer load path so the picker dropdown has options (the `quotes/[id]` + `quotes/new` pages already preload the catalogue for the old calculator — re-point that data to the picker)
- [ ] Keep the JSONB read as a one-phase fallback (table empty + JSONB has rows) until Phase 4 lands
- [ ] Update `loadQuoteSendHistory` / any other `lineItems` consumer to the new shape
- [ ] Unit test: rows present → returned as `PickedLine[]`; table empty + JSONB rows → JSONB-derived (covers the in-between)

#### Phase 4: Write path — `setQuoteInputs` against the table
- [ ] In `src/features/quotes/actions.ts`, rework the write block (`:293-420`): accept a `lines: PickedLine[]` payload (picked SKUs + qty + per-line price) instead of `inputs` driving `computeQuote`
- [ ] Transaction: optimistic-lock `quotes.updatedAt` → `DELETE FROM quote_line_items WHERE quote_id = ?` → `INSERT` the picked rows (snapshot `code/label/description/unit_price` from the chosen catalogue row; `override_unit_price` when the coach edited the price) → write `quotes.subtotal/tax/total` from `computePickedTotals`
- [ ] Continue writing `inputs.quoteNotes` (the one input the composer still owns); stop writing pricing inputs + `quotes.line_items` JSONB
- [ ] `hashLineItems` (`:164`) → hash picked rows ordered by `display_order` (same no-op-save intent)
- [ ] Unit test: a save persists `quote_line_items` with correct totals; identical save is a no-op (no audit row); editing a price sets `override_unit_price` + recomputes `line_total`
- [ ] Integration test (real DB): two saves + a price-edit; assert row counts + totals

#### Phase 5: Composer UI — the add-line picker
- [ ] Replace the form schema's structured-input fields with `lines: Array<{ serviceItemId, qty, price }>` + keep `quoteNotes` + `taxOverride` (RHF `useFieldArray`)
- [ ] Remove the "Inputs" `<Section>` (`quote-composer.tsx:~618-700`) and the computed read-only line table
- [ ] Render an **Add line** control: a SKU Combobox over the catalogue (mirror the dealer Combobox at `:~596`); on select, append a row prefilled with the catalogue `unitPrice` and `label`/`description`
- [ ] Each row: SKU label + description (read-only context) · qty number input · price number input (prefilled, editable — mirror the 0052 override input at `:~760-770`) · remove-line button
- [ ] Show the catalogue price as a dim "Catalogue: $X.XX" beside the editable price when the coach has changed it (so they see the original)
- [ ] Live totals panel: `computePickedTotals(currentLines, taxOverride)` — subtotal/tax/total update inline
- [ ] On submit, post `lines` (+ `quoteNotes`, `taxOverride`) to `setQuoteInputs`
- [ ] Read-only mode (`isReadOnly`, sent/accepted/declined): lines render as plain text, no inputs
- [ ] Composer load: rehydrate `lines` from the persisted `PickedLine[]` (price = `effectiveUnit`, with override flagged)
- [ ] Empty state: a fresh draft shows the picker with zero lines + a hint to add one

#### Phase 6: Send / PDF — render picked lines + guard
- [ ] In `src/lib/pdf/render-quote.ts`, render each line: label, **description sub-line** (new), qty, `effectiveUnit(line)`, line total; subtotal/tax/total from `quotes.*`
- [ ] Add an **empty-quote guard** to `sendQuote` (`actions.ts:~745-851`): refuse to send a quote with zero lines / $0 total (friendly `{ error }`)
- [ ] Audit other `ComputedLine[]`/`lineItems` consumers (email body, share page, receipt) → apply `effectiveUnit` + description
- [ ] Manually inspect a generated PDF for a picked quote with an overridden price → only the tuned price + description visible to the prospect

#### Phase 7: Drop JSONB + retire dead calculator
- [ ] Invoke `db-conventions` before the drop migration.
- [ ] `drizzle/0025_drop_quotes_line_items_jsonb.sql` — `ALTER TABLE quotes DROP COLUMN line_items;`
- [ ] Remove `lineItems` column from `src/lib/db/schema/quotes.ts`; update the table comment block (`:28-39`) to point at `quote_line_items` and drop the "deferred to 7.3" note
- [ ] Delete `computeQuote()` + the structured-input derivation from `pricing.ts`; keep `effectiveUnit`/`computePickedTotals`/money helpers. Remove now-unused `QuoteInputs` *pricing* fields from the composer-facing schema (the DB `quotes.inputs` column + its `quoteNotes`/`audienceSourceId` semantics stay)
- [ ] Remove the JSONB fallback branch from `queries.ts` (Phase 3 safety net)
- [ ] `grep -rn "computeQuote\|lineItems\b" src/` → only in-memory `PickedLine[]`/test references remain; no DB column refs
- [ ] Run migration; `\d quotes` no longer shows `line_items`

#### Phase 8: Tests + smoke verification + wiki update
- [ ] Service integration test: create draft → save picked lines (one with an edited price) → reload → assert `quote_line_items` rows + `override_unit_price` + `quotes.subtotal/tax/total`
- [ ] Integration test: `sendQuote` on a picked quote — persisted totals match, PDF carries label + description + tuned price; empty-quote send is refused
- [ ] Unit test (PDF): line renders `override_unit_price` when set, `unit_price` when null, description when present
- [ ] Smoke (web-test): `goto /quotes/<draft-id>`; expect heading "Summary" + an **Add line** control + a SKU picker (no audience/days inputs present)
- [ ] Smoke (web-test): add a line from the picker → row appears with catalogue price prefilled; subtotal/total update
- [ ] Smoke (web-test): edit a line price → total updates; remove the line → total reverts
- [ ] Smoke (web-test): `goto /admin/lookups` (or services-admin route) → add a SKU "VIP EVENT" with a description + price → reload composer → "VIP EVENT" selectable in the picker
- [ ] Regression smoke: `goto /production` + `/reports` + `/calendar` render 200 (audience_source_id readers untouched)
- [ ] Update `docs/wiki/data-model.md` (new `quote_line_items` section; retire JSONB callout), `architecture.md` (flip the calculator subsection), `commercial-spine.md` (composer flow); add `log.md` entry
- [ ] Run `/eval`; resolve any Must-Fix; commit
