# Canadian sales tax by dealer province — Plan

**Intent:** [`intent.md`](intent.md)
**Started:** 2026-06-04

## Progress Tracker

| Phase | Status | Commit |
|-------|--------|--------|
| 1: Dealer `province` field | Done | 0315ebd |
| 2: Province→rate lookup table + seed | Done | 136e17f |
| 3: Tax-rate admin (edit rates) | Done | 1fe86f6 |
| 4: Auto-compute tax from province (+ override) | Pending | - |
| 5: Composer + PDF show province/rate | Pending | - |
| 6: Tests + smoke verification | Pending | - |

Auto-compute a quote's tax from the **dealer's province** (`subtotal × province rate`) using an **admin-editable, seeded** rate table, while keeping a per-quote manual **override**. "Done" = a dealer carries a province, admins maintain the seeded province→rate table in `/admin/lookups`, a new quote's tax auto-fills from the dealer's province (snapshotting the applied rate), the coach can still override, and the composer + PDF show the applied province/rate — with existing quotes unchanged.

> **DB work:** Phases 1, 2, and 4 touch schema + migrations. **Invoke the `db-conventions` skill before writing any schema/migration** (per CLAUDE.md → Conventions). Mind the Drizzle journal `when` gotcha (new migration's `when` must be > the previous entry's, else it silently never applies). Apply migrations on the **session pooler (5432)**, prod separately.

## Code Anchors

For each new file or method below, the builder reads the anchor first and matches its shape (length, error handling, naming, query style). For modifications to an existing file, the anchor is the nearest sibling method in that same file.

| New code | Anchor (`path:line`) | Why this anchor |
|----------|---------------------|-----------------|
| `dealers.province` column + migration | `src/lib/db/schema/dealers.ts:16` (`address` text col) + the `status` enum-ish column in the same file | Same table; match the existing structured-field / check-constraint convention |
| province field in dealer Zod schema | `src/features/dealers/dealer-schema.ts:31-33` (`status` `z.enum`) | Shared client+server schema; province is an enum like status |
| province `<select>` in dealer form | `src/features/dealers/dealer-form.tsx:181-196` (the status native `<select>`) | Nearest sibling select in the same form |
| `tax_rates` table + seed migration | `src/lib/db/schema/` lookup tables (campaign styles / audience sources) | Same lookup-table shape (code + label + audit) |
| province→rate query loader | `src/features/schedule/queries.ts` (`loadCampaignStyles` / `loadAudienceSources`) | Same query layer + return shape |
| tax-rate admin (edit-only rates) | `src/features/schedule/lookup-admin.tsx` + `src/app/(app)/admin/lookups/page.tsx:8` — but rates are **edit-only** (fixed 13 rows, no create/archive), so cross-ref the 0059 inline-edit pattern (`closed/0059-reports-inline-edit/`) | Closest admin-table editor; the rate-edit affordance is inline-edit, not create/rename/archive |
| update-rate Server Action | `src/features/quotes/actions.ts:481-530` (`setQuoteTax`) + `src/features/schedule/actions.ts` lookup updates | Same `capabilityClient(...).schema(formDataSchema)` + guarded UPDATE shape |
| tax computation from province | `src/lib/quotes/pricing.ts:125-141` (`computePickedTotals(lines, taxOverride)`) | The totals function; extend `taxOverride: number` → `{ ratePct, override }` |
| auto-compute wiring in quote actions | `src/features/quotes/actions.ts` (`createQuote` / `setQuoteDealer` / `setQuoteTax`) | Same action layer; tax recompute on dealer-set / line-change; `setQuoteTax` becomes the override setter |
| widen `quotes.tax_pct`→`(6,3)` + add `quotes.tax_override` | `src/lib/db/schema/quotes.ts:71,77` (`tax_pct`, `tax`) | Same table; QST needs 3 decimals |
| composer tax field → override + show rate | `src/features/quotes/quote-composer.tsx:654-667` ("Tax ($)" `taxOverride` field) | Same UI control; becomes the blank-means-auto override |
| PDF tax line w/ province + rate | `src/lib/pdf/render-quote.ts:343-344` (`drawRight(… quote.tax …)`) | Same totals-section renderer |
| money / rounding helpers (reuse) | `src/lib/quotes/pricing.ts:84-86` (`roundCents`) + `src/features/quotes/actions.ts:109-111` (`moneyString`) | Reuse — don't reinvent money handling |

**Conventions referenced:**
- `db-conventions` skill — ID/audit columns, migration journal `when` gotcha, direct-vs-pooled connection, backfill patterns. **Invoke before Phases 1/2/4.**
- `docs/wiki/data-model.md` — quote/dealer schema ground truth (update it when this ships).
- Money convention: amounts are `numeric(X,2)` decimal dollars, stringified on read, `toFixed(2)` on write, `roundCents()` guards IEEE-754 drift. The new rate column is `numeric(6,3)` (percent, holds 14.975).
- Place-of-supply: tax keys off the **dealer's** province, not the event location (see intent Non-goals).

**Overall Progress:** 50% (3/6 phases complete)

**Note:**
- Each phase includes both implementation and tests.
- Integration/DB-behavior tests come last (Phase 6), after the schema phases settle.

### Phase Checklist

