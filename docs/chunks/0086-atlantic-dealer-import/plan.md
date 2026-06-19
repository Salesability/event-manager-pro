# Atlantic Canada dealer BD-list import — Plan

**Intent:** [`intent.md`](intent.md)
**Started:** 2026-06-19

## Progress Tracker

| Phase | Status | Commit |
|-------|--------|--------|
| 1: Decision gate + source prep + prod-overlap probe | Done | `4e5781e` |
| 2: Schema migration — `dealers.notes` / `.phone` / `.manufacturer` | Done | `9788c7e` |
| 3: Wire `loadDealer` + QBO push to read `dealers.phone` | Done | `458e865` |
| 4: Import script — parse → 3-layer dedup → upsert dealers + contacts | Done | `a482d68` |
| 5: Sandbox dry-run + verify | Done | (sandbox-only, no code commit) |
| 6: Prod migration + run + verify | Pending (owner-gated) | - |

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

**Overall Progress:** 83% (5/6 phases complete — Phase 6 is the owner-gated prod step)

**Chunk-end `/eval` (code, Phases 1–5):** **PASS with warnings** — [eval-2026-06-19-1359](eval-2026-06-19-1359.md). Static clean (tsc, **1182 pass/2 skip** serial, **0 new lint**), browser smoke PASS (`/dealerships` Prospect (274) + imported detail render, 0 console errors), Codex 0 High/0 Med/2 Low (both by-design/out-of-scope → parked **0086-a** no-DB-unique-on-name+address, **0086-b** archived-contact reuse). Run before the prod step so the owner has a clean gate; the chunk does **not** auto-close (Phase 6 prod is owner-gated).

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
- [x] Extended `loadDealer` (`queries.ts`) projection + return type to carry `phone` / `manufacturer` / `notes` (kept off the base list `Dealer`, mirroring `quickbooksId`). The activation/edit push paths build their `DealerToPush` via `loadDealer`, so they now carry the rooftop phone automatically.
- [x] `mapDealerToCustomer` (`dealer-push.ts`): `PrimaryPhone = dealer.phone ?? dealer.primaryPhone` (prefer the rooftop line, fall back to contact); added optional `phone?` to `DealerToPush`; refreshed the stale "phone comes from the contact" comment. `createDealer`'s inline no-reuse `toPush` sets `phone: null` (UI create has no rooftop-phone field).
- [x] Unit tests (`dealer-push.test.ts`, +4): prefers `dealer.phone` over contact phone; falls back when null/absent (no behavior change); emits from `dealer.phone` alone; omits when both absent.
- [x] Confirmed **no push fires for a prospect** — gate `if (status === 'active')` unchanged; already covered by `dealers/actions.test.ts:419` ("does not run the QB check for a prospect"). The Phase-4 import inserts directly (bypasses the action) so it never pushes regardless.

#### Phase 4: Import script — parse → 3-layer dedup → upsert dealers + contacts
- [x] `scripts/import-atlantic-dealers.ts`: reads the JSON → per non-dropped row: find-or-create dealer (name+city dedup → insert `status='prospect'`, `province`, `phone`, `manufacturer`, composed `notes`, `acquiredVia`), find-or-create each contact **by email** (reuse across rooftops; name-only contacts deduped per `(dealer, role, title)`), link `dealer_contacts` (`role='staff'`, `title` GM/SM, `onConflictDoNothing`). Contact+email-identifier insert is in a tx (0085 orphan guarantee).
- [x] `--dry-run` mode: per-row disposition (`insert` / `skip-existing` / `skip-dup-in-run` / `skip-flagged`; contacts `insert`/`reuse(db)`/`reuse(in-run)`) + summary counts; **no writes**. Validated on sandbox: 281 → 6 flagged / 274 dealers / 1 in-run dup; 452 contacts (442 email + 10 name-only), 3 reuse-db, 17 reuse-in-run — reconciles exactly.
- [x] Dedup mirrors the 0085 helpers (`dedup.ts`) inlined on the runner's own connection (the helpers import `@/lib/db`'s un-closable pool + the QBO client pulls `server-only`). **`findCustomerByDisplayName` deliberately NOT called** — prospects don't link to QBO (D7); the prod-QBO overlap is reported by `scripts/atlantic-overlap-probe.mjs` instead.
- [x] Unit tests on the pure mapper (`src/features/dealers/atlantic-import.ts` → `atlantic-import.test.ts`, 13 tests: dealer fields, city→address, province parse, notes block, GM/SM contacts, name-only, drop-list) — no live DB/QBO in CI.

