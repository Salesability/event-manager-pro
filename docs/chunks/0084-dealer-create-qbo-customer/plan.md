# Auto-create a QuickBooks customer for active dealers — Plan

**Intent:** [`intent.md`](intent.md) · **Decisions:** [`decision.md`](decision.md)
**Started:** 2026-06-18

## Progress Tracker

| Phase | Status | Commit |
|-------|--------|--------|
| 1: Decision gate (duplicate-name handling + edit-gating + UI feedback) | Done | (`decision.md`) |
| 2: Map the contact person's name onto the QB Customer | Done | `4a7c5d0` |
| 3: Best-effort auto-push on active create, activate, and edit | Done | `9586dc3` |
| 4: Tests + verification | Done | `9d134a2` |

This chunk automates the **app→QBO** direction for active dealers — establishing
**the app as the source of truth** for dealer data (owner decision 2026-06-18):
creating an `active` dealer (or converting a prospect to active) auto-creates a
QuickBooks Customer and links the dealer, and **editing** an active/linked dealer
pushes the change so contact churn keeps QuickBooks current — all reusing the
chunk-0070 push, **best-effort**, so a missing/erroring QuickBooks never blocks
the dealer save. It also closes a mapping gap: the QB Customer now carries the
**contact person's name** (`GivenName`/`FamilyName`), not just company name +
email/phone. The Sync (QB→app) stays **non-clobbering** and is *unchanged* — it
never overwrites app dealer data (the app is the master). "Done" =
active create/activate/edit push to QB when connected; prospects don't; a QBO
failure never blocks the dealer; the mapped Customer carries the contact name.

## Code Anchors

For each new file or method below, the builder reads the anchor first and matches
its shape (length, error handling, naming, query style). For modifications to an
existing file, the anchor is the nearest sibling method in that same file.

| New code | Anchor (`path:line`) | Why this anchor |
|----------|---------------------|-----------------|
| `autoPushActiveDealerToQuickbooks` best-effort helper in `src/features/schedule/actions.ts` | `src/features/quickbooks/actions.ts:159` (`pushDealerToQuickbooks` manual action) + the best-effort `reconcileCampaignCalendar` call inside `createCampaign`/`updateCampaign` (same `actions.ts`) | reuse the 0070 push core; mirror the never-throw best-effort wrapper shape of the calendar reconcile (0077) |
| Hook in `createDealer` (after the insert tx, when `status==='active'`) | `src/features/schedule/actions.ts:96` (`createDealer`) | the function being modified — best-effort call goes after the transaction, before `revalidatePath` |
| Hook in `convertProspectToActive` (after the flip succeeds + audit) | `src/features/schedule/actions.ts:397` (`convertProspectToActive`) | nearest sibling; `loadDealer(id)` → helper after `result.length` success |
| Hook in `updateDealer` (after the guarded update succeeds) | `src/features/schedule/actions.ts:193` (`updateDealer`) | the edit path; `loadDealer(id)` → helper when the dealer is active/linked — `pushDealerToQuickbooks` takes the **update** branch since `quickbooks_id` is set |
| `GivenName?` / `FamilyName?` added to `QboCustomerInput` | `src/lib/quickbooks/client.ts:195` (`QboCustomerInput`) | extend the existing input type in place |
| `contactFirstName?` / `contactLastName?` on `DealerToPush` + `mapDealerToCustomer` sets the name | `src/lib/quickbooks/dealer-push.ts:33` (`DealerToPush`) + `:44` (`mapDealerToCustomer`) | extend the mapping + its input type in place |
| Integration coverage | `tests/integration/dealer-push.test.ts` | the existing push integration suite |

**Conventions referenced:**
- `CLAUDE.md` → Conventions: mutations go through **Server Actions**. The
  auto-push rides **inside** the existing `createDealer` / `convertProspectToActive`
  / `updateDealer` actions — **no new exported Server Action**, so **no
  `action-gate-matrix` row** is needed (the gate is the host action's existing
  `dealer:create` / `dealer:edit`).
- `docs/wiki/data-model.md` — `dealers.quickbooks_id` is the durable link to the
  QBO `Customer.Id` (written both directions: backfilled by Sync, set by the
  push). `contacts` / `dealer_contacts` hold the primary-contact name/email/phone
  that `loadDealer` denormalizes (`contactFirstName`/`contactLastName`/
  `primaryEmail`/`primaryPhone` on the `Dealer` type).
- Best-effort pattern: `src/features/schedule/calendar-sync.ts` (0077) — never
  throw, never block the primary write.

**Overall Progress:** 100% (4/4 phases complete)

**Note:**
- Phases are sequenced: decide the open questions → fix the mapping (improves the
  manual push too) → wire the auto-push → tests.
- The reconcile/push **core** (`pushDealerToQuickbooks` in `dealer-push.ts`) is
  reused unchanged except for the additive name mapping; this chunk adds a thin
  best-effort wrapper + two call sites.

### Phase Checklist

