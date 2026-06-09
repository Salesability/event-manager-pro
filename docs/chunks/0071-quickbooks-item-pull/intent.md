# QuickBooks Item Pull (QBO Items → `service_items`) — Intent

**Created:** 2026-06-09

## Problem

Chunk [0070](../closed/0070-quickbooks-dealer-push/plan.md) closed the **dealer** loop (push a dealer → QBO Customer; `dealers.quickbooks_id` now written both ways). But our quote line-item catalog (`service_items`) has **no link to QuickBooks at all**. That blocks the high-value slice — **Slice 3, Quotes → QBO Estimates** — because every Estimate line needs a `SalesItemLineDetail.ItemRef` pointing at a QBO `Item`. We can't post an Estimate line for a SKU QBO doesn't know about.

This is **Slice 2** of the bidirectional effort: pull the connected QBO company's Items into `service_items` and link them, so every SKU we'd put on a quote carries a stable QBO Item Id. Per the owner's call, items are **pull-only** (QBO → app) — we don't create Items in QBO from the app.

## Desired outcome

- `service_items` carries a nullable, uniquely-indexed `quickbooks_id` column (mirror of `dealers.quickbooks_id`).
- An admin on `/admin/quickbooks` sees, alongside the dealer change-set, an **Items** change-set — for each QBO Item, the computed action against our catalog:
  - **Create** — no match; a new `service_item` will be inserted from this QBO Item.
  - **Link → `code`** — matched an existing catalog row by `code` with no QB Item Id; the QB Item Id backfills onto it.
  - **Already linked** — matched by `quickbooks_id`; no-op (idempotent).
  - **Skip** — a `code` collision already linked to a *different* QB Item Id, or a non-syncable Item (Category / sub-item / nameless).
- A deliberate **"Pull items"** button applies the change set through one path (match-by-`quickbooks_id` → match-by-`code` & backfill → insert).
- Owner-curated catalog fields are **never clobbered**: an existing row's `label` / `unit_price` / `description` are left as-is on a `code` match — only `quickbooks_id` is backfilled. (New rows are inserted from the QBO Item's Name / UnitPrice / Description.)
- After apply, the page re-renders to the new state with a summary (created N · linked M · skipped K).

## Non-goals

Deferred to later slices / out of scope here:

- **Pushing Items *to* QBO** (create-from-app) — pull-only this slice.
- **Quotes → QBO Estimates push** (Slice 3) — this slice only establishes the `ItemRef` link it depends on.
- **Tax-rate alignment pull** (QBO tax codes/rates → app) — separate later slice.
- **Refreshing local price/label from QBO on re-pull** — link-only on a `code` match; the catalog is owner-curated and stays the source of truth for display/pricing. (A future "sync prices from QBO" toggle could revisit this.)
- **Inventory accounting** — quantities, COGS, stock. We only care about Items as quote-line SKUs (Service / NonInventory).
- **Webhooks / CDC / living sync / auto-pull** — admin-triggered, on-demand, same as 0069.

## Success criteria

- Migration adds `service_items.quickbooks_id` (nullable) + a **unique partial index** (`WHERE quickbooks_id IS NOT NULL`), applied to **sandbox** (5432 session pooler) before any deploy.
- Re-running "Pull items" against an unchanged QBO company is a no-op (idempotent) — no duplicate rows, no re-links.
- A pull against a catalog that already has a SKU with the same `code` as a QBO Item backfills the QB Item Id onto it (link), rather than inserting a duplicate.
- A QBO Item with no catalog match is inserted as a new `service_item` carrying the QB Item Id.
- Owner-curated `label` / `unit_price` / `description` on an existing matched row are **never overwritten**.
- The pull is a **Server Action** (repo convention), admin-gated via `assertCan('admin:access')`, registered in the gate matrix.
- The connected `/admin/quickbooks` page renders the per-Item change set (read-only on load) + a "Pull items" button + a post-pull summary.
- `tsc` + tests green (unit: map + classify; integration: `applyItemSync` precedence in rolled-back txns); chunk-end `/eval` PASS; browser smoke shows the Items change-set + button.
- Sandbox-only this slice; the column ships to prod when prod migrations run (prod QBO is connected as of 2026-06-09, read verified).

## Open questions

- **Match key — QBO `Sku` vs `Name` vs our `code`.** Our `service_items.code` is immutable + unique. QBO's `Sku` is the natural equivalent but is often blank; `Name` is always present. **Default: match QBO `Sku` against our `code` when Sku is present; else derive a `code` from a slugified `Name`.** New-row `code` derivation must stay unique (the column is `UNIQUE`) — collision → suffix or skip-and-report. Confirm.
- **QBO Item types.** `Item.Type` ∈ {Service, NonInventory, Inventory, Category, Group/Bundle}. For quote-line SKUs we want **Service + NonInventory**; **skip Category and sub-items** (parent/child like QBO Jobs in 0069) and Bundles. Confirm — does the owner's QBO company use Inventory Items as sellable lines?
- **`code` uniqueness on insert.** Our `code` column is `UNIQUE` (not partial). Two QBO Items slugifying to the same `code`, or a QBO Item whose derived `code` collides with an existing *unlinked* row of a different identity → must skip-and-report, not error the batch.
- **Inactive items.** Active-only by default (matches `fetchCustomers`)? Confirm.

## Why now

Slice 1 (0070) shipped and merged; the QBO read/write plumbing, token store, and the `dealers.quickbooks_id` link pattern are warm. Prod QBO is now connected (read verified 2026-06-09). Item linking is the **one missing prerequisite** for the high-value Slice 3 (Estimates) — doing it next keeps the bidirectional effort on its critical path and reuses 0069's sync-diff machinery near-verbatim.

## Follow-on slices (context, not in scope here)

1. ~~Slice 1 — Dealers → QBO Customers push~~ ✅ shipped (0070).
2. **This chunk — Slice 2:** QBO Items → `service_items` pull + link.
3. **Slice 3:** Quotes → QBO **Estimates** push — uses 0070's `CustomerRef` (`dealers.quickbooks_id`) + this slice's `ItemRef` (`service_items.quickbooks_id`) + the aligned tax.
4. **Tax-alignment pull:** QBO tax codes/rates → app so a quote's computed tax matches QBO.
