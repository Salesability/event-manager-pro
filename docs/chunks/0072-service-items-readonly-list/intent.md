# Read-only Service-Items Catalog Viewer — Intent

**Created:** 2026-06-09

## Problem

Chunk [0071](../closed/0071-quickbooks-item-pull/plan.md) made QuickBooks the item master and **removed the in-app catalog editor** (the `/admin/lookups` `ServicesAdmin` section + the create/update/archive actions). That was intentional — but it also removed the only place to **see** the `service_items` catalog. Today an admin has no plain "what's in my catalog?" view:

- `/admin/lookups` no longer lists items.
- `/admin/quickbooks` → **Items** is a QBO *change-set preview* (Create / Update / Archive / **Purge**), not a catalog list — it hides unchanged rows and currently renders the real unlinked SKUs as alarming "Purge" rows.
- The only place items actually appear is the **quote composer's line-item picker**, buried inside quote creation.

The owner's 0071 decision was *"read-only list + Pull on /admin/quickbooks"*; only the Pull/change-set shipped, not the **list**. This chunk fills that gap.

## Desired outcome

- A **read-only "Service items" list** on `/admin/quickbooks` showing the current `service_items` catalog at a glance: **code · label · unit price · QuickBooks-linked? · archived?**.
- It renders **independent of the QBO connection** (it reads the local catalog, so it shows even when QBO isn't connected) and sits above/beside the existing QBO change-set so the two read naturally together.
- A small "QB linked" badge when `quickbooks_id` is set; an "Archived" badge for archived rows; a count header.
- **Read-only** — no edit/create/delete affordances (QBO stays the master; CRUD stays removed).

## Non-goals

- **Re-introducing item CRUD** — editing/creating/deleting items stays removed; QBO is the master.
- **The QBO Items change-set / Pull action** — those already exist (0071); this is a *separate* plain catalog list.
- **Slice 3 (Quotes → QBO Estimates)** — unrelated.
- **Schema / migration / Server Action** — pure additive read-only UI; nothing to write.

## Success criteria

- `/admin/quickbooks` shows a "Service items" list rendering every catalog row (incl. archived), with linked/archived badges, ordered by `code`.
- The list renders whether or not QBO is connected.
- No new mutation path (no Server Action, no gate-matrix row); admin-gated via the page's existing `assertCan('admin:access')`.
- `tsc` + tests green; chunk-end `/eval` PASS; browser smoke shows the list with a known SKU (e.g. `base-event`).

## Open questions

- **Placement:** a new standalone component rendered by the page (decoupled from the QBO-connection block) vs. a section inside `quickbooks-admin.tsx`. **Default: a new `service-items-list.tsx`** rendered by the page above `QuickbooksAdmin`, so it shows regardless of connection state. Confirm.
- **Include archived rows?** Default **yes** (with an "Archived" badge) so the admin sees the full picture; could filter later.

## Why now

The gap is live and was just hit in practice ("is there a UI to see the service items?"). It's a small, non-destructive, read-only addition that restores visibility the 0071 CRUD-removal took away — useful before/after any prod "Pull items".
