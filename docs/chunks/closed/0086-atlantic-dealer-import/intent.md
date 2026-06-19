# Atlantic Canada dealer BD-list import — Intent

**Created:** 2026-06-19

## Problem

The owner has a cleaned business-development list — **281 dealer rooftops across
NS/NB/NL/PE** (`Atlantic_Canada_Dealer_BD_Tracker June 26 draft 5(73) (1).xlsx`,
3 sheets: Dashboard, Dealer Tracker, Read Me) — that needs to land in the app as
**prospect** dealers so the team can run outreach and, on conversion, push them to
QuickBooks. The list is a flat spreadsheet; the app's model is normalized
(`dealers` + `contacts` + `dealer_contacts`), and several spreadsheet columns have
no home in the schema. The import must not create duplicates — of each other, of
existing app dealers, or of existing prod QuickBooks Customers.

Three structural realities (measured from the sheet) shape the work:

- **Phones can't be contact identifiers.** The `contact_identifiers` active-unique
  index (`src/lib/db/schema/contact-identifiers.ts:32-34`) forbids two active
  contacts sharing a value, and **5 dealership numbers are shared across rooftops**
  (e.g. `800-572-5593` on 3 Rallye dealers; `506-872-5400` is both BMW *and* MINI
  Moncton). The phone is a **rooftop attribute**, not a person's.
- **The same person contacts multiple rooftops.** **15 emails appear on >1 row**
  (`cdarrach@rallyemotors.ca` on 4 Rallye rooftops); 464 contact-email cells →
  **447 distinct people**. The unique-email index forces these to one contact
  linked to many dealers — the `dealer_contacts` many-to-many join, deduped by
  email (exactly what 0085's `findExistingContactByIdentifier` does).
- **The sheet has its own dupes / non-dealers / closed rows** (~6) that must be
  dropped before insert.

## Desired outcome

A one-time, **idempotent + re-runnable** import that lands the cleaned list into
the app as **prospect** dealers with their contacts, deduped three ways, with every
spreadsheet column either mapped to a field or deliberately dropped — verified on
sandbox first, then run against prod.

- **Schema:** add nullable `dealers.notes`, `dealers.phone`, `dealers.manufacturer`.
- **Dealer mapping:** Dealership→`name`; City→`address`; Province→`province`;
  Phone(rooftop)→`phone`; Manufacturer→`manufacturer`; Group + Verification +
  Co-op Eligible + original Notes→a readable block in `notes`; `status='prospect'`;
  `acquiredVia='Atlantic Canada BD list'` (batch tag). Pure BD-workflow columns
  (Priority / Pipeline Stage / Owner / Last Contact / Next Action) are dropped.
- **Contact mapping:** up to 2 contacts per dealer (GM + GSM/SM) as `dealer_contacts`
  rows (`role='staff'`, `title='General Manager'`/`'Sales Manager'`), **deduped by
  email** so a person shared across rooftops is one contact with many dealer links.
- **Dedup (3 layers):** in-sheet (drop the flagged rows) · existing prod **app**
  dealers (name+address, 0085 `findExistingDealerByNameAddress`) · existing prod
  **QBO** Customers (DisplayName, 0085 `findCustomerByDisplayName`).
- **No QB writes at import** — prospects don't push (0084). To keep a *later*
  activation correct, `loadDealer` + the QBO push (`dealer-push.ts`) are wired to
  read `dealers.phone` so an activated prospect's Customer still gets a phone.

Observable end state: ~275 prospect dealers + ~447 contacts in the DB (sandbox,
then prod), no duplicates, every column accounted for, and a re-run is a no-op.

## Non-goals

- **No activation, no QB push.** Everything imports as `prospect`; QB happens later
  per dealer on conversion. Bulk-activation is explicitly out of scope.
- **No BD-workflow tracking in-app.** Priority / Pipeline / Owner / Next Action are
  the spreadsheet's job, not the app's — those columns are dropped, not modeled.
- **No dealer-centric "all contacts" roster UI.** The 2nd contact is captured in
  the data + People views but the dealer page still shows the primary (a known
  0085-flagged gap; a roster UI is a separate chunk if wanted).
- **No fuzzy/AI dedup.** Dedup is the deterministic 0085 keys (email, name+address,
  DisplayName) + the explicit in-sheet drop-list — not name-similarity guessing.
- **No re-import of the BD tracker's live state.** This ingests the cleaned list
  once; ongoing BD status stays in the spreadsheet.

## Success criteria

- Sandbox dry-run reports the expected counts (≈275 dealers after the ~6 drops,
  ≈447 distinct contacts) with a clear per-row disposition (insert / link-existing-
  contact / skip-existing-dealer / skip-flagged).
- A re-run against the same DB inserts **zero** new rows (idempotent).
- Each imported dealer is `status='prospect'`, carries `phone`/`manufacturer`/`notes`
  populated per the mapping, and `acquiredVia='Atlantic Canada BD list'`.
- A person on multiple rooftops is **one** `contacts` row with multiple
  `dealer_contacts` links; no duplicate-identifier errors.
- The prod-overlap probe (Phase 1) reports how many of the 281 already exist in
  prod app + prod QBO **before** any prod write.
- Static gate green (tsc + tests + 0 new lint); the import + mapper have unit tests;
  no QB write fires for a prospect.
- Prod run completes after the prod migration, with verified counts.

## Open questions

- **Source format.** Read the `.xlsx` at runtime (needs a node xlsx reader) or
  pre-convert it to a committed normalized data file (`scripts/data/…json`) that the
  import reads? The committed-file path is deterministic, reviewable in the diff,
  and avoids a runtime dep — likely preferred. Decide in Phase 1.
- **Idempotency key.** Dealer = `lower(name)+lower(address)`; contact = email
  (mirrors `import-from-sheets.ts`). Confirm that's sufficient given shared phones
  (yes — phone is no longer a contact identifier) and the in-sheet drop-list.
- **Prod-overlap handling.** If the probe finds existing prod dealers/customers,
  do we *link* (backfill `quickbooks_id` onto a matched dealer) or *skip*? Default:
  skip-with-report for app matches; for QBO-only matches, leave unlinked (a prospect
  doesn't push, so no link needed yet) — confirm after the probe.
- **City → address.** Store just the city in `dealers.address` (no street data in
  the sheet), or `"City, PROV"`? Province is already its own column. Lean: city only.

## Why now

The owner just deployed the QuickBooks dealer-push (0084) + create-time dedup guard
(0085) to prod, and has a freshly-cleaned 281-rooftop BD list ready to work. The
dedup infrastructure 0085 shipped is exactly what a safe bulk import needs, so
ingesting the list now — as prospects, before any QB activation — is the natural
next step to start outreach without polluting the app or the prod QBO mirror.
