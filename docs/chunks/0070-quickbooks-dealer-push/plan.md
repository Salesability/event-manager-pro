# QuickBooks Dealer Push (app → QBO Customers) — Plan

**Intent:** [`intent.md`](intent.md)
**Started:** 2026-06-09

## Progress Tracker

| Phase | Status | Commit |
|-------|--------|--------|
| 1: Client write helpers (`createCustomer` / `updateCustomer` / `fetchCustomerById`) + SyncToken | Done | `3cbcc10` |
| 2: `dealer-push.ts` — `mapDealerToCustomer` (inverse) + `pushDealerToQuickbooks` core | Done | `763844e` |
| 3: `pushDealerToQuickbooks` Server Action + dealer-page button + flash | Done | `8329203` |
| 4: Tests + smoke verification | Pending | - |

**Slice 1 of the bidirectional QuickBooks effort** (see [`intent.md`](intent.md) → *Follow-on slices*). Reverses chunk 0069's QBO→app pull: an admin pushes an in-app dealer to QuickBooks via an explicit **"Push to QuickBooks"** button on `/dealerships/[id]`. Linked dealer (`quickbooks_id` set) → **update** the QBO Customer with a freshly-read `SyncToken`; unlinked → **create** a Customer then **backfill** the returned `Id` onto `dealers.quickbooks_id` (guarded so it never clobbers an existing link). "Done" = the write helpers ship; the action is admin-gated + gate-matrix-registered; the dealer page shows link state + the button (only when QB is connected); the create-then-backfill write is integration-tested in a rolled-back tx with QBO mocked; chunk-end `/eval` is PASS. Sandbox-only; prod push gated on the owner-pending Intuit Production approval.

## Code Anchors

For each new file or method below, the builder reads the anchor first and matches its shape (length, error handling, naming, query style). For modifications to an existing file, the anchor is the nearest sibling method in that same file.

| New code | Anchor (`path:line`) | Why this anchor |
|----------|---------------------|-----------------|
| `createCustomer` / `updateCustomer` / `fetchCustomerById` in `src/lib/quickbooks/client.ts` | `src/lib/quickbooks/client.ts:191-227` (`fetchCustomers`) | same file; same `qboConfig()` + `apiBase` + `Bearer` + `401 → QboAuthError` + `!ok → throw` shape, but POST/GET a single Customer |
| `src/lib/quickbooks/dealer-push.ts` → `mapDealerToCustomer()` | `src/lib/quickbooks/dealer-sync.ts:86-97` (`mapCustomerToDealer`) | the exact forward map to **invert** — dealer → `QboCustomer` payload (DisplayName/CompanyName, BillAddr, province → CountrySubDivisionCode, email/phone) |
| `src/lib/quickbooks/dealer-push.ts` → `pushDealerToQuickbooks()` core (create/update + guarded backfill) | `src/lib/quickbooks/dealer-sync.ts:239-311` (`applyDealerSync`) | same executor-injection (`exec: Database \| Transaction = db`) + **guarded backfill** `UPDATE … WHERE id=? AND quickbooks_id IS NULL` + `.returning()` count pattern |
| `pushDealerToQuickbooks` Server Action in `src/features/quickbooks/actions.ts` | `src/features/quickbooks/actions.ts:95-104` (`syncDealersFromQuickbooks`) | sibling admin-gated QB action: `assertCan` → `getValidAccessToken` → QBO call → `revalidatePath` → `redirect(?flash)` |
| Action registration | `src/features/quickbooks/action-gate-matrix.ts` (where `syncDealersFromQuickbooks` is registered admin-only) | same gate-matrix entry shape (admin-only) |
| Link-state + "Push to QuickBooks" `<form action>` on the dealer page | `src/app/(app)/dealerships/[id]/page.tsx:96-148` (`Section` + KeyValueStrip) + `src/features/quickbooks/quickbooks-admin.tsx` Disconnect `<form action={serverAction}>` | reuse the `Section`/`KeyValueStrip` chrome for the link state; same no-JS `<form action>` submit as Disconnect/Sync |
| Flash decode (`?qbpush=…`) on the dealer page | `src/app/(app)/admin/quickbooks/page.tsx` `?synced=…` → `Notice` decode + `decodeSyncSummary` | same searchParams→`Notice` flash pattern (no client JS) |

