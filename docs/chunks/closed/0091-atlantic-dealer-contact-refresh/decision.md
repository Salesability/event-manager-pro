# 0091 — Decisions

## D1 — Sequencing: run 0091 *before* 0089 (2026-06-23)

Owner: *"do 0091 first."* 0089 (explicit primary-contact designation) is parked
behind this. Consequence for this chunk: the update **targets the contact by
`title='General Manager'`**, NOT the `resolveQuoteRecipient` staff>customer>prospect
priority heuristic — so when 0089 later introduces the designation column, its
migration has a clean, title-anchored GM link to promote rather than a heuristic
to untangle.

## D2 — Scope: BOTH GM + GSM/SM (REVISED 2026-06-23)

~~GM-only.~~ **Revised:** include **both** contacts. Owner: *"the excel worksheet
is authoritative so we can assume the GM title — can we also include the GSM/SM,
contacts are key to the system."*

- The source ("Dealer Tracker" sheet) labels contacts by **column**, not a
  per-person title field: col 6 = **`General Manager`** (+ `Contact 1 Email`),
  col 8 = **`GSM/SM`** (+ `Contact 2 Email`). Confirmed by reading the xlsx
  header directly. There is no free-form Title cell — the role is positional, and
  the **owner deems the worksheet authoritative**, so we stamp the title from the
  column.
- Titles stamped: **`General Manager`** and **`Sales Manager`** — the same two
  `ContactTitle` values `src/features/dealers/atlantic-import.ts` already used for
  the 188 import-new dealers (0086), so the 86 stay consistent with them.
- Both contacts are reconciled per dealer (an empty slot is skipped). This makes
  the operation an **enrichment** ("contacts are key"), not just a single-primary
  overwrite.

## D3 — Conflict policy under the reconcile model (REVISED 2026-06-23)

Owner: *"flag conflicts."* Under the both-contacts reconcile model (D2), each BD
slot (GM, SM) is matched against the dealer's **existing** contacts (by email,
then by name). Per-slot disposition + auto-approval:

- `add` — no existing contact matches this BD person → **create** a titled staff
  link. Low-risk (adds, never overwrites) + worksheet is authoritative →
  **pre-approved**.
- `no-change` — an existing contact already matches on name **and** email.
- `update-email` — same person (name matches), email differs/blank → refresh the
  email. **Pre-approved** (the refresh is the point).
- `conflict` — an existing contact shares the BD **email** but a **different
  name** (a prod data inconsistency — which name is right?) → **flag, owner vets**.
- `existing-unlisted` — an existing contact the worksheet doesn't list (matches
  neither slot). **Default keep** (no action); surfaced so the owner can choose
  to archive a stale one. Never auto-deleted.
- `no-bd-data` / `no-match` — nothing to apply / dealer unresolved (flagged).

## D4 — Target set (from intent / owner Q): the 86 `skip-existing` rows only

The preview is driven by `scripts/data/atlantic-reconciliation.csv` filtered to
`suggested_action='skip-existing'`. The 188 `import-new` dealers (handled by 0086)
are out of scope. No re-audit of the import-new/skip-existing split.

## D5 — Phase-1 finding + an OPEN Phase-2 call (the preview surfaced this)

The read-only prod preview (`scripts/atlantic-contact-refresh-preview.ts` →
`scripts/data/atlantic-contact-refresh-preview.csv`, run 2026-06-23) found:

- **All 86 are QBO-linked.** Every refresh would also push to a QBO Customer.
- **ZERO prod dealers have a `General Manager`-titled link.** Each of the 86
  already has exactly **one existing primary contact** (legacy/QBO-sourced).
- Tally vs the BD GM: **24 no-change** · **11 update-email** (same person, fresher
  email — pre-approved) · **48 conflict** (a *different* person) · **3 no-bd-data**.
  59 of the touched dealers are QBO-linked.

**Resolved by D2's revision (both-contacts reconcile + authoritative titles):**
since no GM-titled links exist, we **add** the authoritative GM + SM as titled
staff links (the `add` disposition), **refresh** an existing same-person email
(`update-email`), and **keep** any existing-unlisted contact (surfaced, not
deleted). The dealer ends up with the worksheet's GM + SM as titled contacts plus
any prior contact retained for review — "contacts are key," so we enrich rather
than overwrite.

**Phase-2 write detail still to confirm:** which contact becomes the dealer's
**primary** (quote recipient / QBO `GivenName/FamilyName`). Lean: the **GM**.
Running ahead of 0089 there's no explicit designation column, so "primary" is the
role/link-order heuristic — Phase 2 ensures the GM link sorts first (or 0089 later
formalizes it). `conflict` rows (same-email/different-name) are never applied
without `approved=yes`.

## D6 — Existing-unlisted contacts: KEEP (2026-06-23)

Owner: *"Keep."* The 39 `existing-unlisted` contacts (prior contacts not in the BD
worksheet) **stay linked to their dealer**. 0091 is **enrichment-only** — it adds
the authoritative GM + SM and refreshes matched contacts, and **never archives or
deletes** an existing contact or `dealer_contacts` link.

