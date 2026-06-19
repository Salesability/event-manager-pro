# Dealer-contact dedup guard — Intent

**Created:** 2026-06-19

## Problem

Duplicate dealer contacts (and duplicate dealers) can be introduced through the
app's own UI. The one-time import scripts dedup carefully — email/phone lookup
for contacts (`scripts/import-from-sheets.ts:246-273`), `lower(name)+lower(address)`
for dealers (`:212-235`) — but the **interactive create/edit paths blind-insert**:
`createDealer`, `updateDealer`, and `createPerson` insert a fresh contact (or
dealer) row without first checking whether one already exists.

There *is* a structural backstop for contacts — `contact_identifiers` has a
unique index on `(kind, value) WHERE archived_at IS NULL`
(`src/lib/db/schema/contact-identifiers.ts:32-34`), so a duplicate **active**
email/phone is DB-blocked. But the guard fires badly:

- The conflict is detected in `swapPrimaryIdentifier`
  (`src/features/schedule/actions.ts:979-1048`) **after** the contact row is
  already inserted. If the insert + identifier swap aren't in one transaction, a
  conflicting email leaves an **orphan / nameless contact row** behind.
- The coach sees a raw `IdentifierConflictError` instead of "this email already
  belongs to *Jane Smith* — use her instead?" — no path to reuse.
- **Dealers have no name uniqueness at all** (`src/lib/db/schema/dealers.ts:16-52`,
  only the `quickbooks_id` partial-unique index), so the UI will happily create a
  second "ABC Motors" at the same address.

Downstream, duplicates corrupt the QuickBooks mirror: a dealer pushes only its
*primary* contact's name/email/phone to the QBO Customer
(`src/lib/quickbooks/dealer-push.ts:33-43`), so a second contact on the same
dealer becomes a **ghost** — invisible to QBO and to the sync.

## Desired outcome

When a coach enters contact or dealer details through the UI that match an
existing record, the app **warns and offers to reuse** the existing record
instead of silently creating a duplicate — the coach stays in the loop and
chooses "use the existing one" or "create anyway". Specifically:

- **Contacts** matched on **email or phone**: on a collision, the create/edit
  action surfaces the matching contact (name + which identifier matched) and lets
  the coach link to it rather than throwing `IdentifierConflictError`.
- **Dealers** matched on **name + address** (locally): on a collision,
  `createDealer` surfaces the matching dealer and lets the coach open it instead
  of creating a duplicate.
- **Dealers** also checked against **QuickBooks** at create time: when QB is
  connected, `createDealer` live-queries QBO for a `Customer` whose `DisplayName`
  matches the new dealer's name. On a match — i.e. the dealer already exists in
  QuickBooks but not yet in the app — the coach is warned and offered to **link
  to the existing Customer** (set `quickbooks_id`) instead of creating a second
  Customer. This catches the case app-local dedup can't see (a Customer created
  directly in QuickBooks, never pulled in), which today silently saves an
  unlinked orphan because the auto-push swallows Intuit's `6240` duplicate-name.
- No more orphan/nameless contact rows: the insert + identifier write either
  pre-checks before inserting or runs in a single transaction.

Observable end state: a coach cannot *accidentally* create a duplicate dealer or
a duplicate dealer contact through normal form use without being told and given
the reuse option first.

## Non-goals

- **No remediation / merge of existing duplicates.** This chunk prevents *new*
  dups only. Finding and collapsing the duplicates already in the DB is a
  separate, riskier chunk (it touches live links + the QBO mirror).
- **No name-based contact matching.** Matching on first+last name alone is
  deliberately excluded — common names produce too many false positives. Contact
  matching is email/phone only.
- **No hard block and no silent auto-merge.** The behavior is *warn + offer to
  reuse*, with a "create anyway" escape hatch — not a refusal, not a silent
  find-or-create that could link the wrong person.
- **No new DB constraint for contacts** — the enforcement index already exists;
  this is a UX + code-path fix, not a schema change. (A dealer name+address
  uniqueness constraint is *also* out of scope — name+address is too fuzzy to
  enforce at the DB level; the guard is application-level only.)
