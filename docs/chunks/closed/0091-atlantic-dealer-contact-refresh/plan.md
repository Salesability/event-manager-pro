# Atlantic Dealer Contact Refresh — Plan

**Intent:** [`intent.md`](intent.md)
**Started:** 2026-06-23

## Progress Tracker

| Phase | Status | Commit |
|-------|--------|--------|
| 1: Preview/diff gate (read-only) + owner vet + conflict policy | Done — ledger built + run vs prod; 8 rows vetted (`approved=yes`); D6 keep-unlisted, D7 surfaced | - |
| 2: Update script — refresh + make GM primary (Option A) | **Done — committed to prod 2026-06-23** (104 contacts created, 40 GM-repoints, 74 SM links; Century shared-contact collision found + fixed; idempotent) | (data-only) |
| 3: QBO propagation per updated active/linked dealer (best-effort) | **Done — pushed to prod 2026-06-23** (`scripts/atlantic-contact-qbo-push.ts --write`): 62 Customers updated (contact-only sparse), idempotent, 0 errors; 1 unlinked Parkway dup skipped (0086-a) | (data-only) |
| 4: Tests (reconcile module) + wiki/log + close | **Done** — 12 unit tests (`atlantic-contact-refresh.test.ts`) green, tsc clean, log.md noted | - |

Un-parks **0086-c**: apply the Atlantic BD tracker's GM/SM contacts as **updates**
to the 86 owner-vetted `skip-existing` prod dealers the 0086 insert-only import
left untouched. "Done" = the 86 existing dealers carry their BD-tracker primary
contact (owner-vetted, no silent clobber), the change propagates to any linked
QuickBooks Customer, and a re-run is a no-op. **No migration, no UI** — a
data-only script mirroring the 0086 import tooling.

## Code Anchors

For each new file/method below, the builder reads the anchor first and matches its
shape (length, error handling, naming, query style).

| New code | Anchor (`path:line`) | Why this anchor |
|----------|---------------------|-----------------|
| `scripts/atlantic-contact-refresh-preview.mjs` (read-only diff → CSV) | `scripts/atlantic-reconcile.mjs` | The 0086 read-only worksheet builder — same shape: read prod, read BD source, emit an owner-vettable CSV with a per-row disposition column; no writes |
| `scripts/atlantic-contact-refresh.ts` (the write run) | `scripts/import-atlantic-dealers.ts` | Idempotent, prod-targeting, `--dry-run` flag, reads `data/*.{json,csv}`, `postgres({max:1})`, `with-prod-db.sh`, summary stats — the closest sibling runner |
| contact-update logic (update staff link in place + swap primary identifiers + refresh denorm fields) | `src/features/schedule/actions.ts:447-625` (`updateDealer`) | The canonical "update an existing dealer's contact" semantics to replicate: update highest-priority staff link (`:531-533`), update names, `swapPrimaryIdentifier` for email+phone (`:597-598`) |
| primary email/phone swap helper (mirror, not import — `@/lib/db` eager pool unsuitable for tsx, see import script header `:22-26`) | `src/features/schedule/actions.ts` `swapPrimaryIdentifier` | Honors the `(contactId, kind) WHERE is_primary` partial-unique; demote-old + set-new |
| QBO push trigger after each update | `src/features/schedule/actions.ts:198-208` (`autoPushActiveDealerToQuickbooks`) + `src/lib/quickbooks/dealer-push.ts:84-114` (`pushDealerToQuickbooks` create/update) | The existing best-effort app→QBO push; gate on `status==='active' \|\| quickbooksId`; pushes `GivenName/FamilyName/PrimaryEmailAddr/PrimaryPhone` (`dealer-push.ts:51-69`) |
| BD-tracker contact extraction (GM/SM slots from a row) | `src/features/dealers/atlantic-import.ts` (`mapRowToDealer`, contact slots) | Reuse the existing pure mapper — same GM/SM title + name/email shape the import already produces |

**Conventions referenced:**
- `docs/wiki/data-model.md` — `dealer_contacts` (`role`/`title`), `contacts`, `contact_identifiers` primary-per-(contact,kind) uniqueness; dealer denormalized contact fields.
- `CLAUDE.md` → Deploys / prod DB ops — apply nothing schema-wise (no migration); run prod via `scripts/with-prod-db.sh`, never the 6543 pooler for the write run.

**Overall Progress:** 100% (4/4 phases complete) — shipped to prod 2026-06-23

**Note:**
- This is a **data-migration / scripting** chunk, not a feature — "tests" = unit tests on the pure diff/mapper logic + dry-run-against-real-prod validation, not browser smoke.
- The reconciliation worksheet already carries `prod_match_name`/`prod_match_status` per `skip-existing` row — Phase 1 resolves the prod dealer from there, not by re-deriving the match.

### Phase Checklist

