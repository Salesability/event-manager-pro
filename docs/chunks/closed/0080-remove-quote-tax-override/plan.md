# Remove the per-quote tax override — Plan

**Intent:** [`intent.md`](intent.md)
**Started:** 2026-06-15

## Progress Tracker

| Phase | Status | Commit |
|-------|--------|--------|
| 1: Decision gate — prod data-impact check + column keep/drop | Done | - |
| 2: Composer UI — Tax field display-only | Done | `9f8ff43` |
| 3: Server + pricing — drop the override write/compute path | Done | `df92f16` |
| 4: Schema — per the Phase 1 decision (keep = no-op; drop = migration) | Done | `60bed1d` |
| 5: Tests + smoke + wiki | Done | `53a6978` |

QuickBooks now owns province tax rates (0075/0076) and computes the tax on the Estimate push, which
already **rejects** any quote carrying a manual `tax_override` (`quote-push.ts:97`). So the per-quote
override is redundant and a footgun. "Done" = the composer Tax field is display-only (auto province
rate + pill, no Override), new/edited quotes never persist a `tax_override`, and existing quotes are
handled per the Phase 1 decision (no silent change to sent-quote totals unless explicitly chosen).

## Code Anchors

This is a **removal/refactor** chunk — each anchor is the current call site being simplified or
deleted (the "what we're moving away from" reference). Match the surrounding shape when trimming.

| Code touched | Anchor (`path:line`) | What changes |
|--------------|---------------------|--------------|
| Tax field render (3 branches) | `src/features/quotes/quote-composer.tsx:756` | Collapse to 2 states: no-province hint (keep) + auto display (keep the value + `auto · X%` pill, **drop the Override link**). Remove the `taxOverride != null` override-mode branch (766–796). |
| Form schema + defaults + write | `quote-composer.tsx:177` (`taxOverride` in `quoteFormSchema`), `:288` (defaultValues), `:351` (computePickedTotals `override`), `:401` (`fd.set('tax', …)`) | Remove `taxOverride` from the schema/defaults; `computePickedTotals(picked, { ratePct })`; stop sending a `tax` FormData field. |
| `parseTaxOverride` / `resolveTaxAmount` | `src/features/quotes/actions.ts:108`, `:125` | `parseTaxOverride` deleted; `resolveTaxAmount` loses its `override` arg (tax always = `round(subtotal × ratePct/100)`). |
| `createQuote` / `setQuoteInputs` tax read | `actions.ts:264`, `:511` | Stop reading the manual `tax` field; compute tax from the province rate only. |
| `setQuoteTax` | `actions.ts:529` | The action exists only to set the override → **retire it** (confirm no other caller first; grep). |
| `computePickedTotals` signature | `src/lib/quotes/pricing.ts:121` (`override?` in the opts type, `:127`) | Drop the `override` field from the opts; tax is always `subtotal × ratePct`. |
| Quote view-model projection | `src/features/quotes/queries.ts:38,80,107,141,249,272,312` | Per Phase 1: if column kept, may stop projecting `taxOverride`; if dropped, remove all references. |
| QB-push override guard | `src/lib/quickbooks/quote-push.ts:97` | Now dead (no quote can be overridden) — keep as a defensive assertion or remove; note in the diff. |
| `quotes.tax_override` column | `src/lib/db/schema/quotes.ts:85` | Phase 4 only, **per the Phase 1 decision**. Drop = migration (invoke `db-conventions`). |

**Conventions referenced:**
- `docs/wiki/commercial-spine.md` — the quote tax model (`tax = tax_override ?? round(subtotal × tax_pct/100)`); update to drop the override half once removed.
- `docs/wiki/data-model.md` — the `quotes.tax_override` column entry; update per Phase 4.
- **`db-conventions` skill** — invoke before any schema/migration work (Phase 4). Expand→contract: prefer keeping the column and dropping later over a risky immediate drop.
- `src/lib/quotes/pricing.ts` — the pure totals function both the composer (live preview) and the server (persist) call; keep them in lockstep.

**Overall Progress:** 100% (5/5 phases complete)