- **No change to the import scripts, the manual "Sync" (0069) reconcile, or the
  push-write logic (0070/0084)** beyond (a) reusing the import lookup helpers and
  (b) adding one **read-only** create-time `Customer`-by-name query + the
  link-on-match path. The QB check is **best-effort detection**: when QuickBooks
  is dormant/disconnected or the query errors/times out, the check is skipped and
  create proceeds exactly as today (create + best-effort push). Only a *successful
  query that returns a match* raises the link prompt — a QB outage must never
  block creating a dealer.

## Success criteria

- Creating a dealer contact with an email/phone already held by another active
  contact → the action returns a "possible duplicate" result naming the match;
  the form offers reuse; choosing reuse links the existing contact; no orphan
  row is left if the coach abandons.
- Creating a dealer whose name+address matches an existing dealer → the action
  returns a "possible duplicate" result naming the match; the form offers to use
  the existing dealer; "create anyway" still works.
- Creating a dealer whose name matches an existing **QuickBooks Customer** (QB
  connected) → the action returns a "exists in QuickBooks" result; choosing link
  saves the dealer with `quickbooks_id` set to that Customer (no duplicate
  Customer created); "create anyway" still works; QB dormant/erroring → check
  silently skipped, create proceeds.
- `updateDealer` / `createPerson` inline-contact paths get the same email/phone
  guard.
- No path leaves a nameless/identifier-less contact row behind on conflict
  (verified by an integration test that forces the conflict).
- Static gate green (tsc + tests + 0 new lint); smoke shows the reuse affordance
  on the dealer create form and the booking inline-add.

## Open questions

- **Two-step flow shape.** A Server Action can't render an interactive "reuse?"
  dialog mid-call. The action must *return* a duplicate-detected result (not
  throw), the client shows the reuse affordance, and the form re-submits with an
  explicit decision (`reuseExistingId` or `createAnyway: true`). Decide the exact
  result/return type and how the existing `next-safe-action` shapes carry it.
- **Orphan-row tx bug.** Confirm whether `createDealer`/`createPerson` already
  wrap insert + `swapPrimaryIdentifier` in a single transaction. If not, fix it
  here (recommended — same code path). Decide: pre-check-before-insert vs
  wrap-in-tx vs both.
- **Which forms carry the affordance.** Dealer create form, dealer edit form,
  person create form, booking inline-add-dealer-coach (0056, reuses
  `createDealer`). Confirm the surface set and whether the booking inline path
  can host a reuse prompt or should fall back to a simpler "open existing" hint.
- **Reuse vs link semantics for contacts.** When reusing an existing contact on a
  *new* dealer, does that create a new `dealer_contacts` link (the normal case),
  and what role? Confirm against the `dealer_contacts` composite-unique
  `(dealerId, contactId, role)`.
- **QB query shape + match key.** Query by `DisplayName` exactly (mirrors what
  Intuit's `6240` enforces), or also fuzzy/address? Reuse `fetchCustomers`' query
  pattern (`client.ts:211`) via a new `findCustomerByDisplayName` helper. Decide
  case-handling (QB DisplayName uniqueness is case-insensitive) and whether to
  include inactive Customers.
- **QB check ordering + latency budget.** Where does the QB query sit relative to
  the local name+address check (local first, then QB only if no local match), and
  what timeout makes a slow QB degrade-to-skip rather than hang the create? The
  check adds a live QB round-trip (with possible token refresh) to the create
  path — set a ceiling.
- **Link-on-match push behavior.** On link, the dealer is created already-linked
  (`quickbooks_id` set), so the existing best-effort auto-push (0084) should take
  the *update* branch (sync contact fields onto the matched Customer), not create
  a second one. Confirm that path and that it stays best-effort.

## Why now

The QuickBooks integration (0069–0084) made the dealer→QBO Customer push live on
prod, and chunk 0084 just wired auto-push of active dealers + contact-name
mapping. Duplicate local contacts now have a concrete downstream cost — QBO
ghosts and a drifting mirror — so closing the create-time dup gap is timely
before the dealer/contact volume grows.
