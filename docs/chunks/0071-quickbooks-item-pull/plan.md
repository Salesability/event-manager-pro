# QuickBooks as Item Master (pull-only mirror; remove in-app catalog CRUD) — Plan

**Intent:** [`intent.md`](intent.md)
**Started:** 2026-06-09

## Progress Tracker

| Phase | Status | Commit |
|-------|--------|--------|
| 1: Schema — `service_items.quickbooks_id` + unique partial index + migration | Done | `8192b9a` |
| 2: `client.ts` `fetchItems` + `item-sync.ts` (create / overwrite-update / archive-missing / purge-legacy) | Done | `194bcd0` |
| 3: Remove in-app item CRUD (services actions + `/admin/lookups` editor + gate-matrix rows) | Done | `bad1005` |
| 4: `/admin/quickbooks` read-only Items change-set + "Pull items" Server Action | Pending | - |
| 5: Tests + smoke verification + wiki ingest | Pending | - |

**Slice 2 of the bidirectional QuickBooks effort, re-scoped 2026-06-09 to "QBO is the item master"** (see [`intent.md`](intent.md)). The app's `service_items` becomes a **read-through mirror** of the connected QBO company's Items, refreshed by an admin **"Pull items"** action; the app can no longer create/edit/delete items. "Done" = the `quickbooks_id` column + index ship to sandbox; a pull makes the catalog reflect QBO (create new · overwrite linked from QBO · archive QBO-removed · hard-delete legacy unlinked rows); the in-app catalog CRUD (actions + `/admin/lookups` editor + gate-matrix rows) is removed; the quote picker still lists pickable items and historical quotes render unchanged; chunk-end `/eval` PASS.

## Code Anchors

For each new file or method below, the builder reads the anchor first and matches its shape (length, error handling, naming, query style). For modifications to an existing file, the anchor is the nearest sibling method in that same file.

| New / changed code | Anchor (`path:line`) | Why this anchor |
|----------|---------------------|-----------------|
| `quickbooks_id` col + unique partial index in `src/lib/db/schema/service-items.ts` | `src/lib/db/schema/dealers.ts:38-52` (`quickbooks_id` + `uniqueIndex ... WHERE quickbooks_id IS NOT NULL`) | the proven 0069 idiom; same nullable-text + partial-unique-index |
| New migration `drizzle/0033_*.sql` | `drizzle/0032_skinny_sister_grimm.sql` (0069 `dealers.quickbooks_id`) | same generate → **verify journal `when`** ([[project_drizzle_journal_when_gotcha]]) → apply-to-sandbox flow |
| `fetchItems` + `QboItem` in `src/lib/quickbooks/client.ts` | `src/lib/quickbooks/client.ts:191-227` (`fetchCustomers` + `QboCustomer`) | same paginated `query` endpoint + `Bearer` + `401 → QboAuthError`, `FROM Item` |
| `src/lib/quickbooks/item-sync.ts` (`mapItemToServiceItem` / `classifyItemSyncPlan` / `computeItemSyncPlan` / `applyItemSync`) | `src/lib/quickbooks/dealer-sync.ts` (whole module) | the sync-diff pattern: pure classify + executor-injected apply, guarded writes, encode/decode summary — extended with overwrite-update + archive-missing + purge-legacy |
| `loadServiceItems` (verify only) | `src/features/services/queries.ts:15-26` (already `WHERE isNull(archivedAt)`) | picker already excludes archived — confirm no change needed |
| **Removals** — `createServiceItem`/`updateServiceItem`/`archiveServiceItem` | `src/features/services/actions.ts:57,97,126` (`capabilityClient('lookup:edit')`) | delete these 3 + their `service-schema.ts` Zod + `actions.test.ts` cases |
| **Removal** — service-item editor section on `/admin/lookups` | `src/app/(app)/admin/lookups/page.tsx:5,31` (`<ServicesAdmin items={services} />`) + `src/features/services/services-admin.tsx` | drop the import + render; delete `services-admin.tsx` |
| **Removal** — gate-matrix rows | `src/features/__tests__/action-gate-matrix.ts:211-228` (createServiceItem/updateServiceItem/archiveServiceItem) | delete the 3 rows so the drift-detection grep stays consistent |
| `pullItemsFromQuickbooks` Server Action in `src/features/quickbooks/actions.ts` | `src/features/quickbooks/actions.ts:95-104` (`syncDealersFromQuickbooks`) | sibling admin-gated action: `assertCan` → `getValidAccessToken` → fetch → apply → `revalidatePath` → `redirect(?summary)` |
| Items change-set + "Pull items" button in `src/features/quickbooks/quickbooks-admin.tsx` | `quickbooks-admin.tsx:111-188` (connected dealer change-set + `<form action>`) | a second change-set section in the same connected view; same `<Table>` + no-JS form |

