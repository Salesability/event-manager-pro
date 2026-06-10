# QuickBooks as Tax-Rate Source of Truth — Intent

**Created:** 2026-06-10

## Problem

Tax rates live in **two** places: the app's admin-editable `tax_rates` table ([0065](../closed/0065-dealer-province-tax/plan.md)) **and** the connected QuickBooks company. [0074](../closed/0074-quickbooks-tax-alignment/plan.md) linked each province to a QB tax **code** by *rate-equality* — so a *mapped* province happens to be aligned, but:
- a province whose app rate ≠ any QB code's rate never links (stays unmapped → fails the push pre-flight), and
- editing a rate in the app afterward can drift it from QB.

The owner's call (2026-06-10): **QuickBooks should be the source of truth for tax rates** — one set of rates, driven by QB, so they can't disagree.

## Desired outcome

- Pulling from QB **adopts QB's rate** into `tax_rates.rate` for each province it can map — the app no longer hand-maintains rates.
- The in-app tax-rate **editor becomes read-only** ("managed by QuickBooks"), mirroring how [0071](../closed/0071-quickbooks-item-pull/plan.md) made QB the *item* master and removed in-app item CRUD.
- A province is matched to its QB code by **jurisdiction/identity**, not by rate (rate-matching is circular once the goal is to pull QB's *possibly-different* rate).
- Quote tax still computes from `tax_rates.rate` (now QB-driven) — nothing downstream changes; the Estimate push (0074) keeps stamping the per-line `TaxCodeRef`.
- Provinces QB has **no** code for keep their existing app rate as a **fallback**, clearly marked "not managed by QuickBooks".

## Non-goals

- **Pushing rates TO QB** — QB → app only.
- **Changing quote tax computation** beyond swapping the rate's source.
- **Prod deploy / prod cutover** (separate; gated on prod QB tax setup).
- The parked **0074 follow-up (a)** (taxed→untaxed re-push stale code).
- Bidirectional/real-time tax sync — an on-demand admin pull, like the item pull.

## Success criteria

- After "Pull tax codes/rates", every province mapped to a QB code has `tax_rates.rate` == QB's rate for that code (verified for **Ontario** on the CA sandbox — the only province configured there).
- Matching is by **jurisdiction**, so a province links to its QB code even when the app's stored rate differs (and then the rate is corrected to QB's).
- The tax-rate editor on `/admin/lookups` is **read-only** (no `updateTaxRate` mutation reachable); a clear "managed by QuickBooks" affordance.
- Provinces with no QB code retain their app rate + are visibly flagged unmanaged; quotes on them still behave per the 0074 pre-flight.
- `tsc` + tests green; chunk-end `/eval` PASS.

## Open questions

### ⚠️ The crux — jurisdiction matching (likely a Phase-1 research/decision gate)
A province can no longer be matched to its QB code by rate. How to match by **jurisdiction**?
- **(a) Manual admin mapping** — an admin picks the QB tax code for each province (most robust; QB Canadian code names vary — "HST ON", "GST/PST BC", "GST", …). Adds a small mapping UI.
- **(b) Name heuristic** — match a province to a code whose name contains the province abbreviation / expected tax type. Fragile across naming conventions.
- **(c) Hybrid** — heuristic as a default suggestion, admin override.
- → **Owner input likely needed.** Phase 1 is a research/decision gate; the implementation phases are provisional until it's answered.

### Other questions
1. **Provinces with no QB code** (most, in the CA sandbox) — keep the app rate as fallback (recommended) vs block quotes for them? Mark "unmanaged"?
2. **Editor: read-only display vs removed entirely** (0071 removed the item editor outright). Read-only-with-display is friendlier for tax rates (admins still need to *see* them).
3. **Schema:** add an `is_qb_managed` / `source` column, or infer "managed" from `quickbooks_tax_code_id IS NOT NULL`? (Leaning: infer — no new column.)
4. **The 0074 rate-drift guard** (push pre-flight): keep as a safety net, or drop it (rates can't drift if QB drives both)? Probably keep — cheap insurance.
5. **`quotes.tax_pct` snapshot** still reads `tax_rates.rate` at quote-save — unchanged, just now QB-sourced.

### Hard dependency / blocker
The CA sandbox (realm `9341457252668239`, [[project_qbo_realms]]) **only has Ontario configured**, so only ON's rate can be pulled/aligned in sandbox. Full multi-province alignment needs the **prod** QB company to have every province's tax code set up — or tax codes added to the CA sandbox for testing. **Build + verify ON in sandbox; defer multi-province verification to prod** (or a fuller sandbox).

## Why now

0074 just proved the quote→Estimate-with-tax path works live (HST ON 13% on Estimate `182`), and surfaced the dual-source awkwardness. Resolving it now — QB authoritative — removes the drift risk and the "which number is right?" ambiguity before the integration goes to prod.

## Relationship to prior work

- **[0074](../closed/0074-quickbooks-tax-alignment/plan.md)** — the tax-code mapping + per-line `TaxCodeRef` push this builds on; `tax-sync.ts`'s matcher gets replaced with jurisdiction matching + rate adoption.
- **0065** — the province `tax_rates` table whose `rate` becomes QB-driven.
- **[0071](../closed/0071-quickbooks-item-pull/plan.md)** — the "QB is master → remove in-app editing" precedent for the read-only rate editor.
