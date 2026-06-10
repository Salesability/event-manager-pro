# Quote → QBO Estimate Push (Slice 3) — Intent

**Created:** 2026-06-09

## Problem

The bidirectional QuickBooks effort has connected **dealers** ([0070](../0070-quickbooks-dealer-push/plan.md) — `dealers.quickbooks_id` = `CustomerRef`) and **items** ([0071](../0071-quickbooks-item-pull/plan.md) — `service_items.quickbooks_id` = `ItemRef`). But the **commercial document** — the quote — still lives only in the app. The business keeps its estimates/A-R in QuickBooks; today every accepted quote has to be re-keyed there by hand.

This is **Slice 3, the last build slice**: push a quote → QBO **Estimate**, on-demand, reusing the two reference links the prior slices established. It's unblocked precisely because dealers carry a `CustomerRef` and items carry an `ItemRef`.

## Desired outcome

- An admin viewing a quote can click **"Push to QuickBooks"** to create or update a QBO **Estimate** for it.
  - **Unlinked quote** → **create** an Estimate, then **backfill** the returned `Id` onto `quotes.quickbooks_estimate_id` (idempotent — a re-push never double-posts).
  - **Linked quote** → **update** the existing Estimate with a freshly-read `SyncToken` (read-before-write, like the dealer push).
- The Estimate mirrors the quote: `CustomerRef` ← the dealer's `quickbooks_id`; one `Line` per `quote_line_items` row with `ItemRef` ← the SKU's `quickbooks_id`, qty, and `effectiveUnit` price; the quote's computed **tax** carried so the Estimate total matches the quote.
- A **pre-flight link check** blocks a broken push with a clear message: the dealer must be QBO-linked, and **every** line-item SKU must be QBO-linked — otherwise there's no `CustomerRef`/`ItemRef` to build the Estimate.
- The push is a **Server Action** (repo convention), admin-gated, registered in the gate matrix; the button renders only when QBO is connected.

## Non-goals

- **Invoices** — Estimate only (owner's call). Invoice/payment is a later/Stripe concern.
- **Auto-push on accept** — on-demand button only, never a side effect of accepting a quote.
- **True QBO tax-code alignment** — we send the quote's *already-computed* tax as an override so the totals match; mapping province → QBO `TaxCode` and letting QBO compute is the separate **tax-alignment pull** slice.
- **Pulling QBO Estimates → app quotes** — push-only (app → QBO).
- **Payment / Stripe / webhooks / living sync.**

## Success criteria

- Migration adds `quotes.quickbooks_estimate_id` (nullable) + a **unique partial index** (`WHERE … IS NOT NULL`), applied to **sandbox** first.
- Pushing an **unlinked, fully-linked-prerequisites** quote creates a QBO Estimate and backfills its `Id` (guarded `UPDATE … WHERE id=? AND quickbooks_estimate_id IS NULL`).
- Pushing a **linked** quote updates the existing Estimate with a fresh `SyncToken` (no stale-token 400). Re-pushing is idempotent.
- The pre-flight check fails closed with an actionable error when the dealer or any line SKU is unlinked (no partial/broken Estimate posted).
- The Estimate's `CustomerRef`, line `ItemRef`s, quantities, prices, and total match the quote.
- Server Action, admin-gated, gate-matrix row; button gated on a live QBO connection.
- `tsc` + tests green; chunk-end `/eval` PASS; browser smoke shows the button on a quote (sandbox, where items are linked).

## Open questions

- **Pushable statuses.** Owner: *"accepted quotes → Estimates."* Default: allow **`accepted`** (and likely **`sent`**) to push; block `draft`/`declined`? Confirm whether `sent` should be pushable. (`quote_status` ∈ draft/sent/accepted/declined.)
- **Tax mapping.** Default: send the quote's computed tax (`quotes.tax`, derived from `tax_pct` + `tax_override`) as a `TxnTaxDetail.TotalTax` with `GlobalTaxCalculation = TaxExcluded`, so the Estimate total equals the quote total exactly. (Real QBO `TaxCode` mapping is the tax-alignment slice.) Confirm.
- **Gating.** The quote page is `quote:edit` (admin || coach). Default the *push action* to **`admin:access`** (accounting integration is admin), rendering the button for admins only. Confirm vs allowing coaches.
- **Variable-price / null-price lines** (`travel`): the line snapshots a concrete `unitPrice`/`override` at save, so it maps fine; confirm no special-casing needed.
- **The `travel`/`fee` top-level quote charges** (`quotes.fee`, `quotes.travel`) vs line items — are those already represented as `quote_line_items` rows, or separate columns that need their own Estimate lines? Resolve during Phase 3 against the actual composer output.

## Why now

Slices 1 + 2 shipped and are **live on prod** (rev `-00012-fks`). The reference links the Estimate push depends on now exist, the OAuth/client/push-core machinery is warm (0070), and pushing the commercial document is the payoff that turns "QBO knows our customers and items" into "QBO knows our deals."

**Prod caveat:** prod `service_items` are currently all **unlinked** (no prod "Pull items" has run), so a *prod* Estimate push will fail the pre-flight until the prod catalog is QBO-linked (which is itself gated on curating the prod QBO company). **Sandbox items are linked** (a sandbox pull ran), so sandbox is fully testable.

## Follow-on (context, not in scope)

- **Tax-alignment pull** — QBO `TaxCode`/`TaxRate` → app, so quote tax is computed from QBO's codes and the Estimate uses a real `TaxCodeRef` instead of an override.
- Possibly **Invoices** from accepted Estimates, if the business wants A/R in QBO.
