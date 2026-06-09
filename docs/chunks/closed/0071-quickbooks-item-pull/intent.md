# QuickBooks as Item Master (pull-only mirror; remove in-app catalog CRUD) — Intent

**Created:** 2026-06-09
**Scope pivot:** 2026-06-09 — owner decision: **QuickBooks is the item master.** Earlier framing (app-curated catalog, link-only, never-clobber) is replaced by: QBO owns items, the app mirrors them, and the app can no longer CRUD items. See *Why now*.

## Problem

Chunk [0070](../0070-quickbooks-dealer-push/plan.md) closed the **dealer** loop. Items, though, are still owned **in-app**: `service_items` is an owner-curated catalog edited via `/admin/lookups`, with no link to QuickBooks. Two problems:

1. **No `ItemRef` for Estimates.** Slice 3 (Quotes → QBO Estimates) needs every quote-line SKU linked to a QBO `Item` (`SalesItemLineDetail.ItemRef`). Today none are.
2. **Two masters.** The business keeps its real item/price list in QuickBooks. Maintaining a *separate* hand-edited catalog in the app means drift and double-entry.

The owner's decision resolves both: **QuickBooks becomes the single item master.** The app stops being a place where items are created or edited; it becomes a **read-through mirror** of the QBO Item list, refreshed on demand.

## Desired outcome

- `service_items` carries a nullable, uniquely-indexed `quickbooks_id` (mirror of `dealers.quickbooks_id`).
- An admin runs **"Pull items"** on `/admin/quickbooks`. One pull makes the local catalog match QBO's active Item set:
  - **Create** new `service_items` for QBO Items we don't have.
  - **Update** linked rows so `label` / `unit_price` / `description` **match QBO** (QBO wins — local values are overwritten).
  - **Archive** linked rows whose QBO Item is no longer active/present (auto-mirror of QBO removals).
  - **Purge legacy** — any pre-existing `service_items` with no QBO link (`quickbooks_id IS NULL`) are **hard-deleted** as part of the pull (the deprecation of the old hand-made SKUs). Because the pull upserts QBO items *first* and purges last, the catalog is never empty mid-operation.
- **The app can no longer CRUD items.** The `createServiceItem` / `updateServiceItem` / `archiveServiceItem` Server Actions and the `/admin/lookups` catalog editor are removed; their gate-matrix rows go with them. Items are **read-only** in-app — viewable (and pull-triggerable) on `/admin/quickbooks`, and selectable in the quote composer.
- The quote composer's item picker reads only **non-archived** items (all of which are QBO-sourced after the legacy purge).
- Historical quotes are unaffected: `quote_line_items` snapshots `code`/`label`/`description`/`unit_price` at save time and its `service_item_id` FK is `set null` on delete, so purging/archiving catalog rows never breaks a past quote or its PDF.

## Non-goals

- **Pushing Items *to* QBO** (create-from-app) — QBO is master; the app never writes Items. Pull-only.
- **Quotes → QBO Estimates push** (Slice 3) — this slice only establishes the QBO-mastered, `ItemRef`-linked catalog it depends on.
- **Tax-rate alignment pull** — separate later slice.
- **Webhooks / CDC / living sync** — the mirror is refreshed by an **admin-triggered, on-demand pull**, not a subscription. (Auto-archive-on-pull is as "live" as it gets here.)
- **Inventory accounting** (quantities, COGS, stock) — Items matter only as quote-line SKUs.
- **Reworking `quote_line_items` snapshot discipline** — it already protects history; untouched.

## Success criteria

- Migration adds `service_items.quickbooks_id` (nullable) + a **unique partial index** (`WHERE quickbooks_id IS NOT NULL`), applied to **sandbox** (5432 pooler) before any deploy.
- A pull makes `service_items` reflect QBO's active Item set: new Items created, linked rows' `label`/`price`/`description` overwritten from QBO, QBO-removed items archived, and legacy (`quickbooks_id IS NULL`) rows hard-deleted.
- Re-running an unchanged pull is idempotent (no dupes, no churn beyond no-op updates).
- **No in-app path creates/edits/deletes an item** outside the pull: the catalog Server Actions + the `/admin/lookups` editor are gone, and `pnpm check:capability-pairing` / the gate-matrix suite are consistent with their removal.
- The quote composer still lists pickable items (non-archived, QBO-sourced); historical quotes render unchanged.
- The pull is a **Server Action**, admin-gated (`assertCan('admin:access')`), gate-matrix-registered.
- `tsc` + tests green; chunk-end `/eval` PASS; browser smoke shows the read-only Items list + "Pull items" on `/admin/quickbooks` and the absence of item-edit controls on `/admin/lookups`.
- Sandbox-only this slice (prod QBO is connected as of 2026-06-09, read verified; the column ships to prod on the next prod migration run).

## Open questions

- **Match key for the initial link.** After the legacy purge there are no unlinked rows, so steady-state matching is purely by `quickbooks_id`. For the *first* pull, do we attempt a `code`-match between an existing SKU and a QBO Item (to carry a row forward), or skip matching entirely and just create-from-QBO + purge-legacy? **Default: skip code-matching — create all QBO items fresh, hard-delete all legacy rows.** Simpler and unambiguous given hard-delete. (A `code`-match would only save a row id that nothing durable depends on.) Confirm.
- **`code` derivation + uniqueness.** New rows need a `code` (immutable, `UNIQUE`). Derive from QBO `Sku` (trimmed) else slugified `Name`; two Items → same derived code ⇒ suffix-disambiguate or skip-and-report. Confirm the source field priority.
- **QBO Item types.** Include **Service + NonInventory**; skip **Category / sub-items / Bundle/Group**. Does the owner's QBO company sell Inventory-type Items on quotes? If so, include Inventory too.
- **Empty-catalog guard.** If a pull would archive/purge the entire catalog (e.g. QBO returned zero Items due to a transient error), abort rather than wipe. Worth a safety check.

## Why now

The owner decided QuickBooks is the system of record for items and that the app should stop maintaining its own catalog. Doing this as Slice 2 (a) removes the double-entry/drift problem immediately, (b) gives every SKU a `quickbooks_id` — the exact `ItemRef` Slice 3's Estimate push needs, and (c) reuses 0069's sync-diff machinery. Prod QBO is connected (read verified 2026-06-09), so the pull has a real Item list to mirror once deployed.

## Follow-on slices (context, not in scope here)

1. ~~Slice 1 — Dealers → QBO Customers push~~ ✅ shipped (0070).
2. **This chunk — Slice 2:** QBO = item master; pull-mirror into `service_items`; remove in-app item CRUD.
3. **Slice 3:** Quotes → QBO **Estimates** push — uses 0070's `CustomerRef` + this slice's `ItemRef` + the aligned tax.
4. **Tax-alignment pull:** QBO tax codes/rates → app.
