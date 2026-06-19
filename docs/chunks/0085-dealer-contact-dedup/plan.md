# Dealer-contact dedup guard — Plan

**Intent:** [`intent.md`](intent.md)
**Started:** 2026-06-19

## Progress Tracker

| Phase | Status | Commit |
|-------|--------|--------|
| 1: Decision gate + shared dedup-lookup helpers | Done | - |
| 2: Contact email/phone guard in Server Actions (+ orphan-row fix) | Pending | - |
| 3: Dealer name+address guard in `createDealer` (app-local) | Pending | - |
| 4: Create-time QuickBooks `Customer`-by-name check + link-on-match | Pending | - |
| 5: Client reuse / link affordance on the forms | Pending | - |
| 6: Tests + smoke verification | Pending | - |

This chunk closes the create-time duplicate gap: the UI create/edit paths
blind-insert contacts and dealers while the import scripts dedup carefully. We
add a **warn + offer-to-reuse** guard — contacts matched on email/phone, dealers
on name+address (app-local) **and** dealers matched against an existing
QuickBooks `Customer` by name at create time — so a coach can't accidentally
create a duplicate, locally *or* a second QB Customer, without being told and
given the reuse/link option. No remediation of existing dups, no name-based
contact matching, no hard block. The QB check is **best-effort detection** (QB
dormant/erroring → skipped, create proceeds — a QB outage never blocks a dealer
save). "Done" = the create/edit actions return a duplicate-detected result (not a
raw throw), the forms surface a reuse / link / create-anyway control, no conflict
path leaves an orphan contact row behind, and a dealer that already exists in QB
links to it instead of spawning a duplicate Customer.

## Code Anchors

For each new file or method below, the builder reads the anchor first and matches
its shape (length, error handling, naming, query style). For modifications to an
existing file, the anchor is the nearest sibling method in that same file.

| New code | Anchor (`path:line`) | Why this anchor |
|----------|---------------------|-----------------|
| `src/features/dealers/dedup.ts` (shared find-existing helpers: contact-by-identifier, dealer-by-name+address) | `scripts/import-from-sheets.ts:246-273` (contact email/phone lookup) + `:212-235` (dealer name+address) | The dedup logic to mirror already exists in the import path — extract/port it into a UI-callable module instead of re-implementing |
| `createDealer` dup-guard branch | `src/features/schedule/actions.ts:121-236` (the action itself; insert at ~159-171 / ~176-184) | Modify in place — guard before the existing blind inserts |
| `updateDealer` dup-guard branch | `src/features/schedule/actions.ts:238-409` (contact insert ~341-349) | Same file, sibling action — match its existing link-resolution shape |
| `createPerson` dup-guard branch | `src/features/people/actions.ts:344-498` (insert ~402-405) | Sibling create action in the people feature |
| Identifier pre-check / tx wrap | `src/features/schedule/actions.ts:979-1048` (`swapPrimaryIdentifier`, pre-check at ~1011-1025) | The conflict check already lives here — move it ahead of the contact insert or wrap both in one tx |
| `findCustomerByDisplayName` (read-only QBO query helper) | `src/lib/quickbooks/client.ts:211` (`fetchCustomers`) + `:328` (`fetchCustomerById`) | Same query-API shape (`SELECT * FROM Customer WHERE …`, `QboAuthError` on 401); add a name-filtered single-result variant |
| Create-time QB check branch in `createDealer` | `src/features/schedule/actions.ts:109-119` (`autoPushActiveDealerToQuickbooks`) | Mirror its dormant-tolerant `getValidAccessToken` + swallow-on-error shape, but for a *read* that returns a match instead of pushing |
| Duplicate-detected / QB-link action result type | `src/lib/actions/action-client.ts` | The next-safe-action client whose result/error shapes the new "possible duplicate" + "exists in QuickBooks" returns must fit |
| Reuse affordance — dealer form | `src/features/dealers/dealer-form.tsx` | The form that submits `createDealer`/`updateDealer`; host the warn+reuse UI here |
| Reuse affordance — person form | `src/features/people/coach-add-form.tsx` + `src/features/people/people-admin.tsx` | The create-person surface |
| Reuse affordance — booking inline-add | `src/app/(app)/calendar/booking-form.tsx` | The 0056 booking composer that reuses `createDealer` inline |

