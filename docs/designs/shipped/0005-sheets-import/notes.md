# Sheets → Postgres import — working notes — 2026-04-30

Phase 3 of the port migration (`docs/designs/0004-port-migration/plan.md`). This doc works through the mapping and auth decisions before writing `scripts/import-from-sheets.ts`. Schema source of truth: `docs/wiki/data-model.md`.

## Inventory: what's in the Sheet

Pulled live on 2026-04-30 via `GET /v4/spreadsheets/{id}` and `/values/{tab}`. Snapshot in `/tmp/sheets-import/*.json` (regenerate on demand; not committed).

| Tab | Data rows | Header? | Authoritative? | Notes |
|---|---|---|---|---|
| `Events` | 42 | No | Yes | Variable row width (12/16/20/21 cols) — 3 schema eras |
| `Clients` | 27 | No | Yes | Variable row width (2-6 cols); many rows are company-name-only |
| `Coaches` | 6 | No | Yes | One duplicate (Shannon Tilley × 2 IDs) |
| `Users` | 3 | Yes | Yes | Tiny; plaintext passwords; one generic `Production` user |
| `Upcoming_Sales_Events` | 41 | Yes | **No — derived view** of `Events` | Skip on import; regenerate from `campaigns` |
| `Sheet1` | 0 | — | — | Default empty tab; ignore |

### Events column legend (modern A-V schema)

Per `deprecated/index.html:776`:

| Idx | Col | Field | Idx | Col | Field |
|---|---|---|---|---|---|
| 0 | A | ID (`ev_*`) | 11 | L | Contact |
| 1 | B | Start Date | 12 | M | Phone |
| 2 | C | End Date | 13 | N | Email |
| 3 | D | Client ID (`c_*`) | 14 | O | Notes |
| 4 | E | Coach ID (`sc_*`) | 15 | P | Created At |
| 5 | F | Event Format | 16 | Q | Fee |
| 6 | G | Data Source | 17 | R | Deposit % |
| 7 | H | Qty Records | 18 | S | Tax % |
| 8 | I | SMS/Email | 19 | T | Quote Valid Days |
| 9 | J | Letters | 20 | U | Travel |
| 10 | K | BDC | 21 | V | Quote Notes |

### Schema-era handling

- **22-col rows (A-V)**: full modern schema → read all indices 0-21.
- **16-col rows (A-P)**: older — no fee/deposit/tax/quoteValid/travel/quoteNotes. Default those.
- **12-col rows (oldest)**: indices 0-5 (id, dates, FKs, format) are stable; index 11 is the timestamp; indices 6-10 have unclear meaning — **import as NULL** for everything past col F. Don't try to guess.
- **Index K (BDC) caveat**: in older rows this column sometimes contains a 26-char alphanumeric token (likely a legacy share/session ID), not a BDC count. Import script must `Number(...) || null`-guard.

### Clients column legend

Inferred from data:

| Idx | Field |
|---|---|
| 0 | ID (`c_*`) |
| 1 | Company name |
| 2 | Contact name |
| 3 | Phone |
| 4 | Email |
| 5 | Address |

Many rows are short — e.g. 2-col rows are `[id, name]` only.

### Coaches column legend

| Idx | Field |
|---|---|
| 0 | ID (`sc_*`) |
| 1 | First name |
| 2 | Last name |
| 3 | Email |
| 4 | Phone |

### Users column legend

Has a header row: `Username, Password, Role, Display Name, CoachID`. Plaintext passwords. The `CoachID` column links to a `Coaches.id` if the user is a coach.

## Open decisions

### 1. Google auth path — RESOLVED: reuse legacy API_KEY

The legacy app already uses a Google Sheets API key against the public sheet (`deprecated/index.html:610`, calls like `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${range}?key=${API_KEY}`). The sheet must already be shared "anyone with the link can view" for that to work.

We reuse the same `API_KEY` from the legacy file for the import script — zero new provisioning, no service-account JSON to manage. Phase 7 already plans to rotate this key after cutover, so the exposure window doesn't change.

Action: copy `API_KEY` and `SPREADSHEET_ID` out of `deprecated/index.html` into `.env.local` as `GOOGLE_SHEETS_API_KEY` and `GOOGLE_SHEETS_SPREADSHEET_ID`. The script reads from env, not from the legacy file.

### 2. Legacy `Users` → `contacts` + `team_member_roles`

Three legacy users total:
- `Shannon / sales2026 / admin / Shannon Tilley` (no CoachID)
- `Scott / Sales2026 / Admin / Scott Grady` (no CoachID)
- `Production  / Sales2026 / Admin / Production ` (generic, not a person)

Resolution proposal: skip the `Users` tab. The `Coaches` tab already covers Shannon and Scott as people. The `Production` user is a generic admin login, not a person — drop it. Real users get `contacts` + `team_member_roles` rows when they sign in via Supabase auth (magic link or Google OAuth).

Plaintext passwords are dropped — Supabase auth replaces password login entirely.

### 3. Legacy `Clients` → `dealers` + `contacts` + `dealer_contacts`

Legacy schema flattened the company and the primary contact into one row. New schema splits them:
- `dealers` — the company (name, address)
- `contacts` — the person (name, email, phone)
- `dealer_contacts` — link table with role

