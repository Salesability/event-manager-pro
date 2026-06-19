# Atlantic Canada dealer BD-list import — Plan

**Intent:** [`intent.md`](intent.md)
**Started:** 2026-06-19

## Progress Tracker

| Phase | Status | Commit |
|-------|--------|--------|
| 1: Decision gate + source prep + prod-overlap probe | Done | `4e5781e` |
| 2: Schema migration — `dealers.notes` / `.phone` / `.manufacturer` | Done | - |
| 3: Wire `loadDealer` + QBO push to read `dealers.phone` | In Progress | - |
| 4: Import script — parse → 3-layer dedup → upsert dealers + contacts | Pending | - |
| 5: Sandbox dry-run + verify | Pending | - |
| 6: Prod migration + run + verify | Pending | - |

A one-time, idempotent import of the cleaned 281-rooftop Atlantic Canada BD list
into the app as **prospect** dealers (no QB push — prospects don't push, 0084),
deduped three ways (in-sheet drop-list · existing prod app dealers · existing prod
QBO Customers) and re-runnable as a no-op. "Done" = sandbox dry-run reports the
expected dispositions, a re-run inserts zero rows, every spreadsheet column is
mapped or deliberately dropped, the prod-overlap probe has reported before any
prod write, and the prod run completes after the prod migration.

## Code Anchors

For each new file or method below, the builder reads the anchor first and matches
its shape (length, error handling, naming, query style). For modifications to an
existing file, the anchor is the nearest sibling method in that same file.

| New code | Anchor (`path:line`) | Why this anchor |
|----------|---------------------|-----------------|
| `scripts/import-atlantic-dealers.ts` (the import: parse → dedup → upsert) | `scripts/import-from-sheets.ts:212-235` (`findOrCreateDealer`) + `:237-289` (`findOrCreateContactForClient`) | The find-or-create dealer + contact-by-email logic to mirror already exists in the legacy import; reuse its shape (publicId, splitName, identifier insert) |
| Source prep — xlsx → committed normalized data file | `scripts/import-from-sheets.ts:44-51` (`fetchTab` → `string[][]`) | The legacy import consumes `string[][]`; the new prep step produces the same shape from the local `.xlsx` instead of the Sheets API |
| `dealers.notes` / `.phone` / `.manufacturer` columns | `src/lib/db/schema/dealers.ts:16-52` (the table def; `acquiredVia` text col at `:30` is the nearest nullable-text sibling) | Add three nullable `text()` columns next to the existing ones; no index needed |
| Migration `0041_*` (generate + apply) | `drizzle/0040_wealthy_ultragirl.sql` + **`db-conventions` skill** | Mirror the additive-column migration; **verify the journal `when` > previous (see [[project-drizzle-journal-when-gotcha]])** |
| `loadDealer` projects `phone`/`manufacturer`/`notes` | `src/features/schedule/queries.ts` (`loadDealer` — the existing `Dealer` projection that already returns `primaryEmail`/`primaryPhone`/`province`) | Extend the same projection; the push reads from it |
| QBO push reads `dealers.phone` | `src/lib/quickbooks/dealer-push.ts:46-62` (`mapDealerToCustomer`) + `DealerToPush` (`:33-43`) | Prefer `dealer.phone` for `PrimaryPhone` so an activated prospect's Customer gets a phone (the rooftop line no longer lives on a contact) |
| Dealer/contact/QBO dedup | `src/features/dealers/dedup.ts` (`findExistingDealerByNameAddress`, `findExistingContactByIdentifier`) + `src/lib/quickbooks/client.ts` (`findCustomerByDisplayName`) | The 0085 helpers ARE the dedup; the import calls them rather than re-implementing |
| Prod-overlap probe (read-only) | `scripts/qbo-item-sync-probe.mjs` (read-only prod probe via `with-prod-db` pattern) | Mirror the read-only probe shape — count matches, write nothing |

**Conventions referenced:**
- `docs/wiki/data-model.md` — `dealers` / `contacts` / `contact_identifiers` / `dealer_contacts` shapes; the `contact_identifiers_kind_value_active_unique` index (why phone can't be a contact identifier); `dealer_contacts` composite-unique `(dealerId, contactId, role)` + the `title` column (GM/SM).
- **`db-conventions` skill** — invoked before the schema change + migration; ID/type defaults, additive-column pattern, the direct-vs-pooled connection rule for applying migrations, the journal-`when` gotcha.
- `docs/wiki/go-live-accounts.md` + [[project-prod-db]] / [[project-prod-gcp]] — prod DB ops go through `scripts/with-prod-db.sh` / `pnpm db:migrate:prod` (session pooler 5432); apply migration **before** the prod import; prod gcloud reauth gotcha.
- **0084 / 0085 reuse** — prospects don't push (status-gated); the dedup helpers + `findCustomerByDisplayName` are the dedup engine; `findExistingContactByIdentifier` makes a shared-email person one contact with many dealer links.

**Overall Progress:** 33% (2/6 phases complete)

**Note:**
- The settled mapping/contact/dedup decisions from the scoping conversation are pre-recorded in `intent.md`; Phase 1's job is to **lock the remaining opens** (source format, idempotency key, prod-overlap handling, city→address) + run the **read-only prod-overlap probe** before any write.
- **Migration expected** (Phase 2: `0041` adds 3 nullable columns). Sandbox-apply before Phase 4; prod-apply in Phase 6 before the prod import.
- **Writes ~275 dealers + ~447 contacts into PROD** (Phase 6) — owner-gated; sandbox dry-run (Phase 5) must pass first.

### Phase Checklist

#### Phase 1: Decision gate + source prep + prod-overlap probe
- [x] **Record the settled mapping** in a `decision.md` (dealer columns, contact GM/SM + dedup-by-email, phone→`dealers.phone`, manufacturer→column, Group/Verification/Co-op/Notes→`notes`, dropped BD-workflow columns, status=prospect, `acquiredVia` batch tag). → [`decision.md`](decision.md) D2/D3.
- [x] **Decide source format:** committed normalized JSON (D1) — `scripts/data/atlantic-dealers.json` produced (all 281 raw rows + explicit `dropList`; reconciles to 274 dealers / 445 emails). No runtime xlsx dep.
- [x] **Build the in-sheet drop-list** (D5): 6 rows as explicit data in the JSON `dropList` (Smith & Watt Limited, Hooked on Detailing, Grand Falls Hyundai, Central Garage, Cole Ford, Nadeau Hyundai). The 2nd Motor Hub Antigonish row is **not** listed — it auto-dedups via name+city find-or-create.
- [x] **Decide idempotency keys** (D4) — dealer `lower(trim(name))+lower(trim(address))`; contact email (lower+trim); name-only contact per `(dealer, role, title)`; link via `dealer_contacts` unique + `onConflictDoNothing`.
- [x] ~~**Run the read-only prod-overlap probe** against prod~~ → probe **written + sandbox-validated** (`scripts/atlantic-overlap-probe.mjs`: 274 import dealers; sandbox = 0 name+addr / **10 name-only** matches / QBO token expired→skipped). The **prod**-count run is grouped with the Phase-6 owner gate (it's a prod read; per D7 it runs immediately before the prod dry-run so counts reflect write-time prod state).
- [x] **Decide prod-overlap handling** (D7): app name+address → skip-with-report; QBO-only DisplayName → leave unlinked (prospect doesn't push). Default recorded; **owner confirms at the Phase-6 gate** (also surfaces the city-only-address name-only-match caveat, D6).
- [x] **Decide city→address** (D6) — **city only** (province is its own column).

#### Phase 2: Schema migration — `dealers.notes` / `.phone` / `.manufacturer`
- [x] Invoke the **`db-conventions`** skill first. (Additive nullable columns → no backfill, no index.)
- [x] Add `phone`, `manufacturer`, `notes` (all nullable `text()`) to `src/lib/db/schema/dealers.ts` (next to `acquiredVia`).
- [x] `drizzle-kit generate` → `0041_strong_slyde.sql` (3 `ADD COLUMN`, no auth-schema noise); journal `when` `1781889306090` > `0040`'s `1781565684779` ✓.
- [x] Applied to **sandbox** (session pooler 5432); verified the 3 columns exist (`information_schema` → all nullable text).
- [x] Updated `docs/wiki/data-model.md` (ER block + entity-catalog row) + `docs/wiki/log.md` entry.

#### Phase 3: Wire `loadDealer` + QBO push to read `dealers.phone`
- [ ] Extend `loadDealer` (`queries.ts`) projection to return `phone` / `manufacturer` / `notes`.
- [ ] `mapDealerToCustomer` (`dealer-push.ts`): `PrimaryPhone` prefers `dealer.phone` (fallback to the primary contact's phone) so an **activated** prospect's QBO Customer carries the rooftop line; add `phone` to `DealerToPush`.
- [ ] Unit tests: `mapDealerToCustomer` emits `PrimaryPhone` from `dealers.phone`; no behavior change when `phone` is null.
- [ ] Confirm **no push fires for a prospect** (status-gated, unchanged from 0084).

#### Phase 4: Import script — parse → 3-layer dedup → upsert dealers + contacts
- [ ] `scripts/import-atlantic-dealers.ts`: read the Phase-1 data file → for each non-dropped row: find-or-create dealer (dedup name+address; insert `status='prospect'`, `province`, `phone`, `manufacturer`, `notes` block, `acquiredVia`); find-or-create each contact **by email** (reuse across rooftops); link `dealer_contacts` (`role='staff'`, `title` GM/SM). Idempotent guarded inserts.
- [ ] `--dry-run` mode: print per-row disposition (insert / link-existing-contact / skip-existing-dealer / skip-flagged) + summary counts; **no writes**.
- [ ] Reuse the 0085 dedup helpers + `findCustomerByDisplayName`; respect the Phase-1 prod-overlap decision.
- [ ] Unit tests on the pure mapper (row → dealer fields + notes block + contact list) + the in-sheet drop-list; no live DB/QBO in CI.

#### Phase 5: Sandbox dry-run + verify
- [ ] `--dry-run` against sandbox → confirm ≈275 dealers / ≈447 contacts and the disposition breakdown matches the probe.
- [ ] Real run against **sandbox**; verify: counts, a few spot-checked dealers (province/phone/manufacturer/notes populated, `status='prospect'`), a shared-email person (e.g. Cole Darrach) is **one** contact with multiple `dealer_contacts` links, the ~6 flagged rows are absent.
- [ ] **Re-run** against sandbox → asserts **0** new rows (idempotent).
- [ ] Smoke (web-test): `goto /dealerships` → an imported prospect renders (status prospect, province, phone shown).

#### Phase 6: Prod migration + run + verify
- [ ] Apply `0041` to **prod** first (`pnpm db:migrate:prod`, session pooler 5432); verify columns. _(Owner-gated; gcloud reauth may be needed — [[project-prod-gcp]].)_
- [ ] `--dry-run` against **prod** → review dispositions (esp. existing-dealer/QBO overlaps) before writing.
- [ ] Real run against **prod**; verify counts + spot-checks; **no QB writes** (all prospects).
- [ ] Record the prod import in `CURRENT.md` (counts, date); note QB activation is deferred per-dealer.
