# Sheets → Postgres import — 2026-04-30

Phase 3 of the port migration (`docs/designs/0004-port-migration/plan.md`). One-time import of legacy Google Sheets data into the new Drizzle/Supabase schema. Companion notes (`notes.md`) hold the inventory, conflict findings, and resolved design decisions; this plan tracks implementation. Done = `dealers`, `contacts`, `dealer_contacts`, `team_member_roles`, and `campaigns` are populated from the legacy Sheets and the script is re-runnable without producing duplicates.

## Code Anchors

For each new file or method below, the builder reads the anchor first and matches its shape (length, error handling, naming, query style).

| New code | Anchor (`path:line`) | Why this anchor |
|----------|---------------------|-----------------|
| `scripts/import-from-sheets.ts` (script entrypoint + db client) | `src/lib/db/index.ts:1-7` | Same `postgres` + `drizzle(client, { schema })` setup. Script reuses the same `db` import so connection options and schema bindings stay consistent. |
| `drizzle/0001_seed_lookups.sql` (idempotent seed migration) | `drizzle/0000_ambiguous_mister_fear.sql` | drizzle-kit dialect / `--> statement-breakpoint` separators. Hand-written per `db-conventions` §Backfills. |
| Coaches/Clients/Events fetch helper inside the script | `deprecated/index.html:787` (`sheetRead`) | Same `https://sheets.googleapis.com/v4/spreadsheets/${id}/values/${range}?key=${apiKey}` shape; we read the public sheet exactly as the legacy app does. |

**Conventions referenced:**
- `docs/wiki/data-model.md` — table shapes for `dealers`, `contacts`, `dealer_contacts`, `team_member_roles`, `campaigns`; reservation of `sales_leads` as a future per-record table.
- `db-conventions` skill — TS-script backfill pattern (`scripts/import-from-sheets.ts`, idempotent, restartable); `INSERT … ON CONFLICT DO NOTHING` for lookup seeds; direct port-5432 `DATABASE_URL` for `db:migrate`.
- `docs/designs/closed/0005-sheets-import/notes.md` §Resolved — auth path, dedup keys, FK resolution strategy, channel-column boolean cast, schema-era handling for variable Events row widths.

## Progress Tracker

| Phase | Status | Commit |
|-------|--------|--------|
| 1: Apply schema migration to Supabase | Done | `551ef5b` (schema), runtime apply |
| 2: Seed lookup tables (`campaign_styles`, `sales_lead_sources`) | Done | `bff71fe` |
| 3: Import script — Coaches → `contacts` + `team_member_roles` | Done | `bff71fe` |
| 4: Import script — Clients → `dealers` + `contacts` + `dealer_contacts` | Done | `bff71fe` |
| 5: Import script — Events → `campaigns` | Done | `bff71fe` |
| 6: Dry-run, verification, idempotency check | Done | (state-only) |

**Overall Progress:** 100% (6/6 phases complete)

**Note:**
- Phases 1 + 2 are runtime prereqs; once they ship the schema and lookups exist in Supabase and the rest of the script can run.
- The script is one file (`scripts/import-from-sheets.ts`) developed across phases 3-5. Each phase adds one importer function and the entrypoint runs them in FK order: lookups (already seeded) → coaches/contacts → dealers/contacts → campaigns.
- Idempotency: the script rebuilds the in-memory `legacy_id → new_id` map on every run by reading current DB state first. Re-running after a successful import should be a no-op (zero inserts).
- Per `notes.md`, no `legacy_id` columns are added to domain tables — the map is in-memory only during the script run.

### Phase Checklist

#### Phase 1: Apply schema migration to Supabase — Done
- [x] `DATABASE_URL` in `.env.local` set to the **session pooler** (`aws-1-us-west-2.pooler.supabase.com:5432`) — direct connection is IPv6-only on free tier and unreachable from this network. `db-conventions` advice on "direct port-5432" is stale for free-tier projects.
- [x] `pnpm db:migrate` applied cleanly (auth-schema gotcha already stripped in `0000_cute_ser_duncan.sql`).
- [x] Verified 11 public tables + 5 enums via `information_schema` query: `availability_blocks, campaign_styles, campaigns, contact_identifiers, contacts, dealer_contacts, dealers, sales_lead_sources, team_member_roles, vehicle_ownerships, vehicles`; enums `availability_block_kind, campaign_status, contact_identifier_kind, dealer_contact_role, team_member_role`.
- [x] Schema-defined FKs include `campaigns.dealer_id → dealers.id`, `campaigns.coach_id → contacts.id`, `dealer_contacts.dealer_id → dealers.id` (per Drizzle schema files, applied as DDL).