#### Phase 1: Preview/diff gate (read-only) + owner vet
- [x] **Sequencing decided (2026-06-23): run 0091 BEFORE 0089** (owner: "do 0091 first") — D1.
- [x] Decided: **GM + GSM/SM** (D2 revised — worksheet authoritative, stamp `General Manager`/`Sales Manager`) + **flag conflicts** (D3 revised to the reconcile model) — see [`decision.md`](decision.md).
- [x] Confirmed title provenance from the source xlsx header: col 6 `General Manager`, col 8 `GSM/SM` (no per-person title cell — positional). All 86 are **QBO-linked**; **0 have a GM/SM-titled link** (each has ~1 existing primary contact).
- [x] `scripts/atlantic-contact-refresh-preview.ts` (read-only; reuses `mapRowToContacts`): per `skip-existing` dealer, reconciles BD GM **and** SM against the dealer's existing contacts — exact match (email→name), then a **fuzzy pass** (Levenshtein ≤2 / shared email local-part / last-name+initial) so spelling variants become `update` not duplicate `add`. Emits per-contact ledger `scripts/data/atlantic-contact-refresh-preview.csv` (disposition `add`/`update`/`update-email`/`no-change`/`conflict`/`existing-unlisted` + `approved` col).
- [x] Ran read-only vs **prod**: **112 add** (40 GM + 72 SM) · **5 update** (fuzzy same-person) · **14 update-email** · **25 no-change** · **3 conflict** · **39 existing-unlisted**. **83 dealers touched, all QBO-linked** (Phase-3 push size). 0 residual near-dups after the fuzzy pass.
- [ ] **Owner: vet 8 rows** — the **5 `update`** (fuzzy same-person, e.g. `Rick Millner`/`Rick Milner`) + **3 `conflict`** (shared email, different name — all prod data errors where the BD name is right). Set `approved=yes` to apply. `add`/`update-email` are pre-approved.
- [ ] **Owner: 39 `existing-unlisted`** (prior contacts the worksheet omits) — default **keep**; flag any to archive.
- [ ] **Phase-2 detail (D5):** which contact becomes the dealer **primary** (lean: GM). Resolved the A/B fork → enrich (add titled GM+SM, keep existing) rather than overwrite.

#### Phase 2: Update script — refresh primary contact (write)
- [ ] `scripts/atlantic-contact-refresh.ts` (`--dry-run` default-safe), mirrors `import-atlantic-dealers.ts`: for each **owner-approved** row, find-or-update the target staff contact, update `contacts.firstName/lastName`, swap primary email + phone identifiers (demote-old/set-new, honor the partial-unique), refresh denormalized `contactFirstName/contactLastName/primaryEmail/primaryPhone` on `dealers`, stamp `updatedById` + `source`.
- [ ] Wrap contact + identifier writes in a tx (0085 orphan-row guarantee).
- [ ] Idempotency: a re-run reports **0 changes** (compare-before-write; skip rows already matching).
- [ ] Never touch `import-new` dealers or rows the owner didn't approve; `conflict`/`no-match` rows skip-with-warning (never guessed).
- [ ] Unit test the pure diff/decision logic (no DB): `no-change`/`would-update`/`conflict`/`no-match` classification + the GM-slot selection.

#### Phase 3: QBO propagation (best-effort)
- [ ] After each successful DB update, for dealers where `status==='active' || quickbooksId`, trigger the QBO push — replicate `autoPushActiveDealerToQuickbooks` semantics (get a valid token, call `pushDealerToQuickbooks`); a linked dealer takes UPDATE, an active-unlinked one takes CREATE+backfill.
- [ ] Best-effort: a missing/expired token or a per-dealer push error is logged and **does not** roll back or block the DB update (mirror the action's swallow-and-continue).
- [ ] Dry-run reports which dealers *would* push (active/linked count) without calling QBO.
- [ ] (Pre-req) confirm/refresh the prod QBO connection at `/admin/quickbooks` before the real push run (0086-d token-expiry note).

#### Phase 4: Validate + ship + close
- [ ] Sandbox dry-run, then sandbox write + re-run (confirm 0-change idempotency) if sandbox has comparable rows; otherwise validate the preview against real prod read-only.
- [ ] **Prod:** preview (read-only) → owner vet → `with-prod-db.sh` write run → re-run = 0 changes; record counts (rows updated / contacts changed / QBO pushes ok·skipped·failed).
- [ ] Verify a spot-check dealer on prod shows the new contact; if QBO-linked, confirm the Customer carries the new `GivenName/FamilyName/PrimaryEmailAddr/PrimaryPhone`.
- [ ] Wiki: note the enrichment in `docs/wiki/data-model.md` (or the dealer/QBO page) if it changes any stated invariant; update `CURRENT.md` History; move to `closed/` on clean `/eval`.
