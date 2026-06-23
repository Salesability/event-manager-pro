# Rationalize the dealer-contact role taxonomy — Plan

**Intent:** [`intent.md`](intent.md)
**Started:** _scaffolded 2026-06-22; not started. Follows hotfix A (`9489978`) which made the
quote/MSA recipient priority-based instead of `customer`-only. This chunk replaces that heuristic
with an explicit, user-editable primary-contact designation and drops the legacy role enum._

## Progress Tracker

| Phase | Status | Commit |
|-------|--------|--------|
| 1: Decision gate — designation shape (`is_primary` vs `primary\|additional`), keep-a-role?, tiebreak, backfill rule | Done | (doc) |
| 2: Schema — add the primary designation (expand) + migration + backfill | Pending | - |
| 3: Migrate reads — recipient resolver + queries priority + people badge/dropdown/validation | Pending | - |
| 4: Contract — drop the legacy `dealer_contact_role` enum/usage once reads are off it | Pending | - |
| 5: Tests + wiki | Pending | - |

The cleanup the prod bug pointed at: a `dealer_contacts` row becomes "a person at this dealership"
(+ free-text `title`) with an **explicit primary-contact designation** for who receives
quotes/MSAs. Recipient selection keys off that designation, retiring hotfix A's priority heuristic.
Expand→migrate→contract so the column add + backfill ship before any drop.

## Code Anchors

| New / changed code | Anchor (`path:line`) | Why this anchor |
|--------------------|----------------------|-----------------|
| `dealer_contacts` primary designation (`is_primary` boolean + partial-unique one-per-dealer, OR `primary\|additional` enum) | `src/lib/db/schema/dealer-contacts.ts` (the `dealerContactRole` enum + `do_not_contact` boolean + the `dealer_contacts_dealer_contact_role_unique` index) | Same table; mirrors the existing boolean + partial-index patterns |
| Migration: add designation (expand) + backfill + later contract-drop | `drizzle/0042_low_slipstream.sql` (enum+col+index+backfill `UPDATE`) + `drizzle/0040_*` (a DROP migration) + **`db-conventions` skill** | Recent additive+backfill migration shape; expand→migrate→contract |
| Backfill = each dealer's current priority-primary → primary | `src/features/schedule/queries.ts:156` (`DEALER_CONTACT_ROLE_PRIORITY` + `fetchPrimaryDealerContacts`) | The exact priority the backfill must reproduce so the displayed contact doesn't move |
| Recipient resolver → select the designated primary | `src/features/quotes/recipient.ts` (post-hotfix priority query) | Swap the `case … role …` order for an `is_primary`/designation filter |
| People "Customer" badge/filter → drop or rephrase | `src/features/people/people-columns.tsx:126` (`dealerLinks.some(l => l.role === 'customer')`) | The only people-side reader of `customer` |
| People link UI role dropdown → primary toggle | `src/features/people/people-admin.tsx:111,600` (`DEALER_CONTACT_ROLES` dropdown) + `src/features/people/actions.ts:60,166` (role validation) | Where an admin sets the link's role today |
| People-side link projection carrying `role` | `src/features/people/queries.ts:108,309` | Reads `dealerContacts.role` into the people view |
| Wiki | `docs/wiki/data-model.md` (dealer_contacts section + the send-flow recipient line already updated by hotfix A) + `auth.md` if a gate changes | State-of-system ingest |

**Conventions referenced:** **`db-conventions` skill** (expand→migrate→contract, FK/index rules,
journal `when` gotcha [[project_drizzle_journal_when_gotcha]]), `docs/wiki/data-model.md`
(dealer_contacts shape + the recipient send-flow), `docs/wiki/auth.md`.

**Overall Progress:** 20% (1/5 phases complete)

**Notes:**
- **Migration expected** (Phase 2 add + Phase 4 drop — two migrations, expand then contract).
- Hotfix A (`9489978`) is the safety net: even mid-migration, sending still resolves a recipient
  by priority. Phase 3 swaps that for the explicit designation; only Phase 4 removes the old enum.
- Backfill must reproduce `DEALER_CONTACT_ROLE_PRIORITY` (staff>customer>prospect, lowest id) so
  each dealer's *displayed* primary contact becomes the designated primary — nothing visibly moves.
- The 24 legacy `customer` rows + the 313 `staff` rows all collapse into "contact, possibly
  primary"; `prospect` (0 rows) just disappears.

### Phase Checklist

#### Phase 1: Decision gate — see [decision.md](decision.md)
- [x] **Designation shape** — `is_primary` boolean (+ partial-unique `WHERE is_primary`). Owner: no use for an enum. Role enum dropped in Phase 4 (D1).
- [x] **Keep a descriptive role?** — title-only v1; no billing flag (D2).
- [x] **Tiebreak** — lowest-id primary → fallback lowest-id emailable → fail-closed (D3).
- [x] **Backfill rule** — reproduce each dealer's current displayed priority-primary; converges on the 0091 GM (D4).

#### Phase 2: Schema — add designation (expand) + backfill
- [ ] Invoke the **`db-conventions`** skill first.
- [ ] Add the designation column/index to `dealer_contacts.ts`; `drizzle-kit generate`; verify journal `when`.
- [ ] Hand-write the backfill (each dealer's priority-primary → primary) into the migration; apply **sandbox**; verify counts (one primary per dealer with a contact; the 24 customer + 313 staff covered).
- [ ] Update `data-model.md` (new designation; mark the old role enum "being retired").

#### Phase 3: Migrate reads
- [ ] `resolveQuoteRecipient` → filter/order by the designation instead of the role `case` (keep the emailable + deterministic-fallback shape).
- [ ] `queries.ts` → primary-contact selection reads the designation (retire `DEALER_CONTACT_ROLE_PRIORITY` once nothing needs it).
- [ ] `people-columns.tsx` "Customer" badge/filter → rephrase to "Primary" or drop.
- [ ] `people-admin.tsx` link UI → a "primary contact" toggle; `people/actions.ts` validation updated.
- [ ] `people/queries.ts` projection → carry the designation, drop `role`.

#### Phase 4: Contract — drop the legacy enum
- [ ] Once no code reads `dealer_contacts.role`, migration to drop the column + `dealer_contact_role` pgEnum (verify no FK/index left). Apply **sandbox**.
- [ ] Grep the tree for stray `dealer_contact_role` / `'customer'|'staff'|'prospect'` literals.

#### Phase 5: Tests + wiki
- [ ] Unit + real-DB integration: primary selection (recipient targets the designated primary), backfill correctness (priority-primary became primary; one-per-dealer), fallback when no primary/email.
- [ ] Rewrite the `dealer_contacts` section of `data-model.md` to the final model; note the supersede of hotfix A; update `auth.md` if a gate moved.
- [ ] Smoke (web-test): dealer detail + People link UI show/set the primary contact; `/dealerships` unaffected.
