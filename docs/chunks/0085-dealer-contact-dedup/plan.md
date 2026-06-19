# Dealer-contact dedup guard — Plan

**Intent:** [`intent.md`](intent.md)
**Started:** 2026-06-19

## Progress Tracker

| Phase | Status | Commit |
|-------|--------|--------|
| 1: Decision gate + shared dedup-lookup helpers | Done | `32b72fc` |
| 2: Contact email/phone guard in Server Actions (+ orphan-row fix) | Done | `7219e0e` |
| 3: Dealer name+address guard in `createDealer` (app-local) | Done | `af24bd8` |
| 4: Create-time QuickBooks `Customer`-by-name check + link-on-match | Done | `2dd1095` |
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

**Overall Progress:** 67% (4/6 phases complete)

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
- [x] `createDealer`: pre-tx `findExistingContactByIdentifier` when `wantsContact && (email||phone)`; on match return `{ duplicate: { kind:'contact', … } }`; honor `reuseContactId` (link existing, upsert the `dealer` role, skip identifier swap) / `createAnyway` (skip the check). Reused-contact push reloads via `loadDealer` for the true denorm.
- [x] `updateDealer`: catch-enrich `IdentifierConflictError` → informational `{ duplicate }` (D4 — no re-link; the tx already rolled back).
- [x] `createPerson`: same catch-enrichment (D4 — informational + navigate; a "person" IS a contact so no re-link/create-anyway).
- [x] ~~Fix the orphan-row path~~ — D2: confirmed already wrapped in `db.transaction` (insert + `swapPrimaryIdentifier`), so a conflict rolls back; **no change needed**. Phase 6 integration test locks in zero orphan rows.
- [x] Keep existing capability gating unchanged; `IdentifierConflictError` stays the genuine create-anyway-still-conflicts fallback (`createDealer` + `createAnyway` → generic reject via DB index).
- [x] Tests: contact match → `{ duplicate }` (no insert); `reuseContactId` links existing (no new contact, dedup skipped); `createAnyway` skips the check + inserts; `updateDealer`/`createPerson` surface the informational duplicate. _(Real-DB orphan-row + rollback → Phase 6.)_

#### Phase 3: Dealer name+address guard in `createDealer` (app-local)
- [x] `createDealer`: `findExistingDealerByNameAddress` runs **first** (before the contact check); on match returns `{ duplicate: { kind:'dealer-local', dealerId, name, address } }`. Skipped on `createAnyway` / `linkQuickbooksId`.
- [x] `createAnyway: true` skips the check → allows a deliberate same-name dealer (different lot).
- [x] `updateDealer` rename left unguarded — deferred, see [`decision.md`](decision.md) **D8** (edit-time collision is rarer + lower-value).
- [x] Tests: name+address match → `{ duplicate }` (no insert, contact check not reached); createAnyway skips + inserts. _(SQL case/whitespace-insensitivity → Phase 6 integration.)_

#### Phase 4: Create-time QuickBooks `Customer`-by-name check + link-on-match
- [x] Added `findCustomerByDisplayName(name, realmId, accessToken)` to `client.ts`: `SELECT * FROM Customer WHERE Active = true AND DisplayName = '…' MAXRESULTS 1` (backslash-escapes `\` then `'`), returns the single match or null; `QboAuthError` on 401.
- [x] `createDealer`: after local name+address + contact checks, runs the QB check — `getValidAccessToken` → `findCustomerByDisplayName`, 4000ms `Promise.race` ceiling; on a match returns `{ duplicate: { kind:'dealer-quickbooks', quickbooksId, name } }`. **Gated on `status === 'active'`** (D6 refinement — prospects don't push, keeps the inline composer fast); skipped on `createAnyway`/`linkQuickbooksId`.
- [x] Best-effort `findQuickbooksCustomerMatch`: dormant/query-error/timeout → null → create proceeds (never throws).
- [x] `linkQuickbooksId`: dealer inserted with `quickbooks_id` set (born-linked) → the auto-push (0084) inline payload carries it → *update* branch (no duplicate Customer).
- [x] `createAnyway: true`: skips the QB query → creates + pushes as today.
- [x] Tests (mock QB client): match → `dealer-quickbooks` result; link → born-linked insert + push gets a linked dealer, no QB query; dormant → skipped + create; createAnyway → no query; prospect → no query. Plus `client.test.ts`: query/escaping/null/401.

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
