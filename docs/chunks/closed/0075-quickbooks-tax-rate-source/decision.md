# 0075 Decision — QuickBooks as Tax-Rate Source of Truth

**Date:** 2026-06-10
**Status:** Accepted (Phase 1 research/decision gate resolved)

## Context

[0074](../0074-quickbooks-tax-alignment/plan.md) linked each province to a QB tax code by **rate-equality** — circular once the goal is to pull QB's *possibly-different* rate. The owner's call (2026-06-10): **QuickBooks is the source of truth for tax rates** — pull QB's rate per province into `tax_rates.rate`, mirroring how [0071](../0071-quickbooks-item-pull/plan.md) made QB the *item* master.

## The crux — jurisdiction matching → NAME HEURISTIC (auto)

Owner steer ("don't map, just sync"): match each province to a QB tax code by **name**, automatically, on every pull. No manual mapping table/UI.

- **How:** a province matches a code whose name carries the jurisdiction — the 2-letter province code as a **word token** ("HST ON" → ON) or the full province name ("Ontario …" → ON), case-insensitive.
- **Confident 1:1 only:** exactly one active, rate-resolvable code names the province → `linked` (adopt its rate). Zero → `unmatched`. More than one → `ambiguous`.
- **Why not manual mapping:** the probe (2026-06-10) found QB tax codes have **no province field** and CA customers have **no `DefaultTaxCodeRef`**, but a code's *name* reliably carries the jurisdiction for HST provinces (the clean case — and all the CA sandbox has). A manual mapping store/UI is heavier than the data warrants for v1.
- **Known fragility (accepted):** GST+PST / QST provinces (BC, QC, …) use multiple/grouped codes whose names may not 1:1 a province → they land `ambiguous`/`unmatched` and stay app-managed. The per-province override that would resolve these is **deferred** (decision 3).

## Owner decisions (2026-06-10)

1. **Unmatched/ambiguous provinces → keep app rate, flag unmanaged.** Non-destructive: the province keeps its existing `tax_rates.rate` as a fallback; `quickbooks_tax_code_id` stays null. Quotes still gate on the existing 0074 push pre-flight (fails closed on an unmapped taxed province). *(Chosen over blocking quotes.)*
2. **In-app tax-rate editor → removed entirely.** Delete the editor (`updateTaxRate` action, `TaxRatesAdmin` component, `tax-rate-schema` + its test) + drop it from `/admin/lookups` + remove the gate-matrix row — mirroring how 0071 removed in-app item CRUD. *(Chosen over a read-only display.)* Admins no longer see/edit rates on `/admin/lookups`; rates are QB-driven and surfaced via the `/admin/quickbooks` "Pull tax codes" result. A read-only viewer could be added later (the [0072](../0072-service-items-readonly-list/plan.md)-for-items precedent) if the owner misses the at-a-glance view.
3. **Per-province override UI → deferred.** Ship only the auto name-match + rate adoption now — clean for Ontario's single "HST ON" code, the only thing testable in the CA sandbox. Ambiguous/unmatched provinces are flagged; the manual per-province code-picker that would resolve GST+PST/QST lands when prod (or a fuller sandbox) has multi-province codes to verify against.

## Resolved sub-questions

- **Schema:** infer "managed" from `quickbooks_tax_code_id IS NOT NULL` — **no new column, no migration** for 0075.
- **Rate-drift guard (0074 push pre-flight):** **keep** as a cheap safety net.
- **`quotes.tax_pct` snapshot:** unchanged — still reads `tax_rates.rate` at quote-save, now QB-sourced.

## What replaces the rate matcher

`tax-sync.ts`'s rate-based `matchProvinceTaxCode` / `resolveProvinceLinks` are replaced by name-based matching:

- `codeNamesProvince(name, province)` — pure name → jurisdiction test (token + full-name, word-boundary on the abbreviation).
- `resolveProvinceLinksByName(appRates, qboCodes, rateById)` — per-province confident match; returns `{ province, taxCodeId, ratePct, status }`.
- `planTaxRateWrites(appRows, links)` — pure write planner (adopt rate + code on `linked`; clear a stale code only on unmanaged; omit no-ops).
- `applyTaxCodeSync` executes the planned writes (now also writing `tax_rates.rate`).

`resolveCodeRatePct` is **kept** (reused to get the rate to adopt). The pure split (resolve → plan → execute) mirrors item-sync's `classifyItemSyncPlan` / `applyItemSync`, so the new behaviour is unit-tested without touching a DB (avoids the parked DB-integration flakiness).

## Scope / blocker

Build + verify **Ontario** rate adoption on the CA sandbox (realm `9341457252668239`, ON-only — [[project_qbo_realms]]). Multi-province alignment is deferred to prod (or a fuller sandbox). No prod cutover in this chunk.

## References

- [`intent.md`](intent.md) (this chunk) · [0074 decision](../0074-quickbooks-tax-alignment/decision.md) (rate matcher being replaced) · [0071](../0071-quickbooks-item-pull/plan.md) (QB-as-master + editor-removal precedent) · [0072](../0072-service-items-readonly-list/plan.md) (read-only viewer precedent, if a rates viewer is later wanted).