**Dedup keys (decided after inspecting data):**
- `dealers`: dedup on `(lower(trim(company_name)), lower(trim(address)))` where address is non-empty; fall back to `lower(trim(company_name))` alone if address is empty. Rationale: only conflict in the data is `abc motors` vs `ABC Motors`, same address — case-insensitive name+address handles it.
- `contacts`: dedup on `lower(trim(email))` when email present; fall back to `(lower(name), lower(phone))` when email missing. Phone-only Clients (like `Century Hyundai Saint John`'s "Tammy") get a contact with null email.

**Empty-contact Clients** (`Charlottetown Mitsubishi`, `Century Subaru`): import the `dealers` row with no `contacts` and no `dealer_contacts` link. These are leads with no captured contact yet.

**Role on `dealer_contacts`**: legacy schema is single-contact, so role = "primary" for the imported link.

**Legacy ID preservation**: keep a `legacy_id` column (or use a side table `legacy_id_map`) so we can resolve `Events.client_id` (`c_*`) and `Events.coach_id` (`sc_*`) FKs during the campaigns import without a second name-match pass. Cleaner than name-matching and survives renames.

### 4. Legacy `Events` → `campaigns`

Modern A-V columns and schema-era handling are documented in the inventory section above. Preserve `fee`, `deposit_pct`, `tax_pct`, `quote_valid_days`, `travel`, `quote_notes` verbatim where present (only the 3 newest events have them).

**FK resolution** (closed):
- `Events.client_id` (`c_*`) → resolve via `legacy_id_map` from the dealers/contacts import; the `c_*` ID maps to a `dealers.id` UUID.
- `Events.coach_id` (`sc_*`) → resolve via `legacy_id_map`; the `sc_*` ID maps to a `contacts.id` UUID. The duplicate Shannon coach (`sc_1775000952787` → 1 event, `sc_1775042161676` → 11 events) gets merged into one `contacts` row keyed on email, and **both** legacy IDs map to the same UUID. The 11-event ID's `created_at` and metadata wins as canonical.
- `Events.contact/phone/email` (cols L/M/N) → these are per-event override fields the legacy app uses for the on-site contact, not the dealer's primary contact. Map to columns on `campaigns` directly (e.g. `onsite_contact_name`, `onsite_contact_phone`, `onsite_contact_email`) rather than creating new `contacts` rows. Open: confirm `docs/wiki/data-model.md` has those columns or add them.

**Channel-column type mismatch (resolved 2026-04-30)**: legacy stores `sms_email`, `letters`, `bdc` as numeric counts. The schema was changed from `boolean NOT NULL DEFAULT false` to nullable `integer` so we preserve the counts on import. Migration `0000_*.sql` regenerated; `docs/wiki/data-model.md` open Q #5 closed.

**Lookup-table resolution**:
- `Event Format` (col F, e.g. "VIP Sales Event") → `campaign_styles.id` via name match. Distinct values in the data: TBD (run a script).
- `Data Source` (col G, e.g. "Third Party List", "Dealer Database") → `sales_lead_sources.id` via name match. Distinct values: TBD.
- Both lookup tables must be seeded with these distinct values before the campaigns import runs (Phase 3 prereq seed migration).

**Distinct values found in the data (2026-04-30 snapshot):**
- `campaign_styles`: `VIP Sales Event` (40 events). Seed migration should also include any other styles tracked in the legacy `localStorage` lists if present.
- `sales_lead_sources`: `Dealer Database` (6), `PBS` (5), `Third Party List` (1), `Previous Buyers` (1). The 4 numeric values (`750`, `1000`, `1500`, `1200`) in col G of 12-col rows are not lead sources — per era-handling rule, those rows import as NULL past col F.

### 5. Coaches

5 distinct coaches (after deduping Shannon Tilley): Shannon Tilley, Scott Grady, Adam Godin, Brian Jesse, Steve Murphy. Maps to `contacts` + `team_member_roles` with role = "coach".

`Users` overlap: Shannon and Scott are both in `Users` and `Coaches`. Per decision 2 we ignore `Users` entirely; Coaches is the source of truth for team-member identities.

## Import script shape

Per `db-conventions` §Backfills: TS script, idempotent, restartable.

Sketch:
```
scripts/import-from-sheets.ts
  ├── auth: load service account creds from env
  ├── fetch each tab as rows
  ├── for each tab, run an upsert pass keyed on a stable natural key
  └── log summary: rows read / inserted / updated / skipped
```

Run order matters because of FKs:
1. Lookup seeds (already done as a migration before this script runs)
2. `dealers`
3. `contacts`
4. `dealer_contacts` and `team_member_roles`
5. `campaigns` (depends on dealers + lookup tables)
6. `vehicles` / `vehicle_ownerships` if those exist in the Sheet

## Cutover steps

- [ ] Apply schema migration + seed lookups (Phase 3 prereqs in tracker)
- [ ] Dry-run script against a staging Supabase schema; eyeball row counts
- [ ] Run against prod Supabase project
- [ ] Set Sheets to view-only (Phase 5 actually flips DNS; this just freezes writes early)

## Resolved

- **Google auth (1)**: reuse legacy `API_KEY` against the public sheet; rotate in Phase 7.
- **Users mapping (2)**: skip the `Users` tab entirely; identities come from `Coaches` and from Supabase auth re-onboarding.
- **Clients dedup (3)**: dealer key = `(lower(name), lower(address))`; contact key = email (fallback `(name, phone)`). Empty-contact clients import as dealers-only. Preserve legacy IDs in a `legacy_id_map`.
- **Events FKs (4)**: resolve via `legacy_id_map`. Merge duplicate Shannon coach into one contact, both legacy IDs map to the same UUID. Per-event L/M/N contact fields go on `campaigns`, not into `contacts`.
- **Coaches dedup (5)**: 5 distinct people after merging Shannon's two IDs.