Rationale: we never hard-delete (schema soft-deletes via `archived_at`); the
worksheet only covers GM + GSM/SM so absence ≠ departure; removing real contacts
is hard to undo. Some of these people may have moved on / to another rooftop — but
confirming that is a deliberate per-dealer cleanup, not a blind purge folded into
an import. Parked as **0091-a** (confirm/archive departed dealer contacts) — the
model already supports it: archive the **`dealer_contacts` link**, not the
`contacts` row (which may be shared across rooftops). See `docs/wiki/lifecycle.md`
— "archive the relationship, not the entity."

## D8 — Phase-2 commit + the shared-contact collision (2026-06-23)

Committed to prod (`scripts/atlantic-contact-refresh.ts --write`): 86 dealers,
104 contacts created, 8 reused, 40 GM-repoints (+43 already-primary), 74 SM links,
8 names / 18 emails refreshed, 1 benign email conflict (Mark Wilkins is the shared
GM at BMW + MINI St John's → his email stays on the BMW record).

**Collision found post-commit (the dealer-group shared-contact hazard):** a contact
linked to TWO of the 86 dealers whose BD tracker names DIFFERENT people gets
mangled, because the writer reconciles each dealer against a pre-write snapshot and
applies sequentially. **One case hit it:** contact 18 was shared by Century Honda
(BD GM = Jayson Pearce) and Century Hyundai (BD GM = Don Graham). A re-run created
Honda's own Jayson Pearce + repointed; a one-off (`scripts/atlantic-honda-relink-fix.mjs`)
archived the leftover Don-Graham→Honda link. Honda now = Jayson Pearce (GM/primary)
+ Veronica Kennedy (SM); Don Graham is Hyundai-only. Also fixed a writer bug: a
displaced relink **inherited the old link's title** (left a phantom GM) → now always
`null`/`Sales Manager`. **Final state: writer is idempotent (0 creates/repoints on
re-run), all 83 GMs primary.**

**Parked to 0091-a (cleanup, D6 keep-by-default):** 8 shared contacts remain — most
legitimate (Cole Darrach across 4 Rallye rooftops; BMW/MINI shared SM) but several
are **stale leftover links** (Andres Monterrosa kept on Mercedes-Benz though he's
Acura's GM; Kirt Macdonald on 2 Steele rooftops; Neal Noseworthy on Fairley&Stevens).
Also surfaced: **duplicate DEALER records** (Parkway Hyundai ids 1 & 19; Sydney Mazda
ids 120 & 121) — a pre-existing dealer-dedup gap (**0086-a**, no DB unique on
name+address), not a 0091 contact issue; resolveProd targeted one of each pair.

## Approvals (Phase-1 close, 2026-06-23)

Owner accepted the recommendation to **approve all 8 vetted rows** (5 `update`
fuzzy same-person + 3 `conflict` where the shared email confirms the BD name).
`approved=yes` set on those rows in `atlantic-contact-refresh-preview.csv`.
`add` + `update-email` were pre-approved by the preview; `existing-unlisted` left
as keep.

## D7 — Making the GM the PRIMARY (open — gates Phase 2) (2026-06-23)

Read-only prod probe (`scripts/atlantic-contact-role-probe.mjs`): **all 86
dealers' existing contacts are `role='staff'`** (88 links). The primary-contact
resolver (`queries.ts:158-198`) picks the **lowest-linkId `staff`** link. So a
newly **added** staff GM (higher linkId) does **NOT** become the primary — the
pre-existing staff contact keeps winning. For the ~40 dealers where the GM is a
brand-new person, pure enrichment would leave the GM a *secondary* contact: not
the quote recipient, not pushed to QBO. That fails the chunk's goal ("update the
**primary** contact").

So Phase 2 must explicitly make the GM the primary. Options:

- **A — swap into the primary slot (no 0089, no app-code):** make the GM occupy
  the dealer's primary staff link (repoint the lowest-linkId staff link to the GM,
  or archive+reinsert so the GM sorts first), and **keep** the displaced person as
  a secondary staff contact (honors D6). Add the SM too. Idempotent.
  *(Recommended — self-contained in this chunk.)*
- **B — title-aware primary (mini-0089):** small change to the resolver to prefer
  `title='General Manager'` among staff. Cleaner + forward-compatible, but it's
  app-code that also flips the 188 import-new dealers' primary to their GM — a
  behavior change to review. A slice of 0089.
- **C — do 0089 first:** the explicit primary-contact designation; then 0091
  designates the GM. Cleanest long-term, reorders the work (this was the original
  soft-dependency).

**Owner picked A (2026-06-23).** Phase 2 makes the GM the primary by **repointing
the dealer's lowest-linkId active staff link to the GM contact** (so the GM
inherits the lowest id → wins the primary heuristic), then **re-links the
displaced person** as a secondary staff contact (honors D6 keep) and **links the
SM** (`title='Sales Manager'`). No 0089, no resolver change. Idempotent: a re-run
sees the GM already on the primary link → no-op. Edge (≤1 dealer): if the GM is
already a *non-primary* staff link on a multi-staff dealer, the `(dealer,contact,
role)` unique (incl. archived) blocks a clean repoint — detect + log + skip for
manual handling rather than mutate roles.
