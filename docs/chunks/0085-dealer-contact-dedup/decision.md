# Dealer-contact dedup guard — Decisions (Phase 1 gate)

Resolves the seven Open Questions in [`intent.md`](intent.md). All are engineering
calls; each is grounded in the code read during the gate (anchors cited). No owner
product decision was required — the intent already carried the recommended shape.

---

## D1 — Two-step flow shape (return-a-result, not throw)

A Server Action can't render a "reuse?" dialog mid-call, so the action **returns a
duplicate-detected result** and the client re-submits with an explicit decision.

**Wire shape** — a new `DuplicateResult` discriminated union, defined in
`src/features/dealers/dedup.ts` and added as a third member of each action's local
`ActionResult`:

```ts
export type DuplicateResult =
  | { kind: 'contact'; via: 'email' | 'phone'; contactId: number; name: string; matchedValue: string }
  | { kind: 'dealer-local'; dealerId: number; name: string; address: string | null }
  | { kind: 'dealer-quickbooks'; quickbooksId: string; name: string };

// action return becomes: { ok: true; dealerId?: number } | { duplicate: DuplicateResult } | { error; fieldErrors? }
```

**Transport.** `next-safe-action` carries it as `result.data`; the existing
`src/lib/actions/legacy-result.ts` adapter only passes through `{ok:true}` / `{error}`
today and would collapse anything else to `{ error: 'Unknown error.' }`. So the
adapter gets **one additive branch**: pass `data` through when `'duplicate' in data`.
Its `TOk` constraint relaxes from `extends { ok: true }` to `extends object` (wider →
backward-compatible; the default stays `{ ok: true }`) so callers can pass a
success-union that includes the `{ duplicate }` member and narrow on it.

**Re-submit decision flags** (extra `FormData` fields, all optional):
- `createAnyway='1'` — bypass **all** dup detection; insert as today (the DB
  identifier-uniqueness index is still the final backstop). Used by the
  dealer-local and QuickBooks prompts' "Create anyway".
- `reuseContactId=<id>` — skip the contact-identifier check **and** the contact
  insert; link the existing contact to the new dealer instead.
- `linkQuickbooksId=<qbId>` — skip the local-dealer + QB checks; create the dealer
  **born-linked** (`dealers.quickbooks_id` set) so the 0084 auto-push takes the
  *update* branch (no duplicate Customer). The contact check still runs.

`dealer-schema.ts` gains these three optional fields (Zod, no yup).

## D2 — Orphan-row fix: already handled (no change), verify by test

Confirmed by reading the code: **all three create/edit paths already wrap the
contact insert + `swapPrimaryIdentifier` in a single `db.transaction`** —
`createDealer` (`schedule/actions.ts:158-208`), `updateDealer` (`:297-390`),
`createPerson` (`people/actions.ts:401-418`). `swapPrimaryIdentifier`
(`:1014-1028`) pre-checks the active-uniqueness index and `throw`s
`IdentifierConflictError` *inside* the tx, so the contact insert rolls back — **no
orphan/nameless row survives** a conflict today.

Decision: **no transaction change**. The dedup guard's value here is the
better-UX *detection* (return a named match before the throw), not a structural
fix. Phase 6 adds a real-DB integration test that forces the mid-create identifier
conflict and asserts **zero** new `contacts` rows, locking in the rollback.

## D3 — Form surface set + booking inline behavior

Carry the affordance on: **dealer create** + **dealer edit** (`dealer-form.tsx`),
**person create** (`people-admin.tsx` / `coach-add-form.tsx`), and the **booking
inline-add-dealer** (`calendar/booking-form.tsx`, 0056).

- Dealer create form: full prompt (all three `DuplicateResult` kinds).
- Dealer edit form: contact-collision prompt only, **informational** (see D4).
- Person create: contact-collision prompt, **informational + navigate** (see D4).
- **Booking inline-add: simpler "open existing" hint, not the full reuse flow.**
  The booking composer's inline create is a fast path; a multi-step reuse dialog
  nested in a dialog is heavy. It surfaces the local-dealer / QB match as a short
  Callout with a link to the existing dealer + a "Create anyway" — no contact-reuse
  re-link. Keeps scope contained; reversible if the owner wants the full flow later.

## D4 — Reuse vs link semantics per surface

- **`createDealer` contact collision** → `reuseContactId` re-link is supported:
  create the new dealer, **link the existing contact** via `dealer_contacts` at
  role `staff` (the role `createDealer` already uses, `:189`). The
  `dealer_contacts_dealer_contact_role_unique (dealerId, contactId, role)` index
  (`dealer-contacts.ts:43-47`) makes the link idempotent. **No "create anyway" on a
  contact collision** — a duplicate active email/phone is DB-blocked, so the only
  real choices are *use existing* or *change the email*.