#### Phase 1: Decision gate (resolve the open questions)
- [x] **D1 — duplicate-name (Intuit 6240) on auto-create — DECIDED 2026-06-18: leave unlinked.** Best-effort: on a 6240 the dealer saves but stays unlinked; **no auto-link by bare name** (the app treats dealer name as non-unique on purpose — identity is name+address — so bare-name linking could merge two different businesses). Owner reconciles via Sync (name+address) / manual Push. (Only the **create** path can hit 6240; the edit path uses the update branch.) **App-side dealer dedup is OUT of scope** (separate concern — owner decided keep-separate 2026-06-18).
- [x] **D2 — edit-push gating — DECIDED: active OR already-linked.** `updateDealer` pushes when the dealer is `active` **or** has a `quickbooks_id` (update branch for linked, create branch for active-but-unlinked). See [`decision.md`](decision.md).
- [x] **D3 — UI feedback — DECIDED: silent.** No new notice; the dealer page already shows QB link status. Easily upgraded later. See [`decision.md`](decision.md).
- [x] Owner-locked decisions (2026-06-18) recorded in [`decision.md`](decision.md): **source of truth = the app** (push app→QB on create/activate/edit; **Sync never overwrites** app dealer data); **active-only** create-push; **best-effort / connected-only**; **app-side dedup out of scope**.

#### Phase 2: Map the contact person's name onto the QB Customer
- [x] Add `GivenName?: string` / `FamilyName?: string` to `QboCustomerInput` (`src/lib/quickbooks/client.ts`).
- [x] Add `contactFirstName?: string | null` / `contactLastName?: string | null` to `DealerToPush` (`src/lib/quickbooks/dealer-push.ts`).
- [x] In `mapDealerToCustomer`, set `GivenName`/`FamilyName` from the contact name when present (omit when the dealer has no contact).
- [x] Confirm the manual push action (`src/features/quickbooks/actions.ts` `pushDealerToQuickbooks`) flows the name through — `loadDealer`'s `Dealer` already carries `contactFirstName`/`contactLastName`, so it benefits for free. (No code change: `Dealer & {quickbooksId}` is structurally assignable to the extended `DealerToPush`.)
- [x] Unit test (`src/lib/quickbooks/dealer-push.test.ts`): mapped payload includes `GivenName`/`FamilyName` when a contact name is present; omits them when absent; existing company/address/email/phone mapping unchanged.

#### Phase 3: Best-effort auto-push on active create, activate, and edit
- [x] Add `autoPushActiveDealerToQuickbooks(dealer: DealerToPush, actorId: string | null): Promise<void>` to `src/features/schedule/actions.ts` — `getValidAccessToken()` + `pushDealerToQuickbooks(...)` wrapped in a `try/catch` that **swallows** all errors (best-effort; never throws). Imports: `getValidAccessToken` (`@/lib/quickbooks/connection`), `pushDealerToQuickbooks` + `type DealerToPush` (`@/lib/quickbooks/dealer-push`), `loadDealer` (`./queries`).
- [x] Hook `createDealer`: after the insert transaction succeeds, **if `status === 'active'`**, call the helper with the new dealer (`id: newDealerId`, `name`, `address`, `province`, `quickbooksId: null`, `contactFirstName`/`contactLastName`/`primaryEmail`/`primaryPhone` from the just-created contact).
- [x] Hook `convertProspectToActive`: after the guarded flip succeeds (`result.length`) + the audit, `loadDealer(id)` → call the helper (only if the dealer loads).
- [x] Hook `updateDealer`: after the guarded update succeeds (not `notFound`), `loadDealer(id)` → call the helper **per the D2 gating** (active and/or already-linked). `pushDealerToQuickbooks` takes the **update** branch (fresh `SyncToken` read-before-write) when `quickbooks_id` is set, so a changed contact/email/phone/address propagates. (A now-active-but-unlinked dealer takes the create branch — auto-link.)
- [x] Apply the **D1** decision for the 6240 create path. (Handled by the helper's blanket `catch` — a 6240 from `createCustomer` is swallowed, leaving the dealer saved-but-unlinked. No bare-name auto-link.)
- [x] (No new exported action → confirm `action-gate-matrix` drift test still passes with **no** new row. The helper is a private `async function`, not a `capabilityClient` export.)

#### Phase 4: Tests + verification
- [x] Integration test (`tests/integration/dealer-push.test.ts` or a sibling): an **active** create pushes (Customer created + `quickbooks_id` backfilled) against the test/stub QBO client; a **prospect** create does **not** push. (Push CORE create+backfill is the existing integration create-path test; the action-level active-pushes / prospect-doesn't-push is in `src/features/dealers/actions.test.ts` → "auto-push to QuickBooks (0084)".)
- [x] Integration/unit test: **editing** a linked dealer pushes the **update** branch (fresh SyncToken read-before-write; the changed contact/email/phone/address reaches the mapped Customer payload), per the D2 gating. (Update-branch SyncToken + `GivenName`/`FamilyName` payload asserted in the integration update-path test; D2 action gating — linked-prospect pushes, active-unlinked pushes, prospect+unlinked doesn't — in the action suite.)
- [x] Action/unit test: **best-effort swallow** — with QBO not connected (`getValidAccessToken` throws), `createDealer`/`convertProspectToActive` still resolve `{ ok: true }` and the dealer row exists (no error propagated). (Plus a 6240/push-throws swallow case for D1.)
- [x] Unit test: the Phase-2 name-mapping cases. (`src/lib/quickbooks/dealer-push.test.ts`.)
- [x] `tsc` + lint clean; BASE vs HEAD **0 new lint** (stale-worktree noise per memory). (eslint on the 6 touched files → 0.)
- [x] **Verification note (not web-test):** creating/activating a dealer is a *write* that pushes to the connected QBO company — the read-only `web-test` discipline can't exercise it on the gated surface. Covered by the integration/action tests above (the 2 DB-gated integration cases run in the chunk-end `/eval` with `DATABASE_URL`). The **live sandbox round-trip** (create an active dealer on the sandbox-connected dev app → a QB Customer appears with the contact name + the dealer shows linked) is an owner manual-verify step — recorded as a coverage caveat in the chunk-end eval.