#### Phase 5: Sandbox dry-run + verify
- [x] `--dry-run` against sandbox → 281 → 6 flagged / 274 dealers / 1 in-run dup; 452 est. contacts (442 email + 10 name-only), 3 reuse-db, 17 reuse-in-run. Reconciles with the probe (0 name+addr, 274 distinct).
- [x] Real run against **sandbox**: 274 dealers inserted (all `status='prospect'`, province split NB:90/NL:56/NS:108/PE:20), 451 contacts. Spot-checks: Acura of Moncton (`address='Moncton'` city-only, NB, phone `506-853-1116`, manufacturer Acura, notes block), Atlantic Acura (multi-line notes). **Cole Darrach = ONE contact (id 612) with 4 `dealer_contacts` links** across 4 Rallye rooftops (cross-rooftop email dedup ✓). All 6 flagged rows absent; kept sibling Smith & Watt Chrysler present; Motor Hub Antigonish = exactly 1.
- [x] **Re-run** against sandbox → **0 dealers / 0 contacts / 0 links inserted** (274 skip-existing, 462 reuse-db, 10 reuse-by-title, 472 already-linked); batch counts unchanged (274/442/471). Idempotent ✓.
- [x] Smoke (web-test): `/dealerships` renders 200, no console errors; **"Prospect (274)"** filter present; imported rows render (Acura of Moncton/Atlantic Acura/Acadia Toyota — name + GM contact + email + city + `prospect`). _Caveat: `dealers.phone`/manufacturer/notes are stored + consumed by the QBO push but not surfaced in the dealer UI (no roster UI in scope); the list shows the contact phone (null for imports)._

#### Phase 4/5 addendum — prod-overlap pivot to a vetted worksheet (D8)
The Phase-1 prod probe (owner-run 2026-06-19) found the prod overlap is **large + messy** (67 name-matches; dealer groups share phones + postal codes across distinct brand rooftops; BD list is city-only) — the naive name+address dedup would have created ~67 dups. So:
- [x] Added `scripts/atlantic-reconcile.mjs` → `scripts/data/atlantic-reconciliation.csv` (read-only, name+phone+fuzzy with a distinctive-token gate + a "distinct phone ⇒ distinct rooftop" rule for group expansion, e.g. O'Regan's 12 brand rooftops). Owner **vetted** the 26 ambiguous rows → **188 import-new · 86 skip-existing** (`95144fd`).
- [x] Rewired `import-atlantic-dealers.ts` to **honor the worksheet's `suggested_action`** (keyed by name+city) instead of its own prod dedup; `skip-existing` rows never insert; anything not `import-new` is skipped-with-warning (never guessed) (`276b9b7`).
- [x] **Re-validated on sandbox** (reset the old 274 batch first): dry-run 6 flagged / 86 vetted-skip / 188 import-new / 0 unvetted; real run 188 dealers + 302 contacts + 312 links; **re-run = 0 inserts** (idempotent); spot-checks confirm O'Regan's 12 brand rooftops imported + 2 Hyundai skipped, Central Nova Hyundai+Subaru imported, Audi Moncton/King's County Honda skipped, MINI Moncton/Halifax Chrysler imported.

#### Phase 6: Prod migration + run + verify (owner-gated)
- [x] Read-only prod-overlap probe + reconciliation worksheet run against prod + owner-vetted (above). _(QBO DisplayName layer still optional — prod QBO token expired 2026-06-17; reconnect to add it as a 3rd signal, non-blocking.)_
- [ ] Apply `0041` to **prod** first (`pnpm db:migrate:prod`, session pooler 5432); verify columns. _(Owner-gated; gcloud reauth may be needed — [[project-prod-gcp]].)_
- [ ] `--dry-run` against **prod** (`./scripts/with-prod-db.sh pnpm dlx tsx scripts/import-atlantic-dealers.ts --dry-run`) → expect **188 import-new / 86 skip-existing / 0 unvetted**; review before writing.
- [ ] Real run against **prod** → ~188 new prospect dealers + their contacts; verify counts + spot-checks; **no QB writes** (all prospects).
- [ ] Record the prod import in `CURRENT.md` (counts, date); note QB activation is deferred per-dealer.