**Conventions referenced:**
- `CLAUDE.md` → Conventions — **mutations are Server Actions, not route handlers**; the Intuit *callback* stays the only QB route handler (external caller).
- `docs/wiki/data-model.md` — `dealers` shape + `quickbooks_id` semantics (ingested by 0069).
- Memory [[feedback_no_yup]] — validate the action's `dealerId` FormData input with **Zod**, not yup.
- Memory [[project_prod_db]] / [[project_boldsign_prod_plan]] — prod QB is a separate connection; this slice stays sandbox-only (prod push gated on Intuit Production approval, owner-pending).

**Overall Progress:** 75% (3/4 phases complete)

**Note:**
- Each phase includes both implementation and tests.
- The QBO write itself can't be DB-integration-tested (network); the **DB side** (the `quickbooks_id` backfill after a create) is tested in a rolled-back tx with the QBO create mocked — mirrors how 0069 tested `applyDealerSync`.

### Phase Checklist

#### Phase 1: Client write helpers + SyncToken
- [x] Add `fetchCustomerById(realmId, accessToken, id): Promise<QboCustomer>` to `client.ts` — single-Customer GET (`/v3/company/{realmId}/customer/{id}`), 401 → `QboAuthError`, `!ok → throw` (mirrors `fetchCustomers`). Returns the row including `SyncToken`.
- [x] Extend `QboCustomer` type with `SyncToken?: string` (present on reads; required on updates). Added `QboCustomerInput` write-payload type (decoupled from the read shape) since a create omits `Id`/`SyncToken`.
- [x] Add `createCustomer(realmId, accessToken, payload): Promise<QboCustomer>` — POST to `/v3/company/{realmId}/customer`; returns the created Customer (with its new `Id`).
- [x] Add `updateCustomer(realmId, accessToken, payload): Promise<QboCustomer>` — POST a **sparse update** (`sparse: true` + `Id` + `SyncToken`) to the same endpoint.
- [x] Detect QBO duplicate-name error **6240** distinctly (`QboDuplicateNameError`, parsed from the `Fault.Error[].code` body) so the action can surface "already exists in QuickBooks" vs generic `!ok → throw`. Shared `readCustomerResponse` helper handles 401/6240/throw for all three calls.
- [x] Unit test the request shaping (URL, method, sparse flag, SyncToken inclusion) with `fetch` mocked — 5 cases added to `client.test.ts` (fetchById/create/update shaping + 6240 + 401).

