# QuickBooks Dealer Sync — Plan

**Intent:** [`intent.md`](intent.md)
**Started:** 2026-06-08

## Progress Tracker

| Phase | Status | Commit |
|-------|--------|--------|
| 1: Schema — `dealers.quickbooks_id` + unique partial index + migration | Done | `79a74ff` |
| 2: Shared sync module (`map` + `compute-plan` + `apply`) | Done | `80d502c` |
| 3: Sync-diff page + "Sync dealers" Server Action button | Done | `a93f779` |
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

**Overall Progress:** 75% (3/4 phases complete)

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
- [x] New `src/lib/quickbooks/dealer-sync.ts`. Mapping (`mapProvince` / `formatAddress` / `mapCustomerToDealer`) **duplicated** from the import script — rewiring the 0060 script is an **intent non-goal**, so the two copies are kept in sync by hand (a header comment flags this; the unit tests pin the QBO→dealer behavior). Contact fields intentionally omitted (`quickbooks_id` lands on the company, not contacts).
- [x] **Batch-load existing dealers once** via `loadExistingDealers(exec)` — `select { id, name, address, province, quickbooksId }` — and `classifyDealerSyncPlan` builds two in-memory lookup maps (by `quickbooks_id`, by `lower(name)+lower(address)`). No N per-customer queries.
- [x] `classifyDealerSyncPlan(customers, existing): SyncPlanRow[]` — **pure, read-only** (the unit-tested core). DB-backed `computeDealerSyncPlan(customers, exec=db)` loads the snapshot then delegates. Each row `{ qbId, company, email, phone, action: 'create' | 'link' | 'already-linked' | 'skip-collision', dealerId?, dealerName? }`:
  - Match by `quickbooks_id` → `already-linked`.
  - Else match by `lower(name)+lower(address)` → `link` if `quickbooks_id IS NULL`, else `skip-collision`.
  - Else → `create`.
- [x] `applyDealerSync(customers, actorId, exec=db): SyncResult` — re-resolves the plan against current DB state and **writes**: **guarded** `UPDATE … WHERE id=? AND quickbooks_id IS NULL` backfills QB ID (+ null province only) on `link`; insert on `create` (`quickbooksId`, `acquiredVia: 'QuickBooks sync'`, `status: 'active'`, `createdById/updatedById: actorId`) with `onConflictDoNothing` on the partial unique index. Returns `{ created, linked, alreadyLinked, skipped }`. Intra-batch name collisions lose the race → counted `skipped`, never clobbering. Never clobbers local `name`/`address`/`province`.
- [x] Skip `Job: true` (and `ParentRef`) sub-customers + nameless records in the classifier — matches 0060 (which skips jobs).
- [x] `actorId` threaded into `createdById`/`updatedById` on create and `updatedById` on link.
- [x] Unit test the pure mapping (`mapCustomerToDealer`): province normalization (alias/full-name/non-CA→null), billing→shipping address+province fallthrough, missing-company DisplayName fallback, Job/ParentRef flag. (`src/lib/quickbooks/dealer-sync.test.ts`)
- [x] Unit test `classifyDealerSyncPlan` classification (the four actions + job/nameless skip + display fields) against a seeded dealer set — pure, no writes.
- [x] Integration test `applyDealerSync` precedence against the real DB in **always-rolled-back transactions** (`tests/integration/dealer-sync.test.ts`): fresh insert, name+address backfill (+ null-province backfill), province-not-clobbered, already-linked no-op + idempotent re-run, skip-collision. Seeds derive their address from `mapCustomerToDealer` so the name+address match mirrors how 0060 formatted prod dealers.

**Note (executor injection):** every DB function takes an optional `exec: Database | Transaction = db`. Production call sites (page/action) omit it (use the app `db`); the integration test passes a transaction handle so all writes roll back and never touch the shared sandbox DB. New Code Anchors landed: `classifyDealerSyncPlan` (pure core), `loadExistingDealers`, `computeDealerSyncPlan`, `applyDealerSync` in `src/lib/quickbooks/dealer-sync.ts`.