**Conventions referenced:**
- `docs/wiki/data-model.md` — `contacts` / `contact_identifiers` / `dealer_contacts` / `dealers` shapes; the `contact_identifiers_kind_value_active_unique` index is the existing enforcement; `dealer_contacts` composite-unique `(dealerId, contactId, role)`; `dealers.quickbooks_id` (0069) is the link set on a QB match.
- `docs/wiki/forms.md` — RHF + zod + shadcn `<Field>` submission shape for the reuse/link affordance (Phase 5).
- `docs/wiki/conventions.md` — mutations go through Server Actions; Zod (no yup); shared Catalyst `Button`.
- `docs/wiki/auth.md` — keep the existing `requireRole` gating on the touched actions unchanged.
- **QB best-effort principle (0077/0084)** — a dormant/erroring QuickBooks must never block the dealer save; the Phase-4 QB check degrades to "skip + proceed" on any connection/query failure, raising the link prompt *only* on a successful match.

**Overall Progress:** 17% (1/6 phases complete)

**Note:**
- Each phase includes both implementation and tests.
- Integration tests come last (Phase 5), after the action paths land — verifies real-DB dedup + orphan-row behavior.
- **Code-only — no migration expected** (the contact enforcement index already exists; dealer name+address dedup is application-level, not a new constraint).

### Phase Checklist

#### Phase 1: Decision gate + shared dedup-lookup helpers
- [x] **Decide the two-step flow** ([`decision.md`](decision.md) D1): the action *returns* a `{ duplicate: DuplicateResult }` result instead of throwing; the client re-submits with `reuseContactId` / `linkQuickbooksId` / `createAnyway`. `toLegacyResult` gets one additive pass-through branch; `ActionResult` gains the variant.
- [x] **Decide the orphan-row fix** (D2): confirmed `createDealer`/`updateDealer`/`createPerson` **already** wrap contact insert + `swapPrimaryIdentifier` in one `db.transaction` → conflict rolls back, **no orphan row today**. No tx change; Phase 6 integration test locks in the rollback.
- [x] **Confirm the form surface set** (D3): dealer create (full prompt), dealer edit (informational), person create (informational + navigate), booking inline-add (**simpler "open existing" hint**, not the full reuse flow).
- [x] **Confirm contact reuse semantics** (D4): `createDealer` reuse links the existing contact via `dealer_contacts` at role `staff`; verified idempotent against `dealer_contacts_dealer_contact_role_unique (dealerId, contactId, role)`. `createPerson`/`updateDealer` are informational-only (no re-link).
- [x] **Decide the QB check shape** (D5/D6/D7): `findCustomerByDisplayName` exact `DisplayName` match (mirrors Intuit 6240), active-only; ordering local→contact→QB; 4000ms degrade-to-skip ceiling; `linkQuickbooksId` born-linked → 0084 auto-push takes the *update* branch.
- [x] Extract shared `findExistingContactByIdentifier(email/phone)` + `findExistingDealerByNameAddress(name, address)` into `src/features/dealers/dedup.ts` (ported from the import scripts; normalize: lowercase email, trim, `lower(trim(name))+lower(trim(address))`; archived excluded). Also defines the shared `DuplicateResult` union.
- [x] Unit tests for the lookup helpers (match / no-match / normalization). _`archived-excluded` + true SQL case-insensitivity are real-DB filters the pure-stub unit test can't exercise → moved to the Phase 6 real-DB integration test (noted in `dedup.test.ts`)._

#### Phase 2: Contact email/phone guard in Server Actions (+ orphan-row fix)
- [ ] `createDealer`: when `hasContact`, call `findExistingContactByIdentifier` before insert; on match return the duplicate-detected result; honor `reuseExistingId` (link existing) / `createAnyway`.
- [ ] `updateDealer`: same guard on the inline-contact edit path (~341-349).
- [ ] `createPerson`: same guard before the contact insert (~402-405).
- [ ] Fix the orphan-row path: pre-check the identifier (or wrap insert + `swapPrimaryIdentifier` in one tx) so a conflict never leaves a nameless contact row.
- [ ] Keep existing `requireRole`/capability gating unchanged; reuse `IdentifierConflictError` only as the genuine create-anyway-still-conflicts fallback.
- [ ] Tests: match → reuse links existing; createAnyway with a conflicting email still rejects (DB index); no orphan row after a conflict.