#### Phase 1: Dealer `province` field
- [x] Invoked `db-conventions`. Added a nullable `province` column to `dealers` via `pgEnum('ca_province', …)` (matches the existing `dealer_status` pgEnum convention; province is a stable 13-value set). Single source of truth = new `src/lib/ca-provinces.ts` (codes + names). Migration `0026_melted_veda.sql` (`CREATE TYPE ca_province` + `ADD COLUMN province`); journal `when` 1780602341087 > 0025's. No auth.users gotcha.
- [x] Added `province` to `dealer-schema.ts` (`z.union([z.enum(CA_PROVINCE_CODES), z.literal('')]).optional()` — '' = unset/clear).
- [x] Added a province `<select>` to `dealer-form.tsx` (anchored on the status select); wired into `valuesToFormData`, `defaultValues`, the `Dealer` query type + both projections (`loadDealersInner`/`loadDealer`), and `createDealer` (insert) + `updateDealer` (patch — present→set/clear, absent→preserve).
- [x] Existing dealers: `province` stays NULL (admin fills in). Missing-province behavior handled in Phase 4 ($0 + warning).
- [x] Test: `dealer-schema.test.ts` — accepts valid code / '' / omitted; rejects an invalid code.

#### Phase 2: Province→rate lookup table + seed
- [x] New table `src/lib/db/schema/tax-rates.ts`: `province` (the shared `ca_province` enum, unique), `label`, `rate` `numeric(6,3)`, `...timestamps` (lookup is edited-in-place not archived → timestamps over actors/archivable). Registered in schema `index.ts`. Migration `0027_odd_onslaught.sql` creates the table + **idempotent seed** of all 13 rows (June-2026 rates, `ON CONFLICT (province) DO NOTHING`). Journal `when` later than 0026; no auth gotcha.
- [x] Loaders in `src/features/tax-rates/queries.ts`: `loadTaxRates()` + `taxRateForProvince(code)`. Pure `rateForProvince(rows, code)` + `TaxRate` type live in client-safe `src/lib/tax-rates.ts` (so the composer/admin + tests avoid `server-only`).
- [x] Test `src/lib/tax-rates.test.ts`: `rateForProvince` returns 14.975 for QC (3-decimal), numbers for ON/AB, null for a province with no row / null province. (Seed-row count + QC value verified at migration-apply on stage/prod.)

#### Phase 3: Tax-rate admin (edit rates)
- [x] `/admin/lookups` gains a "Sales Tax Rates" section (`TaxRatesAdmin`) — 13 province rows, each an editable rate input + Save (edit-only). Modeled on `lookup-admin.tsx`.
- [x] `updateTaxRate` Server Action (`capabilityClient('lookup:edit')`): guarded UPDATE keyed on province; `taxRateUpdateSchema` validates rate (regex ≤3 decimals + 0–30%).
- [x] Registered `updateTaxRate` in the action-gate matrix (ADMIN_ONLY).
- [x] Test `tax-rate-schema.test.ts`: accepts valid (incl QC 14.975); rejects >3 decimals, >30%, non-numeric, invalid province.
- [ ] Smoke (web-test): `goto /admin/lookups`; "Sales Tax Rates" section lists rows incl. Ontario 13.000 + Quebec 14.975 with a rate input + Save. _(Chunk-end `/eval`.)_

#### Phase 4: Auto-compute tax from province (+ override)
- [ ] Invoke `db-conventions`. Widen `quotes.tax_pct` → `numeric(6,3)`; add nullable `quotes.tax_override numeric(12,2)` (blank = auto). Migration; backfill `tax_override = tax` for existing quotes so nothing recomputes (preserve history). Verify journal `when`.
- [ ] Extend `computePickedTotals` (pricing.ts): tax = `override ?? roundCents(subtotal × ratePct / 100)`; `total = subtotal + tax`. Keep `roundCents`.
- [ ] Wire auto-compute into the quote actions: on `createQuote` / `setQuoteDealer` / line-change, look up the dealer's province → `taxRateForProvince` → snapshot `tax_pct` + recompute `tax`/`total`. Missing province → $0 tax + a surfaced warning (per intent open-question lean).
- [ ] `setQuoteTax` becomes the **override** setter (writes `tax_override`; clearing it reverts to auto).
- [ ] Test: ON quote (subtotal 1000) → tax 130.00; QC → 149.75; override 50 → tax 50.00; dealer with no province → tax 0 + warning; rounding (roundCents) holds.

#### Phase 5: Composer + PDF show province/rate
- [ ] Composer: replace the bare "Tax ($)" field with the auto-computed tax + the applied province/rate label (e.g. "Tax — ON (HST 13%): $130.00") and an **override** input (blank = auto). Missing-province → inline "set the dealer's province" warning.
- [ ] PDF (`render-quote.ts`): the tax line shows the province + rate (e.g. "HST (ON) 13%") alongside the amount.
- [ ] Test: composer renders the computed tax + rate label for a dealer with a province; PDF tax line includes the rate.
- [ ] Smoke (web-test, read-only): `goto /quotes/<id>` (a draft for a dealer with a province); composer shows the computed tax + province/rate label. Don't send.

#### Phase 6: Tests + smoke verification
- [ ] Pricing unit tests green (each province rate, override, missing-province, rounding) + schema/seed tests.
- [ ] Smoke (web-test): `goto /admin/lookups` → "Sales Tax Rates" section seeded (ON 13.000, QC 14.975). `goto` a dealer edit form → province `<select>` present. `goto /quotes/<draft>` → computed tax + rate label shown.
- [ ] Update `docs/wiki/data-model.md` (dealers.province, tax_rates table, quotes.tax_override/tax_pct semantics).
- [ ] (If DB state is needed) throwaway fixture `scripts/0065-tax-smoke.ts` (insert dealer w/ province + draft quote → web-test → cleanup).
