# QuickBooks Item Pull (QBO Items → `service_items`) — Plan

**Intent:** [`intent.md`](intent.md)
**Started:** 2026-06-09

## Progress Tracker

| Phase | Status | Commit |
|-------|--------|--------|
| 1: Schema — `service_items.quickbooks_id` + unique partial index + migration | Pending | - |
| 2: `client.ts` `fetchItems` + `item-sync.ts` (map + classify + apply) | Pending | - |
| 3: `/admin/quickbooks` Items change-set + "Pull items" Server Action | Pending | - |
| 4: Tests + smoke verification + wiki ingest | Pending | - |

**Slice 2 of the bidirectional QuickBooks effort** (see [`intent.md`](intent.md)). One-way **pull** of the connected QBO company's Items into our `service_items` catalog, linked via a new `service_items.quickbooks_id` — the `ItemRef` prerequisite for Slice 3 (Quotes → QBO Estimates). Near-verbatim reuse of chunk 0069's dealer-sync machinery (read-only change-set → deliberate apply), but for items and pull-only. "Done" = the column + unique index ship to sandbox; `/admin/quickbooks` renders a per-Item change set (Create / Link → `code` / Already linked / Skip) computed read-only on load; a "Pull items" button applies it through match-by-QB-Item-Id → match-by-`code` & backfill → insert; owner-curated `label`/`unit_price`/`description` are never clobbered; and the chunk-end `/eval` is PASS.

## Code Anchors

For each new file or method below, the builder reads the anchor first and matches its shape (length, error handling, naming, query style). For modifications to an existing file, the anchor is the nearest sibling method in that same file.

| New code | Anchor (`path:line`) | Why this anchor |
|----------|---------------------|-----------------|
| `quickbooks_id` column + unique partial index in `src/lib/db/schema/service-items.ts` | `src/lib/db/schema/dealers.ts:38-52` (the `quickbooks_id` col + `uniqueIndex ... WHERE quickbooks_id IS NOT NULL`) | the exact proven 0069 idiom — same nullable-text + partial-unique-index |
| New migration `drizzle/0033_*.sql` | `drizzle/0032_*.sql` (the 0069 `dealers.quickbooks_id` migration) | same generate → **verify journal `when`** ([[project_drizzle_journal_when_gotcha]]) → apply-to-sandbox flow |
| `fetchItems` + `QboItem` type in `src/lib/quickbooks/client.ts` | `src/lib/quickbooks/client.ts:191-227` (`fetchCustomers` + `QboCustomer`) | same `qboConfig`/`Bearer`/paginated `query` endpoint + `401 → QboAuthError`, just `FROM Item` |
| `src/lib/quickbooks/item-sync.ts` → `mapItemToServiceItem` / `classifyItemSyncPlan` / `computeItemSyncPlan` / `applyItemSync` | `src/lib/quickbooks/dealer-sync.ts` (whole module — `mapCustomerToDealer` / `classifyDealerSyncPlan` / `computeDealerSyncPlan` / `applyDealerSync`) | the sync-diff pattern this mirrors: pure classify + executor-injected apply, guarded link UPDATE + `onConflictDoNothing`, encode/decode summary |
| `pullItemsFromQuickbooks` Server Action in `src/features/quickbooks/actions.ts` | `src/features/quickbooks/actions.ts:95-104` (`syncDealersFromQuickbooks`) | sibling admin-gated QB action: `assertCan` → `getValidAccessToken` → fetch → apply → `revalidatePath` → `redirect(?summary)` |
| Gate-matrix row | `src/features/__tests__/action-gate-matrix.ts` (`syncDealersFromQuickbooks` row, ADMIN_ONLY) | same admin-only matrix entry shape |
| Items change-set table + "Pull items" button in `src/features/quickbooks/quickbooks-admin.tsx` | `quickbooks-admin.tsx:111-188` (connected dealer change-set table + `<form action={syncDealersFromQuickbooks}>`) | a second change-set section in the same connected view; same `<Table>` + no-JS `<form action>` |
| Items summary decode in `src/app/(app)/admin/quickbooks/page.tsx` | the existing `?synced=…` → `Notice` decode (`decodeSyncSummary`) | same searchParams → `Notice` flash pattern (add `?itemsynced=…`) |

**Conventions referenced:**
- `docs/wiki/data-model.md` — `service_items` shape (flat catalog, immutable unique `code`, nullable `unit_price`); `dealers.quickbooks_id` (the both-direction link, 0070).
- `CLAUDE.md` → Conventions — **mutations are Server Actions, not route handlers**; **invoke `db-conventions` before touching schema/migrations**.
- Memory [[project_drizzle_journal_when_gotcha]] — verify the new journal `when` > previous, or the migration silently never applies.
- Memory [[project_prod_db]] — apply migrations on the session pooler (5432), sandbox first; prod is a separate DB (prod QBO connected 2026-06-09, but no writes exercised on prod yet).

**Overall Progress:** 0% (0/4 phases complete)

**Note:**
- Each phase includes both implementation and tests.
- Integration tests come last, after the module is in place (verifies real DB upsert behavior in rolled-back transactions).

### Phase Checklist