**Out-of-scope note flagged for chunk-end:** the classifier has **no non-dealer skip-list** (0060's `SKIP_NAMES`/`DEDUP_NAMES` that excluded vendors/Salesability-itself/dupes from the one-time prod seed). Per the plan's 4-action model that's correct for the **sandbox-only** sync this chunk ships; if/when a *prod* QB connection is enabled, re-introducing a curated skip-list is a natural follow-up so a general sync doesn't create dealer rows for vendors.

#### Phase 3: Sync-diff page + "Sync dealers" Server Action button
- [x] Page (`src/app/(app)/admin/quickbooks/page.tsx`): when connected, after `fetchCustomers`, calls `computeDealerSyncPlan(customers)` and passes `SyncPlanRow[]` (not raw customers) into the component. Action column computed read-only on load.
- [x] Reshaped `quickbooks-admin.tsx`'s connected table into a **change-set table**: columns Company · Email · Phone · **Action** (badge: Create / Link → #N / Already linked / Skip), with a counts header ("N customers · N create · M link · K already linked · J skip" + "dealers are up to date" when nothing's actionable). Reuses the `<Table>` shell.
- [x] Added `syncDealersFromQuickbooks` Server Action: `assertCan('admin:access')` → `getValidAccessToken()` → `fetchCustomers(realmId, accessToken)` → `applyDealerSync(customers, user.id)` → `revalidatePath('/admin/quickbooks')` → `redirect('/admin/quickbooks?synced=<created>.<linked>.<skipped>')` (via `encodeSyncSummary`). Registered in `action-gate-matrix.ts` (admin-only).
- [x] ~~Handle the not-connected / fetch-error case with a `?error=` redirect~~ — **ADJUSTED:** errors **propagate** (no catch) to Next's error boundary instead. Rationale: the action-gate-matrix suite treats any post-gate `redirect()` as a wrong gate-admit, and the test's admin path hits "not connected" → a caught-and-redirected error would fail it (mirrors `connectQuickbooks`, which also doesn't catch). The Sync button only renders once the page has already loaded customers (token is fresh + `!fetchError`), so a sync-time failure is rare; the page-load path already renders the `fetchError` "Couldn't load customers / Reconnect" state and hides the Sync button.
- [x] Added the "Sync dealers" `<form action={syncDealersFromQuickbooks}>` button next to Disconnect, guarded to render only when connected + `!fetchError` + `actionable > 0` (create+link). Hidden when nothing to do (the counts line shows "up to date").
- [x] Extended the page's notice decode to turn `?synced=...` into a success `Notice` via `decodeSyncSummary` ("Synced dealers from QuickBooks — created N · linked M · skipped K.").
- [x] No-JS: server component + `<form action>`, matching connect/disconnect.

#### Phase 4: Tests + smoke verification
- [ ] Integration test for `syncDealersFromQbo` against a real test DB: insert-then-resync is idempotent; name+address pre-seed gets QB ID backfilled (the prod path); province not clobbered when already set.
- [ ] Unit test the Server Action's summary-param encode/decode round-trip.
- [ ] Smoke (web-test): `goto /admin/quickbooks` — disconnected state still renders (Connect button when configured). *(Connected-state smoke needs a live sandbox token; if unavailable, assert the disconnected surface + that no console errors fire.)*
- [ ] Smoke (web-test, if a sandbox token is wired): connected viewer shows the **change-set table** (Action column with Create / Link / Already linked badges) + the **Sync dealers** button alongside **Disconnect**; clicking is read-from-QB + DB-write, so drive it only against the sandbox company, then confirm the summary notice renders and the table flips to mostly **Already linked**.
- [ ] (If DB state is needed) throwaway fixture `scripts/0069-dealer-sync-smoke.ts` with `insert`/`cleanup` (idempotent by tag) to pre-seed a name+address dealer and assert the backfill path; run insert → sync → cleanup.
- [ ] Ingest the lasting facts into `docs/wiki/data-model.md` (the new `quickbooks_id` column) on chunk close.