#### Phase 2: Seed lookup tables — Done
- [x] Generated `drizzle/0001_seed_lookups.sql` via `pnpm drizzle-kit generate --custom --name=seed_lookups`
- [x] Hand-wrote `ON CONFLICT (label) DO NOTHING` inserts for `campaign_styles` (1 row) and `sales_lead_sources` (4 rows)
- [x] Applied via `pnpm db:migrate`
- [x] Verified: `campaign_styles` = `VIP Sales Event`; `sales_lead_sources` = `Dealer Database`, `PBS`, `Third Party List`, `Previous Buyers`

#### Phase 3: Import script — Coaches → `contacts` + `team_member_roles` — Done
- [x] Created `scripts/import-from-sheets.ts` with `postgres` + `drizzle` setup mirroring `src/lib/db/index.ts` and a `fetchTab(name)` helper
- [x] Reads `Coaches`; normalizes to `{ legacyId, firstName, lastName, email, phone }`
- [x] Dedups on `lower(trim(email))`; both Shannon legacy IDs (`sc_1775000952787` + `sc_1775042161676`) collapse to one canonical row
- [x] Inserts into `contacts` (uses `contact_identifiers` for email-key dedup on re-run; falls back to (firstName,lastName) join with `team_member_roles(role='coach')` for emailless coaches like Steve Murphy)
- [x] Inserts `contact_identifiers` (kind='email'/'phone', `is_primary=true`, `source='sheets-import'`)
- [x] Inserts `team_member_roles(role='coach')` with `ON CONFLICT DO NOTHING`
- [x] Builds `legacyCoachIdToContactId: Map<string, number>` — both Shannon IDs → contact 1
- [x] Re-run idempotency verified: 6 sheet rows → 5 unique → 0 inserts on re-run, 5 reused
- [x] DB state confirmed: 5 contacts, 5 `team_member_roles(coach)`, 7 `contact_identifiers` (4 emails + 3 phones; Scott no phone, Steve no identifiers)

#### Phase 4: Import script — Clients → `dealers` + `contacts` + `dealer_contacts` — Done
- [x] Reads `Clients`; normalizes variable-length rows (2-6 cols) to `{ legacyId, companyName, contactName, phone, email, address }`
- [x] `dealers` dedup via SQL `lower(name)` + `lower(coalesce(address, ''))`; `abc motors` / `ABC Motors` collapses
- [x] `dealers.public_id` generated as 12-char URL-safe slug via `crypto.randomBytes(9).toString('base64url')` (no nanoid dep)
- [x] Contact dedup chain: email identifier → phone identifier → dealer-scoped customer link (the third was the idempotency fix for name-only contacts that have neither email nor phone — without it, re-runs created duplicate contacts since the dealer-contact unique constraint is `(dealer_id, contact_id, role)`)
- [x] `dealer_contacts` inserted with `role='customer'`, `source='sheets-import'`, `ON CONFLICT DO NOTHING`
- [x] 2 empty-contact rows (`Charlottetown Mitsubishi`, `Century Subaru`) imported as dealer-only, no contact link
- [x] Built `legacyClientIdToDealerId: Map<string, number>` (27 entries)
- [x] Idempotency verified after the dedup-fix: re-run produces 0 new contacts, 0 new dealer_contacts (steady state: 26 dealers, 28 contacts, 24 dealer_contacts)

#### Phase 5: Import script — Events → `campaigns` — Done
- [x] Reads `Events`; `parseEventRow` branches on `r.length < 16` for ancient-schema handling (cols 6-10 → null, timestamp at idx 11 instead of 15)
- [x] FK resolution via the two in-memory maps from phases 3-4; both Shannon legacy IDs collapse to contact 1
- [x] `style_id` resolved via `campaign_styles.label` lookup; 2 rows with empty col F → null
- [x] `sales_lead_source_id` resolved via `sales_lead_sources.label`; 4 numeric tokens in 12-col rows → null per parseEventRow
- [x] Onsite cols L/M/N/O → `campaigns.contact/phone/email/notes`
- [x] Channel cols `sms_email/letters/bdc` preserved as nullable integers (e.g. `300`, `2000`, `1200`)
- [x] Quote fields Q-V preserved verbatim where present (1 row with `fee=8000, travel=750`); rows without quote fields fall to schema defaults
- [x] `public_id = legacy ev_* ID` for stable idempotency without an extra dedup column
- [x] Insert via `onConflictDoNothing({ target: campaigns.publicId })`; second run inserts 0
- [x] All 42 events imported

#### Phase 6: Dry-run, verification, idempotency check — Done
- [x] Run summary: 5 unique contacts, 26 dealers, 42 campaigns; 24 dealer_contacts; 33 contact_identifiers
- [x] FK integrity: 0 orphan dealer FKs, 0 orphan coach FKs
- [x] Spot-checked one row per schema era end-to-end (ancient/A-P/A-V) — all data round-trips correctly
- [x] Shannon merge verified: 12 campaigns assigned to contact_id=1 (1 from `sc_1775000952787` + 11 from `sc_1775042161676`)
- [x] Idempotency: re-run inserts 0 across all tables, counts unchanged
- [x] `docs/wiki/log.md` entry added