#### Phase 1: Schema — `service_items.quickbooks_id` + unique partial index + migration
- [ ] Invoke the `db-conventions` skill before editing schema.
- [ ] Add `quickbooksId: text('quickbooks_id')` (nullable) to `service_items` in `src/lib/db/schema/service-items.ts`, with a comment (durable link to the QBO `Item.Id`; backfilled by the on-demand item pull; pull-only).
- [ ] Add a **unique partial index** `service_items_quickbooks_id_idx` on `(quickbooks_id) WHERE quickbooks_id IS NOT NULL` (mirror `dealers_quickbooks_id_idx`).
- [ ] `pnpm drizzle-kit generate` → new `drizzle/0033_*.sql`; confirm `ADD COLUMN` + `CREATE UNIQUE INDEX ... WHERE`.
- [ ] **Verify the journal `when`** (0033 > 0032) ([[project_drizzle_journal_when_gotcha]]).
- [ ] Apply to **sandbox** on the 5432 session pooler; verify column + partial index via `pg_indexes`. (Prod apply deferred to the next prod migration run.)

#### Phase 2: `client.ts` `fetchItems` + `item-sync.ts`
- [ ] `client.ts`: add `QboItem` type (Id, SyncToken?, Name, Sku?, Description?, UnitPrice?, Active?, Type, SubItem?, ParentRef?) + `fetchItems(realmId, accessToken, opts?)` — paginated `SELECT * FROM Item` (active-only default), mirroring `fetchCustomers`.
- [ ] New `src/lib/quickbooks/item-sync.ts`:
  - `mapItemToServiceItem(item): { qbId, code, label, unitPrice, description, isSyncable }` — `code` from `Sku` (trimmed) else slugified `Name`; `label` from `Name`; `unitPrice` from `UnitPrice` (string mode, nullable); `description` from `Description`; `isSyncable = Type ∈ {Service, NonInventory}` && not `SubItem`/`ParentRef` && has a Name.
  - Pure `classifyItemSyncPlan(items, existing): ItemSyncPlanRow[]` — match by `quickbooks_id` → `already-linked`; else match by `code` → `link` if `quickbooks_id IS NULL` else `skip-collision`; else `create`. Skip non-syncable. Guard derived-`code` collisions among `create` rows (two items → same code) → `skip-collision`.
  - DB `loadExistingServiceItems` + `computeItemSyncPlan(items, exec=db)` (read-only) + `applyItemSync(items, actorId, exec=db): { created, linked, alreadyLinked, skipped }` — guarded link UPDATE (`WHERE id=? AND quickbooks_id IS NULL`, backfill `quickbooks_id` only — never touch `label`/`unit_price`/`description`); insert new rows with `onConflictDoNothing` on the partial unique index. Executor-injection like `dealer-sync.ts`.
  - `encodeItemSyncSummary`/`decodeItemSyncSummary` (digit-guarded, mirror `dealer-sync.ts`).
- [ ] Unit test `mapItemToServiceItem` (Sku→code, Name-slug fallback, UnitPrice null, Service/NonInventory syncable, Category/SubItem skip) + `classifyItemSyncPlan` (4 actions + derived-code-collision skip) + summary round-trip.
- [ ] `client.ts` unit test: `fetchItems` request shaping (URL `FROM Item`, Bearer, pagination, 401→QboAuthError) — mirror the `fetchCustomers` tests.

#### Phase 3: `/admin/quickbooks` Items change-set + "Pull items" Server Action
- [ ] `page.tsx`: when connected, after `fetchItems`, call `computeItemSyncPlan(items)` and pass `ItemSyncPlanRow[]` into the component (read-only on load); decode `?itemsynced=…` into a `Notice`.
- [ ] `quickbooks-admin.tsx`: add an **Items** change-set section (Code · Label · Price · Action badge + counts line) below the dealer section; reuse the `<Table>` + `ActionBadge` shells. Add a "Pull items" `<form action={pullItemsFromQuickbooks}>` button (render only when connected + `!itemsFetchError` + actionable > 0).
- [ ] `actions.ts`: add `pullItemsFromQuickbooks` Server Action — `assertCan('admin:access')` → `getValidAccessToken()` → `fetchItems` → `applyItemSync(items, user.id)` → `revalidatePath('/admin/quickbooks')` → `redirect('/admin/quickbooks?itemsynced=<c>.<l>.<s>')`. Errors propagate (no catch), matching `syncDealersFromQuickbooks`.
- [ ] Register `pullItemsFromQuickbooks` in `action-gate-matrix.ts` (ADMIN_ONLY).
- [ ] No-JS: server component + `<form action>`.

#### Phase 4: Tests + smoke verification + wiki ingest
- [ ] Integration test (`tests/integration/item-sync.test.ts`, rolled-back txns, mirror `dealer-sync.test.ts`): fresh insert (create), `code`-match backfill (link), already-linked no-op + idempotent re-run, `quickbooks_id`-already-different skip-collision, and **owner-curated `label`/`unit_price`/`description` not clobbered** on a `code` match.
- [ ] Unit: summary encode/decode round-trip (covered in Phase 2) + map/classify (Phase 2).
- [ ] Smoke (web-test, single gated route): `goto /admin/quickbooks` (admin auth injected) → expect the connected view with **both** the Dealers change-set and the new **Items** change-set (Code · Label · Price · Action) + a "Pull items" button. **Do not click** (it writes to `service_items`). Screenshot. (Live sandbox QB connection; if the sandbox company has Items they classify against the seeded catalog.)
- [ ] Ingest `service_items.quickbooks_id` into `docs/wiki/data-model.md` (ERD + table-summary row) + a `docs/wiki/log.md` entry; note it's the `ItemRef` source for the upcoming Estimate push.