#### Phase 2: `dealer-push.ts` — inverse map + push core
- [x] New `src/lib/quickbooks/dealer-push.ts`. Header comment: app→QBO direction (counterpart to `dealer-sync.ts`'s QBO→app); flat-address fidelity + inverse-map note.
- [x] `mapDealerToCustomer(dealer): QboCustomerInput` (inverse of `mapCustomerToDealer`): `DisplayName`/`CompanyName` ← `name`; `BillAddr.Line1` ← `address` (whole blob, per intent's address-fidelity decision); `CountrySubDivisionCode` ← `province`; `PrimaryEmailAddr`/`PrimaryPhone` ← primary contact when present. Returns `QboCustomerInput` (write shape), not `QboCustomer`.
- [x] `planDealerPush(dealer): 'create' | 'update'` — pure: `quickbooks_id` set → `update`, else `create` (unit-testable without network).
- [x] `pushDealerToQuickbooks(dealer, realmId, accessToken, actorId, exec=db): { action, qbId }` core:
  - `update` path: `fetchCustomerById` for the fresh `SyncToken` → `updateCustomer` with `Id`+`SyncToken`+sparse fields; touches `updated_by_id` locally.
  - `create` path: `createCustomer` → guarded `UPDATE dealers SET quickbooks_id = <newId>, updated_by_id = actorId WHERE id = ? AND quickbooks_id IS NULL` → `.returning()`; zero rows (a concurrent push already linked it) → no clobber.
- [x] Executor injection (`exec: Database | Transaction = db`) so the integration test passes a rolled-back tx — same as `dealer-sync.ts`. Introduced `DealerToPush` input type (structural subset of `loadDealer`'s `Dealer` + `quickbooksId`).
- [x] Unit test `mapDealerToCustomer` (name, address→Line1, province→CountrySubDivisionCode, missing province/address, email/phone from contact) + `planDealerPush` (linked→update, unlinked→create). (`dealer-push.test.ts`, 7 cases.)

#### Phase 3: Server Action + dealer-page button + flash
- [x] Add `pushDealerToQuickbooks(formData)` Server Action to `src/features/quickbooks/actions.ts`: `assertCan('admin:access')` → **Zod-validate** `dealerId` (`z.coerce.number().int().positive()`) → `loadDealer` → `getValidAccessToken()` → push core → `revalidatePath('/dealerships/<id>')` → `redirect('/dealerships/<id>?qbpush=created|updated')`. Errors propagate (no catch) per `syncDealersFromQuickbooks`'s rationale. Core imported aliased (`pushDealerToQbo`) to avoid the same-name collision.
- [x] Register the action in the gate matrix (`src/features/__tests__/action-gate-matrix.ts`, admin-only) — matches the `syncDealersFromQuickbooks` row; satisfies the matrix drift-detection grep.
- [x] Extended `loadDealer` to return `quickbooksId` (`Dealer & { quickbooksId }`) — feeds both the page link-state and the action's create-vs-update decision; base `Dealer` type untouched.
- [x] On `/dealerships/[id]/page.tsx`: added a **QuickBooks** `Section` (rendered only when `getConnection()` returns a connection) — link state ("Linked to QuickBooks customer #N" vs "Not in QuickBooks yet") + a **"Push to QuickBooks"** `<form action={pushDealerToQuickbooks}>` button with hidden `dealerId` (hidden on archived dealers, mirroring "+ New quote").
- [x] Decode `?qbpush=created|updated` into a green flash notice on the dealer page (mirrors the `?synced=`/`?connected=` pattern); page signature gains `searchParams`.
- [x] No-JS: server component + `<form action>`, matching connect/disconnect/sync.

#### Phase 4: Tests + smoke verification
- [ ] Integration test (`tests/integration/dealer-push.test.ts`, rolled-back txns): **create path** — mock `createCustomer` to return `Id: '999'`, run the push core against a seeded unlinked dealer, assert `quickbooks_id = '999'` backfilled; **re-run** with the dealer now linked asserts the guarded UPDATE no-ops (skip, no clobber); **update path** — linked dealer calls `fetchCustomerById` + `updateCustomer` with the returned SyncToken (QBO calls mocked, no DB write asserted beyond `updated_by_id`).
- [ ] (Server Action wrapper — `assertCan → getValidAccessToken → push core → redirect` — is thin over the tested core + network/auth; gate covered by `action-gate-matrix`.)
- [ ] Throwaway fixture `scripts/0070-dealer-push-smoke.ts` (`insert` / `cleanup`, idempotent by tag) — sandbox `dealers` is empty after 0069, so seed one dealer to view its detail page.
- [ ] Smoke (web-test, single gated route): `pnpm dlx tsx scripts/0070-dealer-push-smoke.ts insert`; `goto /dealerships/<fixtureId>`; expect heading = dealer name, the QuickBooks link-state row ("Not in QuickBooks"), and a **"Push to QuickBooks"** button (rendered iff QB connection is live). **Do not click** (it writes to the live sandbox QBO company). `... cleanup` after.
- [ ] Ingest the app→QBO write path into `docs/wiki/` (a QuickBooks integration page or `data-model.md` note that `quickbooks_id` is now written both directions) + a `docs/wiki/log.md` entry.
