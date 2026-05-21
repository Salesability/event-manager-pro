# Quote Coach Price Override — Plan

> **Un-superseded 2026-05-15** — the prior supersession by `0053-quote-line-items-table` was reversed. Bundling was the wrong call for the timing: 0053's relational normalization is genuinely useful but premature (invoicing — its real driver per the schema comment in `src/lib/db/schema/quotes.ts:28-32` — isn't here yet), and pulling it forward delayed the override feature. This plan resumes as scoped: JSONB-additive `overrideUnitPrice?` field, no DB migration, 5 small phases. 0053 stays Parked until invoicing materializes; when it does, `override_unit_price` is one extra column in 0053's existing migration.

**Intent:** [`intent.md`](intent.md)
**Started:** 2026-05-15

## Progress Tracker

| Phase | Status | Commit |
|-------|--------|--------|
| 1: Types + pricing — `overrideUnitPrice` on `ComputedLine`, recompute helper | Done | (this commit) |
| 2: Server action — accept overrides in `setQuoteInputs`, persist into `lineItems` JSONB | Done | (this commit) |
| 3: Composer UI — "Override unit prices" toggle + per-line editable Unit cells with original visible | Done | (this commit) |
| 4: Send / PDF — render `overrideUnitPrice` when present, fall back to `unitPrice` | Done | (this commit) |
| 5: Tests + smoke verification | Done | `5aff65f` — 143 unit tests PASS; closed 2026-05-21 by user direction (built + committed in `5aff65f`; formal `/eval` waived) |

This chunk adds a per-quote, coach-controlled price-override layer on top of the existing catalogue-derived computation. The composer remains a calculator (no new line types); the change is a single optional `overrideUnitPrice` field per computed line, plus the UI affordances to set/clear it and the send path's preference rule. "Done" looks like: coach toggles override on, edits a unit cell, sees the original still rendered for reference; the persisted JSONB carries both numbers; `sendQuote` renders the tuned amount to the prospect; the totals across composer and PDF match.

## Code Anchors

| New code | Anchor (`path:line`) | Why this anchor |
|----------|---------------------|-----------------|
| `overrideUnitPrice?: number` on `ComputedLine` (`src/lib/quotes/pricing.ts`) | `src/lib/quotes/pricing.ts:46-55` (existing `ComputedLine`) | Same module, same JSONB row shape — extension, not new type |
| Override-aware `effectiveUnit(line)` helper + recompute path (`src/lib/quotes/pricing.ts`) | `src/lib/quotes/pricing.ts` (existing `computeQuote` flow) | Sits next to `computeQuote`; same stateless, deterministic shape |
| Override map on `setQuoteInputs` payload (`src/features/quotes/actions.ts`) | `src/features/quotes/actions.ts:293-420` (`setQuoteInputs` — accepts `inputs` JSON + `taxOverride`) | Same action; overrides are an additional structured input alongside the existing `taxOverride` |
| Coach-facing "Override unit prices" checkbox row in Summary (`src/features/quotes/quote-composer.tsx`) | `src/features/quotes/quote-composer.tsx:655-669` (Tax override input row in `<tfoot>`) | Closest sibling — same Summary table, same per-quote-override pattern, same `register()` form binding |
| Per-line editable Unit cell (`src/features/quotes/quote-composer.tsx`) | `src/features/quotes/quote-composer.tsx:662-668` (existing `taxOverride` `<input type="number">`) | Same number-input shape, same min/step/right-aligned tabular-nums treatment |
| PDF renderer: prefer `overrideUnitPrice` (`src/features/quotes/actions.ts` → PDF renderer) | `src/features/quotes/actions.ts:745-851` (`sendQuote` reads persisted `lineItems`) | Same send path; PDF reads the same JSONB snapshot — single-line preference rule |

**Conventions referenced:**
- `docs/wiki/data-model.md` — `quotes.lineItems` is a JSONB snapshot; extending its row shape is a wiki-update trigger (note in Phase 1).
- `CLAUDE.md` → **Conventions** — mutations are Server Actions, not route handlers.
- `db-conventions` skill — no schema migration is needed (JSONB shape only), so the change is type-only.

**Overall Progress:** 100% (5/5 phases complete)

**Note:**
- Each phase includes both implementation and any close-in unit tests; the wider smoke + integration pass is Phase 5.
- No DB migration: `quotes.lineItems` is JSONB; the new `overrideUnitPrice` field is an additive optional column inside the snapshot and silently absent on pre-existing rows.

### Phase Checklist