**Note:**
- Phase 1 is a **decision gate** (research/data + an owner call) — like 0074/0075's Phase 1. No code until the column decision is made.
- Phases 2 + 3 are independent of the column decision (they stop reading/writing `tax_override` regardless). Phase 4 is the only column-dependent phase.
- `tax`/`total` are persisted snapshot columns on `quotes` — confirm in Phase 1 that no read/render path recomputes from `tax_override` live (if so, removing the write path can't retroactively change a sent quote, making the whole change low-risk).

### Phase Checklist

#### Phase 1: Decision gate — prod data-impact check + column keep/drop
- [x] ~~Needs `gcloud auth login` — count prod quotes with `tax_override IS NOT NULL` by status~~ — **deferred (informational only under Option A; prod token expired)**. Sandbox baseline captured: 5 overridden (3 sent + 2 accepted). See [`decision.md`](decision.md).
- [x] Confirmed **no read/render path recomputes `tax` from `tax_override`**: `sendQuote` + `render-quote.ts` use the persisted `quotes.tax`/`total` snapshot; only the edit-time write path + the composer live preview use the override. So removal can't retroactively change a sent quote.
- [x] **Owner decision: Option A — keep the column (expand→contract, no migration).** Recorded in [`decision.md`](decision.md).
- [x] Sandbox baseline captured: 5 overridden (3 sent + 2 accepted).

#### Phase 2: Composer UI — Tax field display-only
- [x] Removed the override-mode branch + the **Override** link → Tax field is now 2 states: no-province hint + auto display (value + `auto · X%` pill).
- [x] Dropped `taxOverride` from `quoteFormSchema`, `defaultValues`, and the live `computePickedTotals(picked, { ratePct })` call; removed the `errors.taxOverride` FieldError.
- [x] Stopped sending `fd.set('tax', …)` in `onSaveDraft`.
- [x] Dropped `taxOverride` from the `InitialQuote` type + the `/quotes/[id]/page.tsx` prop.
- [x] No-province hint state kept (with the already-shipped spacing fix).

#### Phase 3: Server + pricing — drop the override write/compute path
- [x] `computePickedTotals`: removed `override` from `QuoteTaxBasis`; tax = `subtotal × ratePct`. Updated `pricing.test.ts` (rewrote the override case to auto-tax; removed override-only cases).
- [x] Deleted `parseTaxOverride` + `TAX_RE`; `resolveTaxAmount(subtotal, ratePct)` (no override arg).
- [x] `createQuote` + `setQuoteInputs`: stopped reading the `tax` field + stopped writing `taxOverride`; tax always auto. `setQuoteDealer` re-derives auto tax (no override read).
- [x] Retired `setQuoteTax` (no UI caller — only tests + the gate matrix). Removed from `action-gate-matrix.ts` + `actions.test.ts`.
- [x] `quote-push.ts` guard **kept as defensive** — overrides can't be set any more, so it only fires for a pre-0080 historical quote (fails closed rather than pushing a wrong tax); reworded the message.
- [x] Queries projections **kept** (Option A: column retained; the QB-push guard reads `taxOverride` for historical quotes). The composer's `InitialQuote` no longer carries it (Phase 2).

#### Phase 4: Schema — per the Phase 1 decision
- [x] **Option A (keep) chosen:** no migration. Added a retained-but-unused comment on `quotes.tax_override` (`schema/quotes.ts`) marking it 0080-unused, kept for historical overrides + the QB-push guard, droppable in a later contract chunk.
- [x] ~~Option B (drop now via migration)~~ — not chosen; see [`decision.md`](decision.md).

#### Phase 5: Tests + smoke + wiki
- [x] Test updates landed in Phase 3 (forced by the per-phase gate): `actions.test.ts` (dropped `setQuoteTax` + override-persist), `pricing.test.ts` (auto-tax). `queries.test.ts` / `status-display.test.ts` fixtures keep `taxOverride: null` (the `Quote` type retains the column — Option A) and stay valid; `quote-push.test.ts`'s override-rejection case now exercises the **historical-quote defensive guard** — still valid, no change.
- [~] Smoke (web-test): the Tax field shows the `auto · X%` pill with **no Override link** — **deferred to the chunk-end `/eval`** (the build two-tier gate runs browser smoke there, not per-phase).
- [x] Wiki: `data-model.md` (tax model → `round(subtotal × tax_pct/100)`; `tax_override` retained-but-unused; ERD + summary + pre-flight note), `log.md` entry. (`commercial-spine.md` doesn't carry the tax-model formula — nothing to drop there.)
