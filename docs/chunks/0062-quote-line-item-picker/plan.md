# Quote Line-Item Picker — Plan

**Intent:** [`intent.md`](intent.md)
**Started:** 2026-06-01
**Supersedes:** [`0053-quote-line-items-table`](../closed/0053-quote-line-items-table/plan.md) (folds in its table migration). **Reverses:** the calculator decision in [`closed/0035-quote-composer`](../closed/0035-quote-composer/plan.md).

## Progress Tracker

| Phase | Status | Commit |
|-------|--------|--------|
| 1: Schema + backfill migration — `quote_line_items` table from JSONB | Done | `2b735dd` |
| 2: Pricing module — retire calculator derivation, add picked-line totals | Done | `16a057a` |
| 3: Read path — rehydrate picked lines + expose catalogue to the picker | Done | `ad62e89` |
| 4: Write path — `setQuoteInputs` delete-and-inserts picked lines | Done | `ba27ef4` |
| 5: Composer UI — replace Inputs panel with the add-line picker | Done | `beca36e` |
| 6: Send / PDF — render picked lines + description; empty-quote guard | Done | `6f2dd8f` |
| 7: Drop `quotes.line_items` JSONB + retire dead calculator code | Done | `a4259ae` |
| 8: Tests + smoke verification + wiki update | Done (smoke pending deploy) | `59bb9b8` |

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

**Overall Progress:** ~95% — feature-complete + green (8 phases built; 901 tests, tsc clean, migration rehearsed against the 0063 container). Remaining: deploy-time `db:migrate` (0024+0025) + the browser smoke against the migrated DB. Not auto-closed — the smoke + the destructive migration apply are human-coordinated at deploy.

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
- [x] Add `PickedLine` type to `pricing.ts` (`{ serviceItemId?, code, label, description?, qty, unitPrice, overrideUnitPrice?, lineTotal }`) + `PickedQuoteComputation`
- [x] Add `computePickedTotals(lines, taxOverride): PickedQuoteComputation` — `lineTotal = roundCents(effectiveUnit(line) * qty)`, `subtotal = Σ`, typed `tax`, `total`; returns NEW objects (no mutation). (Returns `PickedQuoteComputation`, not `QuoteComputation`, since lines are `PickedLine[]`.)
- [x] Add `validatePickedLines()` — qty integer in `[1, MAX_QTY]`, prices finite/non-negative ≤ `MAX_DOLLARS`, code + label non-empty. Generalized `effectiveUnit()` to a structural `{ unitPrice, overrideUnitPrice? }` param so it serves both `ComputedLine` and `PickedLine`.
- [x] Mark `computeQuote()` `@deprecated` (kept compiling for now; deleted in Phase 7). Kept `effectiveUnit`, `roundCents`, `MAX_DOLLARS`, money helpers.
- [x] Unit tests: `computePickedTotals` (override honored, multi-line + tax, empty → 0, rounding, no-mutation, neg-tax throw), `validatePickedLines` (qty 0 / non-int / negative price / negative override / over-max / empty code+label). 14 new tests; pricing suite 51 pass.

#### Phase 3: Read path — rehydrate picked lines + catalogue
- [x] In `src/features/quotes/queries.ts`, `loadQuote` sibling-selects `quote_line_items` (ordered by `display_order`) via `loadPickedLines` → maps to `PickedLine[]` on a new `Quote.pickedLines` field. Only the single-quote path fetches lines; list loaders (`loadQuotes`/`loadQuotesByDealer`) leave `pickedLines: []` to avoid an N+1 (lists show totals, not lines).
- [x] ~~Surface the catalogue to the composer load path~~ **Already wired** — `quotes/[id]/page.tsx` + `quotes/new/page.tsx` already pass `catalog={loadServiceItems()}` to `<QuoteComposer>`. Phase 5 re-points it from the calculator to the picker dropdown; no read-path change needed here.
- [x] JSONB read kept as a one-phase fallback: `loadPickedLines` returns table rows when present, else maps the legacy `quotes.line_items` JSONB via `computedLineToPicked` (removed in Phase 6).
- [x] No other `lineItems` consumer needs reshaping this phase: `loadQuoteSendHistory` reads audit payloads (not lines); list/dealer-panel read totals; the composer keeps reading `initial.lineItems` until Phase 5. Added `pickedLines: []` to the `makeQuote` test fixture in `status-display.test.ts`.
- [x] Unit test: `queries.test.ts` covers (i) table rows present → `pickedLines` from the table (string→number money coercion, override mapped), (ii) table empty + JSONB rows → JSONB-derived `pickedLines`. 16 tests pass.