- **`createPerson` contact collision** → **informational only**. A "person" *is* a
  contact; you don't create a second one. The prompt names the match and offers
  "Open their record" (navigate to edit). No `reuseContactId`, no create-anyway.
- **`updateDealer` contact collision** → **informational only**. Swapping a
  dealer's linked contact for a different existing one mid-edit is out of scope;
  the prompt just names whose email/phone it is (a strict UX upgrade over today's
  generic `IdentifierConflictError` toast). User edits the field to resolve.

## D5 — QuickBooks check shape + match key

New read-only helper `findCustomerByDisplayName(name, realmId, accessToken)` in
`client.ts`, mirroring `fetchCustomers` (`:211`): `SELECT * FROM Customer WHERE
DisplayName = '<escaped>'` (single-quote-escape the name), return the single match
or null, `QboAuthError` on 401. Match key = **`DisplayName`, exact** — this mirrors
exactly what Intuit's `6240` duplicate-name rule enforces, so a match here predicts
the create-Customer collision the auto-push would otherwise swallow. QBO
`DisplayName` uniqueness is case-insensitive, and SQL `=` over the QBO query API is
case-insensitive for this field, so no extra lower() dance. **Active Customers
only** (default `WHERE Active = true` semantics) — linking to an inactive Customer
is not useful. No address/fuzzy matching (out of scope, intent non-goal).

## D6 — QB check ordering + latency budget

Order inside `createDealer`: **local dealer name+address (Phase 3) → contact
identifier (Phase 2) → QB-by-name (Phase 4)**. Cheap local reads first; the network
QB read runs **only when no local dealer matched** and no `createAnyway`/
`linkQuickbooksId` decision is present.

**Latency ceiling: 4000ms** around the whole QB leg (`getValidAccessToken` token
refresh + the single query), via `Promise.race` with a timeout. On timeout **or**
any connection/query error → **skip + proceed to create** (best-effort, mirrors
`autoPushActiveDealerToQuickbooks:109-119`). A dormant/slow/erroring QuickBooks
never blocks the dealer save; only a *successful query returning a match* raises the
link prompt.

**Build refinement — gate the network QB check on `status === 'active'`.** Only
active dealers push to QB (0084), so the QB-name check runs only when the new
dealer is active. This keeps the composer's inline **prospect**-create path fast
(no QB round-trip) and aligns "QB matters" with "the dealer that actually pushes."
The cheap local dealer-name + contact checks still run for prospects. (A
prospect→active conversion does not re-run the QB check — acceptable gap; a
`convertProspectToActive` QB-dedup could be a later follow-up.)

## D7 — Link-on-match push behavior

On `linkQuickbooksId`, the dealer is inserted with `quickbooks_id` already set, so
the existing best-effort auto-push (0084, `createDealer:216-231`) sees a linked
dealer and `pushDealerToQuickbooks` takes the **update** branch (fresh `SyncToken`)
— syncing contact fields onto the matched Customer rather than creating a second
one (`dealer-push.ts:86-95`). Stays best-effort: a push failure never rolls back
the now-linked dealer. Confirmed against the push code; no change needed beyond
passing the id through to the insert.

---

## Skip-matrix (decision flags → which checks run)

| Flag present     | local-dealer | contact | QB-by-name | insert behavior                          |
|------------------|:-:|:-:|:-:|------------------------------------------|
| (none)           | ✓ | ✓ | ✓ | insert new dealer + new contact          |
| `reuseContactId` | ✓ | — | ✓ | insert dealer; **link existing contact** |
| `linkQuickbooksId`| — | ✓ | — | insert dealer **born-linked**            |
| `createAnyway`   | — | — | — | insert as today (DB index still backstops) |

## D8 — `updateDealer` rename stays unguarded (Phase 3 deferral)

The name+address dup guard is **create-only**. Renaming an existing dealer *into*
a collision (`updateDealer`) is a rarer, edit-time case and the edit form already
shows the dealer you're editing, so a "you just became a duplicate" prompt mid-edit
is lower-value and higher-friction. Deferred — re-open if duplicate-via-rename
shows up in practice. (The contact-identifier guard on `updateDealer` still ships
in Phase 2; only the dealer name+address rename check is deferred.)

## Out of scope (re-confirming intent non-goals)

No remediation/merge of existing dups; no name-only contact matching; no hard
block; no new DB constraint; no shared danger-Callout component (that's the parked
≈0082 follow-up — Phase 5 uses a local inline panel matching the existing red error
panels). No change to the import scripts, the 0069 manual Sync, or the 0070/0084
push-write logic beyond reusing the lookup helpers + the one read-only QB query.
