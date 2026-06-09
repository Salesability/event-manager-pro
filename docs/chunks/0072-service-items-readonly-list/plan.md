# Read-only Service-Items Catalog Viewer — Plan

**Intent:** [`intent.md`](intent.md)
**Started:** 2026-06-09

## Progress Tracker

| Phase | Status | Commit |
|-------|--------|--------|
| 1: `loadServiceItemsForAdmin` loader + `service-items-list.tsx` component | Done | `5a83d84` |
| 2: Wire into `/admin/quickbooks` page + tests + smoke | Pending | - |

Small follow-up to 0071. 0071 removed the in-app catalog editor, leaving no plain "view my service items" UI; this adds a **read-only** "Service items" list on `/admin/quickbooks` (code · label · price · QB-linked? · archived?), rendered independent of the QBO connection. "Done" = the list renders the full catalog (incl. archived) with linked/archived badges; no mutation path; chunk-end `/eval` PASS.

## Code Anchors

For each new file or method below, the builder reads the anchor first and matches its shape (length, error handling, naming, query style). For modifications to an existing file, the anchor is the nearest sibling method in that same file.

| New code | Anchor (`path:line`) | Why this anchor |
|----------|---------------------|-----------------|
| `loadServiceItemsForAdmin()` + `ServiceItemAdminRow` type in `src/features/services/queries.ts` | `src/features/services/queries.ts:15-29` (`loadServiceItems` + `ServiceItem`) | same file/loader shape; drop the `isNull(archivedAt)` filter, add `quickbooksId` + `archivedAt`, order by `code` |
| `src/features/services/service-items-list.tsx` (read-only table) | `src/features/quickbooks/quickbooks-admin.tsx` Items change-set table (`<Table>`/`<TableHead>`/`<TableBody>` + `<Badge>`) | same catalyst `<Table>` shell + `<Badge>` idiom; strip all `<form action>`/buttons (read-only) |
| Page wire in `src/app/(app)/admin/quickbooks/page.tsx` | the existing loads + `<QuickbooksAdmin .../>` render in that page | load the catalog **outside** the `if (conn)` block (connection-independent) and render `<ServiceItemsList>` above `<QuickbooksAdmin>` |

**Conventions referenced:**
- `docs/wiki/data-model.md` — `service_items` (post-0071: QBO-mastered, `quickbooks_id` link, `archivable`).
- `CLAUDE.md` → Conventions — read-only surface, no Server Action needed; page already `assertCan('admin:access')`.

**Overall Progress:** 50% (1/2 phases complete)

**Note:**
- Pure additive read-only UI — no schema, no migration, no Server Action, no gate-matrix row.

### Phase Checklist

#### Phase 1: Loader + component
- [x] Added `ServiceItemAdminRow` type + `loadServiceItemsForAdmin()` to `src/features/services/queries.ts` — selects `id, code, label, unitPrice, description, quickbooksId, archivedAt` (no `archivedAt` filter), `orderBy(asc(code))`. `loadServiceItems` (composer feed) left untouched.
- [x] New `src/features/services/service-items-list.tsx` — server component, read-only `<Table>` (Code · Label · Price · QuickBooks · Status); price `$<unitPrice>` / "variable"; Linked/— + Archived/Active badges; counts header; empty-state row. No buttons/forms.
- [x] Render test (`service-items-list.test.tsx`, node-env walk-the-tree pattern à la `token-pill.test.tsx`): rows + price + Linked/Archived/Active badges + counts header + empty-state.
- [x] (Drive-by) made 0071's `item-sync.test.ts` archive assertion resilient to shared sandbox state (`>= 1`, `2535934`) — a local sandbox "Pull items" had replaced the seeded catalog with 14 linked QBO sample items, inflating the blanket-archive count.

#### Phase 2: Page wire + tests + smoke
- [ ] In `src/app/(app)/admin/quickbooks/page.tsx`: call `loadServiceItemsForAdmin()` **unconditionally** (outside the `if (conn)` block) and render `<ServiceItemsList items={catalog} />` above `<QuickbooksAdmin .../>` (so it shows whether or not QBO is connected).
- [ ] `tsc` + `pnpm test` green.
- [ ] Smoke (web-test, gated): `goto /admin/quickbooks` (admin auth) → a "Service items" list renders the current catalog — e.g. a row with code `base-event`, its label + price, and Active/Archived + Linked/— badges. Read-only (nothing to click). Screenshot.
- [ ] (Optional) one-line `docs/wiki/data-model.md` note that the read-only catalog viewer lives on `/admin/quickbooks` + `docs/wiki/log.md` entry.