**Conventions referenced:**
- `docs/wiki/data-model.md` — `service_items` (flat catalog, immutable unique `code`, nullable `unit_price`, `archivable`); `dealers.quickbooks_id` (0070).
- `CLAUDE.md` → Conventions — **mutations are Server Actions**; **invoke `db-conventions` before schema/migrations**.
- Memory [[project_drizzle_journal_when_gotcha]] · [[project_prod_db]] (sandbox-first on 5432; prod QBO connected 2026-06-09 but no prod writes yet).
- `quote_line_items` **snapshot discipline** (0062) + `service_item_id` `set null` on delete — why hard-deleting legacy SKUs is history-safe.

**Overall Progress:** 60% (3/5 phases complete)

**Note:**
- Each phase includes its own tests.
- Integration tests (the `applyItemSync` precedence suite) come in Phase 5 against a real DB in rolled-back transactions.

### Phase Checklist

#### Phase 1: Schema — `service_items.quickbooks_id` + unique partial index + migration
- [x] Invoke the `db-conventions` skill before editing schema.
- [x] Add `quickbooksId: text('quickbooks_id')` (nullable) to `service_items` with a comment (QBO is master; set only by the pull). Converted the table to the `(table) => [...]` form to host the index.
- [x] Add unique partial index `service_items_quickbooks_id_idx` on `(quickbooks_id) WHERE quickbooks_id IS NOT NULL`.
- [x] `pnpm db:generate` → `drizzle/0033_bored_shotgun.sql` — clean `ADD COLUMN` + `CREATE UNIQUE INDEX ... WHERE` (no stray auth statements). **Journal `when` verified ascending** (0033 `1781027979333` > 0032 `1780949870990`).
- [x] Applied to **sandbox** (5432 pooler `aws-1-us-west-2`) via `pnpm db:migrate`; verified col (`text`, nullable) + partial index (`WHERE (quickbooks_id IS NOT NULL)`) via `pg_indexes`. (Prod deferred to next prod migration run.)

#### Phase 2: `client.ts` `fetchItems` + `item-sync.ts`
- [x] `client.ts`: `QboItem` type (Id, SyncToken?, Name, Sku?, Description?, UnitPrice?, Active?, Type, SubItem?, ParentRef?) + `fetchItems(realmId, accessToken, opts?)` — paginated `SELECT * FROM Item` (active-only default), mirroring `fetchCustomers`.
- [x] `item-sync.ts`:
  - `mapItemToServiceItem` (+ `slugifyItemCode`) → `{ qbId, code, label, unitPrice, description, isSyncable }`. `code` = `Sku` trimmed else slugified `Name`; `unitPrice` = `String(UnitPrice)` or null; `isSyncable = Type ∈ {Service, NonInventory}` && !SubItem/!ParentRef && has Name.
  - Pure `classifyItemSyncPlan(items, existing)` → create / update / current / archive / purge / skip (non-syncable + derived-code collision against linked codes / prior creates). Price comparison is numeric-normalized (`75` === `75.00` → `current`, no churn). Archived linked row still in QBO → `update` (revive).
  - DB `loadExistingServiceItems` + `computeItemSyncPlan` (read-only) + `applyItemSync(items, exec=db)` — **note: `service_items` is a lookup table (no `actors`), so no `actorId`/audit columns** (deviation from the planned `(items, actorId, exec)` signature). Order: **purge legacy (`DELETE WHERE quickbooks_id IS NULL`) FIRST** to free derived codes, then archive → update → create (`onConflictDoNothing` on the partial index). **Empty-pull guard:** zero items → no writes. Returns `{ created, updated, archived, purged, skipped }`. Executor-injection like `dealer-sync.ts`; the Server Action wraps the call in a transaction (Phase 4) so readers never see the mid-apply state.
  - `encodeItemSyncSummary`/`decodeItemSyncSummary` (4-segment `created.updated.archived.purged`, digit-guarded).
