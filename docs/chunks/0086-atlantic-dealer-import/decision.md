# 0086 — Decisions (Phase 1 gate)

Locks the settled mapping + the four `intent.md` open questions. The leans recorded
in `intent.md` from the scoping conversation are adopted as-is unless noted.

## Source data

- **File:** `Atlantic_Canada_Dealer_BD_Tracker June 26 draft 5(73) (1).xlsx`
  (the owner's cleaned BD tracker; lived in `~/Downloads`, not the repo).
- **Sheet used:** `Dealer Tracker` (the `Dashboard` + `Read Me` sheets are
  human-facing summaries, not imported). 281 data rows, 19 columns.
- **Dashboard cross-check** (the sheet's own live counts): NS 112 / NB 93 / NL 56 /
  PE 20 = 281; manufacturers 19 distinct. Matches our parse exactly.

## D1 — Source format → **committed normalized JSON** (intent OQ "Source format")

Convert the `.xlsx` → `scripts/data/atlantic-dealers.json` (committed, reviewable in
the diff, no runtime xlsx dependency). The import reads the JSON. Chosen over a
runtime xlsx parse: deterministic, diff-reviewable, and the repo's node/pnpm
toolchain has no xlsx reader (the conversion used a throwaway Python+openpyxl pass;
not committed — the JSON is the artifact, the method is recorded here).

**JSON shape:** a faithful dump of **all 281 rows** (raw, trimmed fields) + an
explicit `dropList` array. The import (not the prep) applies the drop-list, the
name+city dedup, and the email contact dedup — so the JSON stays a complete record
and the mapper stays unit-testable. Pure BD-workflow columns (Priority, Pipeline
Stage, Owner, Last Contact, Next Action, Next Action Date) are **not exported**.

## D2 — Dealer mapping

| Sheet column | Dealer field | Notes |
|--------------|--------------|-------|
| Dealership | `name` | as-is |
| City | `address` | **city only** — see D6 |
| Province | `province` (`ca_province` enum) | NS/NB/NL/PE all valid enum codes |
| Phone (rooftop) | `phone` (**new**, Phase 2) | rooftop line, not a contact identifier |
| Manufacturer | `manufacturer` (**new**, Phase 2) | raw text ("FCA", "Ford/Lincoln", "General Motors", …) |
| Group + Contact Verification + Co-op Eligible? + Notes | `notes` (**new**, Phase 2) | composed readable block (mapper) |
| — | `status` | always `'prospect'` |
| — | `acquiredVia` | `'Atlantic Canada BD list'` (batch tag) |

- **Notes block** (composed by the mapper, only non-empty parts):
  `Group: <g>` · `Verification: <v>` · `Co-op eligible: <c>` · `<original notes>`.
  (Co-op Eligible? is **empty in all 281 rows** today — the mapper still handles it
  for forward-safety.) Newline-joined.
- `status='prospect'` ⇒ **no QB push at import** (0084 is status-gated). This is the
  whole reason the bulk import is safe to run without touching prod QBO.

## D3 — Contact mapping (deduped by email)

- Up to 2 contacts per rooftop: **General Manager** (col `General Manager` + `Contact 1
  Email`) and **Sales Manager** (col `GSM/SM` + `Contact 2 Email`).
- `dealer_contacts` row per contact: `role='staff'`, `title='General Manager'` /
  `'Sales Manager'`, `source='atlantic-bd-import'`.
- **Dedup by email** (lower+trim) via 0085 `findExistingContactByIdentifier`: a person
  on multiple rooftops is **one** `contacts` row with multiple `dealer_contacts` links
  (15 emails recur; `cdarrach@rallyemotors.ca` on 4 Rallye rooftops). The email is the
  `contact_identifiers` row (`kind='email'`); **phone is never a contact identifier**
  (5 rooftop phones are shared — the active-unique index would reject them).
- **Name-only contacts (no email):** 6 GM + 4 SM rows have a name but no email. They
  get a `contacts` row with **no identifier**, deduped per **(dealer, role, title)** so a
  re-run reuses the existing link instead of inserting a twin (they can't be deduped by
  email and aren't shared across rooftops). Rows with neither name nor email → no contact.
- Counts (measured, after drops): **445 distinct emails** + up to **10 name-only
  contacts**. `intent.md`'s "≈447" was the pre-drop figure; the dry-run reports actuals.

## D4 — Idempotency keys (intent OQ "Idempotency key")

- **Dealer:** `lower(trim(name)) + lower(trim(coalesce(address,'')))` — exactly 0085
  `findExistingDealerByNameAddress`. Re-run ⇒ skip-existing-dealer.
- **Contact (email):** `lower(trim(email))` — 0085 `findExistingContactByIdentifier`.
- **Contact (name-only):** `(dealerId, role='staff', title)` link presence.
- **Link:** `dealer_contacts` unique `(dealerId, contactId, role)` +
  `onConflictDoNothing`. ⇒ a full re-run inserts **0** rows.

## D5 — In-sheet drop-list (explicit data, not heuristic)

**6 rows** dropped by `(name, city)` — see `scripts/data/atlantic-dealers.json`
`dropList`: Smith & Watt Limited (Barrington Passage), Hooked on Detailing
(Dartmouth), Grand Falls Hyundai (Grand Falls), Central Garage Limited (Atholville),
Cole Ford Sales (Liverpool), Nadeau Hyundai (Saint-Basile).

The **7th** removed row — the 2nd `Motor Hub Antigonish Mitsubishi / Antigonish`
occurrence — is **not** in the drop-list: it has the identical name+city as the first,
so the normal find-or-create dedup skips it (disposition `skip-existing-dealer`). This
reconciles "the ~6 flagged rows" with the 7-row reduction: **281 → 274 dealers.**

## D6 — City → address → **city only** (intent OQ "City → address")

Store the bare city in `dealers.address` (the sheet has no street data; province is its
own column). `"City, PROV"` rejected as redundant with the `province` column.

**Caveat surfaced for the Phase-6 prod gate:** the dealer dedup key is name+address. If
existing prod dealers carry *street* addresses, a city-only address won't match them, so
Layer-2 dedup (existing prod app dealers) may under-match. This is a fresh cold-outreach
list, so overlap is expected to be low — the **prod-overlap probe (D7)** quantifies it
before any prod write, and the owner confirms handling at the Phase-6 gate.

## D7 — Prod-overlap probe + handling (intent OQ "Prod-overlap handling")

- **Probe:** `scripts/atlantic-overlap-probe.mjs` — read-only. For the 281 rows it
  counts how many already exist as prod **app** dealers (name+address) and prod **QBO**
  Customers (DisplayName). **Writes nothing.** Run via `./scripts/with-prod-db.sh` (prod
  DB secret at runtime; `.env.prod.local` supplies `QBO_TOKEN_ENC_KEY` for the read-only
  QBO query).
- **Run timing:** the probe is a **prod read**, grouped with the owner-gated Phase-6
  prod window (run it immediately before the prod dry-run, so its counts reflect prod at
  write-time). It does **not** gate Phases 2–5 (those are sandbox/code-only).
- **Handling (default, owner to confirm at Phase 6):** app name+address match →
  **skip-with-report** (no clobber of an existing dealer); QBO-only match (DisplayName) →
  **leave the prospect unlinked** (a prospect doesn't push, so no `quickbooks_id` link is
  needed until it's activated). No backfill-on-import. The 0085 dedup helpers already
  implement skip-existing-dealer; "leave unlinked" is the no-op default for prospects.

## Out of scope (restated from intent non-goals)

No activation / QB push; no BD-workflow tracking in-app (dropped columns); no
dealer-roster UI for the 2nd contact; no fuzzy/AI dedup; no re-import of live BD state.
