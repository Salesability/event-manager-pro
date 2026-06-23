# Rationalize the dealer-contact role taxonomy — Plan

**Intent:** [`intent.md`](intent.md)
**Started:** _scaffolded 2026-06-22; not started. Follows hotfix A (`9489978`) which made the
quote/MSA recipient priority-based instead of `customer`-only. This chunk replaces that heuristic
with an explicit, user-editable primary-contact designation and drops the legacy role enum._

## Progress Tracker

| Phase | Status | Commit |
|-------|--------|--------|
| 1: Decision gate — designation shape (`is_primary` vs `primary\|additional`), keep-a-role?, tiebreak, backfill rule | Done | (doc) |
| 2: Schema — add the primary designation (expand) + migration + backfill | Done | `b78f10a` |
| 3: Migrate reads — recipient resolver + queries priority + people badge/dropdown/validation | Done | `cc88e50` |
| 4: Contract — drop the legacy `dealer_contact_role` enum/usage once reads are off it | Done | `a8df8f3` |
| 5: Tests + wiki | Done | - |

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

**Overall Progress:** 100% (5/5 phases complete)

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
- [x] Invoke the **`db-conventions`** skill first.
- [x] Add the designation column/index to `dealer_contacts.ts` (`is_primary` + partial-unique `WHERE is_primary AND archived_at IS NULL`); `drizzle-kit generate` → `0043_milky_layla_miller.sql`; journal `when` verified > 0042.
- [x] Hand-wrote the backfill (DISTINCT ON priority-primary → `is_primary`) into `0043`; applied **sandbox**; verified: **212 dealers w/ contact → 212 primaries (one each)**; 313 staff + 24 customer + 0 prospect; **165/165 GM-titled dealers have the GM as primary** (0091 convergence, 0 divergence).
- [x] Updated `data-model.md` — `is_primary` bullet + transition banner marking `role` being retired (full rewrite deferred to Phase 5).

#### Phase 3: Migrate reads
- [x] `resolveQuoteRecipient` → order by `desc(is_primary), asc(id)` (the emailable inner-join already gives D3's deterministic fallback); dropped the role `case` + `sql` import.
- [x] `queries.ts` `fetchPrimaryDealerContacts` → reads `is_primary` (order by `is_primary` then id, first-per-dealer); retired `DEALER_CONTACT_ROLE_PRIORITY`.
- [x] `people-columns.tsx` badge → `dealerName · <title|Primary|Contact>` (brand color when primary); filter `has-customer` → `has-primary` (`l.isPrimary`).
- [x] `people-admin.tsx` link UI → per-link **Primary** checkbox (replaced the role Listbox); wire format `dealerId:<0|1>`; "Customer-side" pill → "Primary contact"; archive message uses title/primary.
- [x] `people/actions.ts` → `parseDealerLinksField` parses the `0|1` flag; `syncDealerLinks` keys on `(contact, dealer)` + sets `is_primary` with **demote-other-primary** (honors the one-per-dealer index). Updated `queries.test.ts` + `actions.test.ts`.
- [x] `people/queries.ts` projection → `DealerLink` carries `is_primary` + `title`, dropped `role` (+ the `DealerContactRole` type).
- [x] Writers (`schedule/actions.ts` createDealer/updateDealer) set `is_primary: true` on a new dealer's first contact; `updateDealer` edits the `is_primary` link in place. `role: 'staff'` kept as a vestigial NOT-NULL placeholder until Phase 4.

#### Phase 4: Contract — drop the legacy enum
- [x] Removed `role` + the `dealerContactRole` enum + the `(dealer,contact,role)` unique + `(dealer,role)` index from `dealer-contacts.ts`; added a plain `dealer_contacts_dealer_id_idx` to preserve dealer-side lookups. Migration `0044_calm_skullbuster.sql` (drop 2 indexes, add dealer_id index, drop column, drop type) — applied **sandbox** (verified: role column 0, `dealer_contact_role` type 0, `is_primary` present).
- [x] Removed the vestigial `role: 'staff'` writes from app code (createDealer/updateDealer/syncDealerLinks) + the existing-link role filters & inserts from the tracked import scripts (`import-from-sheets`/`-atlantic-dealers`/`-quickbooks`).
- [x] Grepped the tree: 0 `dealerContacts.role`/`dealerContactRole`/`dealer_contact_role` code refs remain in tracked files. Remaining hits are **untracked 0091 leftovers** (raw-SQL `dc.role::text` probes that already ran and won't re-run; the reconcile module's own `role` type) — out of 0089 scope, no tsc/test impact.

#### Phase 5: Tests + wiki
- [x] Real-DB integration: rewrote `tests/integration/quote-recipient.test.ts` for `is_primary` (5 cases — designated primary; primary-over-non-primary regardless of id; emailless-primary→emailable fallback (D3); no-primary→lowest-id; fail-closed). Added `tests/integration/dealer-contacts-primary.test.ts` (one-active-primary-per-dealer index + archived-primary-doesn't-block). Unit projection/validation tests updated in Phase 3. Backfill correctness verified via psql (212/212; 165/165 GM).
- [x] Rewrote the `data-model.md` `dealer_contacts` section to the final model + swept the ERD, ASCII diagram, summary table, relationship list, identity prose, send-flow recipient line, and open-questions (#3 collision **resolved**, #15 moot). `auth.md` unchanged (no gate moved — portal routing is an existence check). `log.md` entry added.
- [x] Smoke (web-test) — deferred to the chunk-end `/eval` browser smoke (dealer detail + People link UI + `/dealerships`).