- [x] Unit: `mapItemToServiceItem`/`slugifyItemCode` + `classifyItemSyncPlan` (create/update/current/revive/archive/purge/skip + linked-code collision) + summary round-trip. (`item-sync.test.ts`, 13 cases.)
- [x] Unit: `fetchItems` request shaping (URL `FROM Item`, Bearer, pagination, active-only, 401) — 3 cases in `client.test.ts`.

#### Phase 3: Remove in-app item CRUD
- [x] Deleted `src/features/services/actions.ts` entirely (it was *only* the 3 item actions) + `service-schema.ts` (`serviceItemFormSchema`/`normalizeMoney`, unused elsewhere) + `services/actions.test.ts`.
- [x] Removed `<ServicesAdmin>` + its `loadServiceItems` feed from `/admin/lookups/page.tsx` (lookups now: styles, sources, tax rates; description updated to point items at QuickBooks); deleted `src/features/services/services-admin.tsx`.
- [x] Removed the `import * as servicesActions` + the 3 service-item rows from `action-gate-matrix.ts` (left a breadcrumb comment). `pnpm test` green incl. the matrix + its drift-detection grep (no service-item gated entries remain to represent).
- [x] Confirmed `loadServiceItems` (composer picker, `src/features/services/queries.ts`) still filters `isNull(archivedAt)` — archived/QBO-removed items drop out of the picker automatically; unchanged. It stays (used by `/quotes/new` + `/quotes/[id]`).
- [x] Grepped for dangling refs to the deleted files/exports — none. `lookup:edit` capability stays paired via the other lookups (styles/sources/tax rates), so no capability-pairing orphan.

#### Phase 4: `/admin/quickbooks` read-only Items change-set + "Pull items" Server Action
- [ ] `page.tsx`: when connected, `fetchItems` → `computeItemSyncPlan(items)` → pass to the component (read-only on load); decode `?itemsynced=…` into a `Notice`.
- [ ] `quickbooks-admin.tsx`: add an **Items** section below the dealers section — a read-only change-set table (Code · Label · Price · Action badge: Create / Update / Archive / Skip; "current/up-to-date" when nothing actionable) + a counts line incl. the legacy **purge** count. "Pull items" `<form action={pullItemsFromQuickbooks}>` button (render when connected + `!itemsFetchError` + actionable > 0).
- [ ] `actions.ts`: `pullItemsFromQuickbooks` — `assertCan('admin:access')` → `getValidAccessToken()` → `fetchItems` → `applyItemSync(items, user.id)` → `revalidatePath('/admin/quickbooks')` → `redirect('/admin/quickbooks?itemsynced=<c>.<u>.<a>.<p>')`. Errors propagate (no catch), matching `syncDealersFromQuickbooks`.
- [ ] Register `pullItemsFromQuickbooks` in `action-gate-matrix.ts` (ADMIN_ONLY).
- [ ] No-JS server component + `<form action>`.

#### Phase 5: Tests + smoke verification + wiki ingest
- [ ] Integration test (`tests/integration/item-sync.test.ts`, rolled-back txns, mirror `dealer-sync.test.ts`): create-from-QBO; **overwrite** linked row's label/price from QBO; **archive** a linked row whose QBO item is absent; **purge** a legacy (`quickbooks_id IS NULL`) row; idempotent re-run; **empty-pull guard** writes nothing; historical `quote_line_items` snapshot unaffected by a purge (seed a quote line → purge its item → assert the line's snapshot columns intact + `service_item_id` nulled).
- [ ] Smoke (web-test, gated): `goto /admin/quickbooks` (admin auth) → connected view shows **Dealers** + the new **Items** change-set (Code · Label · Price · Action) + a "Pull items" button. `goto /admin/lookups` → the service-item **editor is gone** (no add/edit item controls); other lookups (campaign styles, audience sources, tax rates) still render. **Do not click Pull** (it writes/deletes `service_items`). Screenshot.
- [ ] Ingest into `docs/wiki/data-model.md` (`service_items.quickbooks_id` + the "QBO is item master, app is a read-only mirror, no in-app CRUD" note) + `docs/wiki/log.md`; cross-note it's the `ItemRef` source for the Slice 3 Estimate push. Update any wiki page that described the in-app catalog editor as editable.