#### Phase 3: Dealer name+address guard in `createDealer` (app-local)
- [ ] `createDealer`: call `findExistingDealerByNameAddress` before the dealer insert (~159-171); on match return the duplicate-detected result with the existing dealer id.
- [ ] Honor `createAnyway: true` to allow a deliberate same-name dealer (different lot, etc.).
- [ ] Leave `updateDealer` rename unguarded for now (renaming to collide is a rarer, edit-time case — note in `decision.md` if deferred).
- [ ] Tests: matching name+address → duplicate-detected; case/whitespace-insensitive match; createAnyway inserts.

#### Phase 4: Create-time QuickBooks `Customer`-by-name check + link-on-match
- [ ] Add `findCustomerByDisplayName(name, realmId, accessToken)` to `client.ts` (anchor `fetchCustomers:211`): `SELECT * FROM Customer WHERE DisplayName = '…'` (escape quotes), return the single match or null; `QboAuthError` on 401, same as siblings.
- [ ] `createDealer`: **after** the local name+address check finds no match and **only if** no `createAnyway`/`linkQuickbooksId` decision is present, run the QB check — `getValidAccessToken` (dormant → skip), query by name, with the Phase-1 timeout ceiling; on a match return an "exists in QuickBooks" result (Customer Id + name).
- [ ] Best-effort: any QB connection/query error or timeout → swallow + proceed to create (mirror `autoPushActiveDealerToQuickbooks:109-119`); a QB outage never blocks the save.
- [ ] Honor `linkQuickbooksId`: create the dealer with `quickbooks_id` set to the matched Customer — so it's born linked and the existing auto-push (0084) takes the *update* branch (no duplicate Customer created).
- [ ] Honor `createAnyway: true`: skip the QB check and create + push as today (push may hit a swallowed 6240 → unlinked, unchanged behavior).
- [ ] Tests (mock the QB client): match → "exists in QuickBooks" result; link → dealer created with `quickbooks_id` set, no create-Customer call; dormant/error → check skipped, create proceeds; createAnyway → no QB query.

#### Phase 5: Client reuse / link affordance on the forms
- [ ] `dealer-form.tsx`: on a local-duplicate result, show a Callout ("Looks like *{name}* already exists") with **Use existing** + **Create anyway**; on an "exists in QuickBooks" result, show **Link to the QuickBooks customer** + **Create anyway** (shared Catalyst `Button`); re-submit with the decision (`reuseExistingId` / `linkQuickbooksId` / `createAnyway`).
- [ ] `coach-add-form.tsx` / `people-admin.tsx`: reuse affordance for the contact email/phone case.
- [ ] `booking-form.tsx` inline-add-dealer-coach: surface the dealer (local + QB) + contact dup results (per the Phase 1 decision — full prompt vs "open existing" hint).
- [ ] Match `forms.md` RHF + zod + `<Field>` patterns; no new validator lib (Zod only).

#### Phase 6: Tests + smoke verification
- [ ] Service-level integration test (real DB): contact email collision → reuse links existing contact, no orphan row; dealer name+address collision → duplicate-detected.
- [ ] Verify transaction rollback: forced identifier conflict mid-create leaves zero new `contacts` rows.
- [ ] QB check covered by Phase 4 unit tests (mocked client); no live-QB call in CI.
- [ ] Smoke (web-test): `goto /dealerships` → open the add-dealer form; enter an email already on an existing contact; expect the reuse Callout with **Use existing** / **Create anyway**.
- [ ] Smoke (web-test): `goto /calendar` → booking form inline "Add dealer" with a name+address matching an existing dealer; expect the dup affordance. (The QB-link branch is action/unit-tested, not web-driven — it needs a live QB connection the read-only smoke can't safely exercise.)
- [ ] (If DB state is needed) `pnpm dlx tsx scripts/0085-dedup-smoke.ts insert` → run web-test → `... cleanup` (idempotent fixture: a known dealer + contact to collide against).