#### Phase 4: Write path — `setQuoteInputs` against the table
- [x] In `src/features/quotes/actions.ts`, added the picker write path: `parsePickedLineInputs` (parse `lines` JSON) + `buildPickedLines` (resolve against catalogue, seed `unitPrice`, derive `overrideUnitPrice` when the typed price ≠ seed) + `pickedLineInsertValues`. Both `setQuoteInputs` (via module-private `applyPickerSave`) and `createQuote` branch on `formData.has('lines')`.
- [x] Transaction: optimistic-lock `quotes.updatedAt` (same `date_trunc('ms')` predicate) → `DELETE FROM quote_line_items WHERE quote_id = ?` → `INSERT` the picked rows (snapshot `code/label/description/unit_price`; `override_unit_price` when tuned; `display_order` = index) → write `quotes.subtotal/tax/total` from `computePickedTotals`.
- [x] Continues writing `inputs.quoteNotes` (merged onto the preserved `inputs` snapshot — `audienceSize`/etc. preserved untouched).
- [x] ~~Stop writing `quotes.line_items` JSONB~~ → **Deviation (expand→migrate→contract):** the picker path *also* writes a JSONB **mirror** (`pickedLinesToJsonbMirror`, `unit:'flat'` placeholder) because the render paths (`sendQuote`/`previewQuotePdf`) still read `quotes.line_items` until Phase 6. The JSONB write stops + column drops in **Phase 7**, not here — otherwise rendering would break for picker-saved quotes mid-chunk.
- [x] ~~`hashLineItems` re-roots to table rows~~ → **Deviation:** stays rooted on the JSONB **mirror** (still written) for the `quote.edited` audit no-op diff; re-roots to the `PickedLine[]` when the mirror retires in Phase 7. Same intent.
- [x] **Kept the legacy `inputs`/`computeQuote` path as a fallback** (when `lines` absent) so every existing test + the not-yet-flipped composer stay green through Phase 5; deleted in Phase 7.
- [x] Unit tests: picker save persists `quote_line_items` rows + JSONB mirror + merged quoteNotes + override math (`actions.test.ts`); empty-lines clears rows + zeroes totals; malformed payload rejected pre-tx; catalogue-miss rejected; terminal-status rejected; `createQuote` picker path inserts quotes + quote_line_items; unknown catalogue id rejected. Added `tx.delete` + a `deletes` recorder to the db mock. 83 actions tests pass (+7).
- [ ] ~~Integration test (real DB)~~ **Deferred to Phase 8 / deploy** — no local DB in the build loop (see Phase 1 note); the mocked-db unit tests cover the row/total/override logic.

#### Phase 5: Composer UI — the add-line picker
- [x] Form schema now `{ dealerId, taxOverride, quoteNotes, lines: Array<{ serviceItemId, qty, price }> }` via RHF `useFieldArray`. Dropped `quoteInputsSchema`/`computeQuote`/`recomputeTotalsWithOverrides`/`pricesOverridden`/`overrides`/`ToggleGroup`/`Checkbox` imports.
- [x] Removed the "Inputs" section (audience/days/counts/retrieval-bracket/travel/travel-notes) + the computed read-only table. Left section is now "Quote header" (dealer) + "Notes & tax" (quoteNotes textarea + tax input).
- [x] **Add line** control: a SKU `<Combobox>` over the catalogue (mirrors the dealer Combobox); on select, `append({ serviceItemId, qty: 1, price: catalogue seed })` and reset the picker to empty.
- [x] Each row: SKU label + description (from catalogue) · qty input (`lines.N.qty`) · price input (`lines.N.price`, prefilled) · ✕ remove (`useFieldArray.remove`). "Catalogue: $X.XX" dim line shows when the price is tuned off the seed.
- [x] Live totals via `computePickedTotals(toPickedLines(watched.lines, catalogById), taxOverride)` — subtotal/tax/total update inline; mid-keystroke invalid input caught → error panel.
- [x] On submit, posts `lines` (JSON) + `quoteNotes` + `tax` (+ `dealerId` on create) to `setQuoteInputs`/`createQuote`.
- [x] Read-only mode renders `initial.pickedLines` as plain text (`renderReadOnlyRows`), no inputs.
- [x] Composer load rehydrates the field array from `initial.pickedLines` (price = `effectiveUnit`; `serviceItemId` falls back to a **catalogue code-match** for legacy lines backfilled without a service-item id — all 8 legacy seed codes exist in the catalogue, so they map).
- [x] Empty state: fresh draft shows the picker with zero lines + "Add a service from the catalogue above" hint.
- [x] Page wiring: `[id]/page.tsx` feeds `quoteNotes`/`pickedLines` into `initial` (dropped `inputs`/`lineItems` + the unused `QuoteInputs` import); KeyValueStrip drops "Audience"/"Event days", adds "Line items". `new/page.tsx` unchanged (already passes `catalog`). tsc clean; 951 tests pass (composer has no unit tests — Phase 8 browser smoke covers it).

