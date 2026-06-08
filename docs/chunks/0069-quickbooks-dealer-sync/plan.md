# QuickBooks Dealer Sync — Plan

**Intent:** [`intent.md`](intent.md)
**Started:** 2026-06-08

## Progress Tracker

| Phase | Status | Commit |
|-------|--------|--------|
| 1: Schema — `dealers.quickbooks_id` + unique partial index + migration | Done | `79a74ff` |
| 2: Shared sync module (`map` + `compute-plan` + `apply`) | Pending | - |
| 3: Sync-diff page + "Sync dealers" Server Action button | Pending | - |
| 4: Tests + smoke verification | Pending | - |

Follow-up to 0068. Adds a durable `quickbooks_id` link on `dealers` and **pivots the `/admin/quickbooks` page from a passive customer list into a sync surface**: it computes, per QB customer, the change that *would* land in our DB (Create / Link → #N / Already linked / Skip), shows that change set, and a deliberate "Sync dealers" button applies it. "Done" = the column + unique index ship to sandbox; the connected page renders the computed change set (read-only); the apply action creates/links dealers through one env-agnostic path (match-by-QB-ID → match-by-name+address-and-backfill → insert); local fields are never clobbered; and the chunk-end `/eval` is PASS.

## Code Anchors

For each new file or method below, the builder reads the anchor first and matches its shape (length, error handling, naming, query style). For modifications to an existing file, the anchor is the nearest sibling method in that same file.

| New code | Anchor (`path:line`) | Why this anchor |
|----------|---------------------|-----------------|
| `quickbooks_id` column + unique partial index in `src/lib/db/schema/dealers.ts` | `src/lib/db/schema/dealers.ts:21-38` (nullable `address`/`province` cols + index block); `src/lib/db/schema/quickbooks-connection.ts` (unique-index idiom) | same file, same nullable-text + index conventions |
| New migration `drizzle/00NN_*.sql` | `drizzle/0031_chubby_skrulls.sql` (the 0068 QB migration) | same generate→**verify journal `when`**→apply-to-sandbox flow ([[project_drizzle_journal_when_gotcha]]) |
| `src/lib/quickbooks/dealer-sync.ts` → `mapCustomerToDealer()` | `scripts/import-from-quickbooks.ts:197-234` (`mapProvince`/`formatAddress`/`mapCustomer`) | the exact QBO→dealer field derivation this reuses; extract, don't re-invent |
| `src/lib/quickbooks/dealer-sync.ts` → `computeDealerSyncPlan()` (read-only classify) | `scripts/import-from-quickbooks.ts:245-282` (`findOrCreateDealer`) | same match precedence, but **no writes** — returns the planned action per customer for the diff table |
| `src/lib/quickbooks/dealer-sync.ts` → `applyDealerSync()` (writes) | `scripts/import-from-quickbooks.ts:245-282` (`findOrCreateDealer`) | the match-or-create + province-backfill writes, extended with the QB-ID precedence |
| Server Action `syncDealersFromQuickbooks` in `src/features/quickbooks/actions.ts` | `src/features/quickbooks/actions.ts:61-78` (`disconnectQuickbooks`) | sibling admin-gated action: `assertCan` → side-effect → `revalidatePath`/`redirect` |
| Change-set table + "Sync dealers" button in `src/features/quickbooks/quickbooks-admin.tsx` | `quickbooks-admin.tsx:122-153` (customer `<Table>`) + `:104-108` (Disconnect `<form action>`) | reshape the existing table into action-annotated rows; same no-JS `<form action={serverAction}>` control |
| Sync-summary notice decode in `src/app/(app)/admin/quickbooks/page.tsx` | the existing `?connected=1` / `?error=…` → `Notice` decode in that page | same searchParams→`Notice` flash pattern (no client JS) |

**Conventions referenced:**
- `docs/wiki/data-model.md` — `dealers` shape, ID/audit-column conventions, the clients-are-companies model.
- `CLAUDE.md` → Conventions — **mutations are Server Actions, not route handlers**; **invoke `db-conventions` skill before touching schema/migrations**.
- Memory [[project_drizzle_journal_when_gotcha]] — after `drizzle-kit generate`, verify the new journal `when` > previous, or the migration silently never applies.
- Memory [[project_prod_db]] — apply migrations on the **session pooler (5432)**, sandbox first; prod is a separate DB.

**Overall Progress:** 25% (1/4 phases complete)

**Note:**
- Each phase includes both implementation and tests.
- Integration tests come last, after all phases pass (verifies real DB upsert behavior).

### Phase Checklist

#### Phase 1: Schema — `dealers.quickbooks_id` + unique partial index + migration
- [x] Invoke the `db-conventions` skill before editing schema.
- [x] Add `quickbooksId: text('quickbooks_id')` (nullable) to `dealers` in `src/lib/db/schema/dealers.ts`, with a comment explaining the link + backfill semantics.
- [x] Add a **unique partial index** `dealers_quickbooks_id_idx` on `(quickbooks_id) WHERE quickbooks_id IS NOT NULL` (unique only among linked rows; many unlinked NULLs allowed).
- [x] `pnpm drizzle-kit generate` → new `drizzle/0032_skinny_sister_grimm.sql`; confirmed it has `ADD COLUMN "quickbooks_id" text` + `CREATE UNIQUE INDEX ... WHERE "quickbooks_id" IS NOT NULL` (clean partial-index DDL — no `--custom` touch-up needed).
- [x] **Verified the journal `when`** (0032 = 1780949870990) is greater than the previous entry's (0031 = 1780942196993) ([[project_drizzle_journal_when_gotcha]]).
- [x] Applied to the **sandbox** DB on the **5432 session pooler** (`DATABASE_URL` from `.env.local` = `qppenapeguwevcheqwpz` @ `aws-1-us-west-2.pooler:5432`). Verified column + partial index exist via `pg_indexes` (`CREATE UNIQUE INDEX dealers_quickbooks_id_idx ... WHERE (quickbooks_id IS NOT NULL)`).
- [x] (Prod apply deferred — the column ships to prod when prod migrations run via `pnpm db:migrate:prod`; not run here.)

#### Phase 2: Shared sync module (`map` + `compute-plan` + `apply`)
- [ ] New `src/lib/quickbooks/dealer-sync.ts`. Extract `mapProvince` / `formatAddress` / `mapCustomer` from the import script into `mapCustomerToDealer(c: QboCustomer)` (keep the script working — re-import from the new module, or duplicate-then-dedupe in a later pass; do **not** silently diverge the mapping).
- [ ] **Batch-load existing dealers once** — `select { id, name(lower), address(lower), quickbooksId }` — and build two lookup maps (by `quickbooks_id`, by `lower(name)+lower(address)`). Classify in memory; avoid N per-customer queries (~137 rows in prod).
- [ ] `computeDealerSyncPlan(customers: QboCustomer[]): SyncPlanRow[]` — **read-only**. For each (non-`Job`) customer, resolve the action against the maps and return `{ qbId, displayName, action: 'create' | 'link' | 'already-linked' | 'skip-collision', dealerId?, dealerName? }`:
  - Match by `quickbooks_id` → `already-linked` (carry `dealerId`).
  - Else match by `lower(name)+lower(address)` → if that dealer's `quickbooks_id IS NULL` → `link` (carry `dealerId`); if linked to a **different** QB ID → `skip-collision`.
  - Else → `create`.
- [ ] `applyDealerSync(customers, actorId): SyncResult` — re-resolves (or takes the plan) and **writes**: backfill QB ID + null province on `link`; insert on `create` (`quickbooksId`, `acquiredVia: 'QuickBooks sync'`, `status: 'active'`, `createdById/updatedById: actorId`); no-op `already-linked`; leave `skip-collision` untouched. Return `{ created, linked, alreadyLinked, skipped }`. Never clobber non-null local `name`/`address`/`province`.
- [ ] Skip `Job: true` sub-customers in both functions (per intent Open Question — confirm vs 0060 behavior first).
- [ ] Set `updatedById`/`createdById` from the acting admin (actors mixin) — don't leave audit columns null.
- [ ] Unit test the pure mapping (`mapCustomerToDealer`): province normalization, billing→shipping address fallthrough, missing-company DisplayName fallback.
- [ ] Unit test `computeDealerSyncPlan` classification (the four actions) against a seeded dealer set — pure-ish, no writes.
- [ ] Integration test `applyDealerSync` precedence: QB-ID match no-op, name+address backfill, fresh insert, already-linked-to-different-ID skip, idempotent re-run.

#### Phase 3: Sync-diff page + "Sync dealers" Server Action button
- [ ] Page (`src/app/(app)/admin/quickbooks/page.tsx`): when connected, after `fetchCustomers`, call `computeDealerSyncPlan(customers)` and pass the plan rows (not the raw customers) into the component. The action column is computed read-only on load.
- [ ] Reshape `quickbooks-admin.tsx`'s connected table into a **change-set table**: columns Company · Email · Phone · **Action** (badge: Create / Link → #N / Already linked / Skip), with a counts header ("N create · M link · K skip"). Reuse the existing `<Table>` shell (`:122-153`).
- [ ] Add `syncDealersFromQuickbooks` Server Action to `src/features/quickbooks/actions.ts`: `assertCan('admin:access')` → `getValidAccessToken()` → `fetchCustomers(realmId, accessToken)` → `applyDealerSync(...)` → `revalidatePath('/admin/quickbooks')` → `redirect('/admin/quickbooks?synced=<created>.<linked>.<skipped>')` (encode the summary into the flash param, mirroring `?connected=1`). After revalidate, the recomputed plan shows the post-sync state (mostly `already-linked`).
- [ ] Handle the not-connected / fetch-error case gracefully (redirect with `?error=…`, same as the callback pattern).
- [ ] Add the "Sync dealers" `<form action={syncDealersFromQuickbooks}>` button next to Disconnect, guarded so it only renders when connected + a plan was computed (and ideally disabled/hidden when the plan has zero create+link rows — nothing to do).
- [ ] Extend the page's notice decode to turn `?synced=...` into a success `Notice` ("Created N · linked M · skipped K dealers from QuickBooks").
- [ ] Keep it no-JS: server component + `<form action>`, matching the existing controls.

#### Phase 4: Tests + smoke verification
- [ ] Integration test for `syncDealersFromQbo` against a real test DB: insert-then-resync is idempotent; name+address pre-seed gets QB ID backfilled (the prod path); province not clobbered when already set.
- [ ] Unit test the Server Action's summary-param encode/decode round-trip.
- [ ] Smoke (web-test): `goto /admin/quickbooks` — disconnected state still renders (Connect button when configured). *(Connected-state smoke needs a live sandbox token; if unavailable, assert the disconnected surface + that no console errors fire.)*
- [ ] Smoke (web-test, if a sandbox token is wired): connected viewer shows the **change-set table** (Action column with Create / Link / Already linked badges) + the **Sync dealers** button alongside **Disconnect**; clicking is read-from-QB + DB-write, so drive it only against the sandbox company, then confirm the summary notice renders and the table flips to mostly **Already linked**.
- [ ] (If DB state is needed) throwaway fixture `scripts/0069-dealer-sync-smoke.ts` with `insert`/`cleanup` (idempotent by tag) to pre-seed a name+address dealer and assert the backfill path; run insert → sync → cleanup.
- [ ] Ingest the lasting facts into `docs/wiki/data-model.md` (the new `quickbooks_id` column) on chunk close.