#### Phase 1: Types + pricing
- [ ] Add optional `overrideUnitPrice?: number` to `ComputedLine` in `src/lib/quotes/pricing.ts`
- [ ] Add an `effectiveUnit(line: ComputedLine): number` helper that returns `overrideUnitPrice ?? unitPrice`
- [ ] Add `recomputeTotalsWithOverrides(lines, taxOverride?)` (subtotal/tax/total from `effectiveUnit * qty`) — pure, no DB
- [ ] Decide tax fallback when `taxOverride` is null and overrides are present (recompute via catalogue tax rate against override subtotal — match the existing `computeQuote` rule, just over `effectiveUnit`)
- [ ] Unit test: catalogue-only lines (no override) match existing `computeQuote` totals
- [ ] Unit test: one line overridden — subtotal drops by `(unit - override) * qty`; tax recomputes
- [ ] Unit test: `effectiveUnit` returns `unitPrice` when `overrideUnitPrice` is `undefined` or `null`

#### Phase 2: Server action — `setQuoteInputs` accepts overrides
- [ ] Extend the action's FormData contract: add an optional `overrides` JSON payload — shape `{ [lineCode: string]: number | null }` (null = clear)
- [ ] Zod-validate the override map (positive numbers, max `MAX_DOLLARS`, codes must match the recomputed catalogue lines)
- [ ] After `computeQuote` runs, merge overrides into the resulting lines (`line.overrideUnitPrice = overrides[line.code]` when present)
- [ ] Persist the augmented lines into `quotes.lineItems` and recompute `subtotal`/`tax`/`total` using `recomputeTotalsWithOverrides`
- [ ] Keep the existing optimistic-lock on `updatedAt` intact
- [ ] Unit test: action accepts overrides, persists them in JSONB, recomputes totals
- [ ] Unit test: override for a code that isn't in the recomputed lines is rejected (Zod fail or 400)
- [ ] Unit test: passing `{ code: null }` clears the override for that code; absent codes preserve existing overrides

#### Phase 3: Composer UI — toggle + editable Unit cells
- [ ] Add a `pricesOverridden: boolean` field to the composer form schema (Zod) — defaults to `false`
- [ ] Add an `overrides: Record<string, number>` field to the form schema — defaults to `{}`
- [ ] Render a checkbox above the Summary table (`<h2>Summary</h2>` row at quote-composer.tsx:609) labeled "Override unit prices for this prospect"
- [ ] When `pricesOverridden` is `true`, swap the read-only Unit cell at line 638 for a number input bound to `overrides[l.code]` (mirror the taxOverride input shape at lines 662–668)
- [ ] In override mode, render the catalogue `unitPrice` beside/under the input as a small dim line ("Catalogue: $X.XX") so the coach sees the original
- [ ] On submit, include `overrides` and `pricesOverridden` in the FormData payload posted to `setQuoteInputs`
- [ ] Composer's local `display` computation (the live totals shown while editing) honors overrides — reuse Phase-1's `recomputeTotalsWithOverrides`
- [ ] When the toggle is flipped **off**, clear the `overrides` map and re-render with catalogue totals
- [ ] Read-only mode (`isReadOnly`) shows override values as plain text — no inputs

#### Phase 4: Send / PDF rendering
- [ ] Locate the PDF line-item renderer reached from `sendQuote` (`src/features/quotes/actions.ts:745-851`) and the underlying React-PDF / HTML template
- [ ] Update the Unit / Line-total cells to read `effectiveUnit(line)` instead of `line.unitPrice`
- [ ] Confirm the PDF's subtotal/tax/total already come from `quotes.subtotal/tax/total` (which Phase 2 already wrote with override math) — no second compute path
- [ ] Audit any other consumer of `quotes.lineItems` (share page, email body, receipt) and apply the same `effectiveUnit` rule
- [ ] Manually inspect a generated PDF for an override-on quote and confirm only the tuned price is visible to the prospect

#### Phase 5: Tests + smoke verification
- [ ] Service-level integration test: create draft quote → `setQuoteInputs` with overrides → reload row → assert `lineItems[i].overrideUnitPrice` + recomputed totals
- [ ] Integration test: `sendQuote` on an override-on quote — assert the persisted `sent` row's totals match the override math
- [ ] Unit test (PDF renderer): line cell renders `overrideUnitPrice` when set, `unitPrice` when absent
- [ ] Smoke (web-test): `goto /quotes/<draft-id>`; expect heading "Summary" + checkbox "Override unit prices for this prospect"
- [ ] Smoke (web-test): click the override checkbox; the Unit column rows expose number inputs bound to per-line override
- [ ] Smoke (web-test): type an override into one line; subtotal/total update inline
- [ ] Smoke (web-test): uncheck override; inputs disappear, totals revert to catalogue
- [ ] (If DB state is needed for read-only path) `pnpm dlx tsx scripts/0052-override-smoke.ts insert`; run web-test against /quotes/<id> read-only view; `... cleanup`
- [ ] Update `docs/wiki/data-model.md` to note `lineItems[].overrideUnitPrice` as an optional snapshot field
- [ ] Run `/eval`; resolve any Must-Fix; commit