#### Phase 6: Send / PDF — render picked lines + guard
- [x] `render-quote.ts`: `QuoteLineItem` gains optional `subDescription`; the line loop renders it as a small grey sub-line (dynamic row height, truncated to the description column width). `effectiveUnit` already applied via `validatePersistedLines` (`unitPrice = overrideUnitPrice ?? unitPrice`).
- [x] **Render feed cutover (deviation):** rather than add a `quote_line_items` table read to every `sendQuote`/`previewQuotePdf` path (which would churn ~15 mocked FIFO tests), `pickedLinesToJsonbMirror` now carries `description`, and `validatePersistedLines` reads it through to `subDescription`. The render path stays on the (enriched) JSONB mirror; **Phase 7** cuts it over to the table when the column drops. Same user-visible result (description on the PDF) with far less churn.
- [x] **Empty-quote guard** in `sendQuote`: `validatePersistedLines` → if `lines.length === 0`, fail closed with "Add at least one line item before sending this quote." before render/GCS/email/status-flip.
- [x] Other consumers audited: `previewQuotePdf` shares `validatePersistedLines` (gets the sub-line for free); the email body (`quoteEmail`) uses the total only (no line list); no quote share page exists (public accept route was dropped in 0026). No other `lineItems` consumer.
- [x] Tests: `render-quote.test.ts` renders a line with `subDescription`; `actions.test.ts` refuses an empty quote. 953 tests pass (+2).
- [ ] ~~Manually inspect a generated PDF~~ → covered by Phase 8 browser smoke (Preview PDF on a picker quote).

#### Phase 7: Drop JSONB + retire dead calculator
- [x] `drizzle/0025_drop_quotes_line_items_jsonb.sql` — `ALTER TABLE quotes DROP COLUMN line_items;` (generated; journal `when` `1780334030204` > `0024`'s ✓).
- [x] Removed `lineItems` column from `src/lib/db/schema/quotes.ts` + rewrote the table comment.
- [x] **Render cutover (the load-bearing piece):** new `src/lib/quotes/render-lines.ts` exports `renderLinesColumn` (a correlated `jsonb_agg` subquery over `quote_line_items`), `mapRenderLines`, and `lineFingerprint`. `sendQuote` / `previewQuotePdf` / `applyPickerSave` / `msa.sendMsaEnvelope` read lines **inline on the existing quote `select`** (no new round-trip → fixtures just rename `lineItems`→`renderLines`, ~no test FIFO churn). Deleted both copies of `validatePersistedLines`.
- [x] Write path stops writing the (now-gone) jsonb mirror; `pickedLinesToJsonbMirror` deleted; `hashLineItems` re-rooted to `lineFingerprint`.
- [x] Deleted `computeQuote()` + `recomputeTotalsWithOverrides` + `quoteInputsSchema` + `validateQuoteInputs` + `ComputedLine`/`QuoteComputation` + the old `inputs`/`overrides` path in `createQuote`/`setQuoteInputs` (+ their ~30 tests). Kept `effectiveUnit`/`computePickedTotals`/`validatePickedLines`/money helpers + `QuoteInputs`/`DEFAULT_QUOTE_INPUTS` (the `quotes.inputs` column stays).
- [x] Removed the JSONB fallback from `queries.ts` (`loadPickedLines` reads the table only).
- [x] Grep gate: `computeQuote`/`quotes.lineItems` appear only in historical comments — no code refs.
- [x] **Rehearsed against the 0063 container:** `pnpm db:test:reset` replays `0000→0025` clean; `quotes.line_items` gone, `quote_line_items` present. tsc clean; 901 tests pass.
- [x] **Latent bug found + fixed:** `quote-line-items.test.ts` lived in `src/lib/db/schema/` — `drizzle-kit generate` imports every file there and choked on the `vitest` import. Moved to `src/lib/db/quote-line-items.schema.test.ts`.

#### Phase 8: Tests + smoke verification + wiki update
- [x] Unit coverage (mocked-DB): picker write path (`actions.test.ts` — rows/totals/override/empty/catalogue-miss/terminal), read path (`queries.test.ts`), pricing (`pricing.test.ts`), PDF sub-description + empty-send guard, schema introspection. tsc clean; **901 tests pass**.
- [x] Updated `docs/wiki/data-model.md` (new `quote_line_items` section; `line_items` dropped; `inputs`/`service_items` reframed), `architecture.md` (composer subsection flipped calculator→picker), `commercial-spine.md` (composer flow), `log.md` (entry).
- [ ] ~~Service / `sendQuote` integration tests (real DB)~~ → **now unblocked by the 0063 harness** but not yet written; parked as a follow-up (`0062 follow-up (a)` — real-DB integration tests against `db:test:reset`). The mocked-DB unit tests cover the logic.
- [ ] **Browser smoke — BLOCKED on DB state.** The branch's code reads `quote_line_items` + the `renderLines` subquery; the shared sandbox DB has neither until `0024`/`0025` are applied (`pnpm db:migrate`, a deploy step). So the web-test smoke (add line / edit price / remove / "VIP EVENT" appears / `/production`+`/reports`+`/calendar` regression) runs **at deploy against the migrated DB**, or against the 0063 container (`DATABASE_URL`→container + dev server). Migration chain already rehearsed clean against the container.
- [ ] **Deploy step (carry to go-live):** `pnpm db:migrate` applies `0024` (create+backfill — additive, safe) then `0025` (drop column) to the shared DB. Safe to split: apply `0024`, verify the picker, then `0025`. Until migrated, do **not** deploy this branch against the shared DB (schema mismatch).
- [ ] Chunk-end `/eval` (static + Codex + browser smoke) — **deferred** with the browser smoke (above). Static is green; a Codex review pass is worthwhile on the large Phase 7 refactor when run.
