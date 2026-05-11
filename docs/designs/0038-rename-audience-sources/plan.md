# Rename `sales_lead_sources` → `audience_sources`

**Started:** 2026-05-11

Rename the `sales_lead_sources` lookup table → `audience_sources` (and `campaigns.salesLeadSourceId` FK column → `audienceSourceId`) **before 0037 Phase 3 propagates the misleading name onto the new `quotes` table.** The lookup's only actual use today is **audience source for a dealer's marketing campaign** (seeded values `Dealer Database / PBS / Third Party List / Previous Buyers`); the legacy name carried two additional ghost meanings — (a) reserved-for-future per-`(campaign × contact)` target table per `docs/wiki/data-model.md` OQ #6, never built; (b) acquisition-source for dealerships, split off onto `dealers.acquiredVia` per the 2026-05-11 funnel review. Renaming now means `quotes.audienceSourceId` lands cleanly in 0037 P3 instead of inheriting three meanings.

**Done =** table + column + schema files + Server Actions + lookup admin UI are renamed; `data-model.md` OQ #6 "reserved-for" claim is pruned and the lookup section reads cleanly; 0037 P3 schema-patch checklist references `audienceSourceId`; tsc/lint/test/smoke all clean.

**Sequencing constraint.** Lands between 0036 (active) and 0037 Phase 3. Recommended order across the queue: `0036 → 0038 → 0037 P1+P2 → 0026 P2 → 0035 → 0037 P4`.

## Progress Tracker

| Phase | Status | Commit |
|-------|--------|--------|
| 1: Schema rename + Drizzle migration | Pending | - |
| 2: Sweep call sites (code) | Pending | - |
| 3: Wiki + cross-plan reconciliation | Pending | - |
| 4: Tests + smoke verification | Pending | - |

## Code Anchors

For each new file or method below, the builder reads the anchor first and matches its shape (length, error handling, naming, query style). For modifications to an existing file, the anchor is the nearest sibling method in that same file.

| New code | Anchor (`path:line`) | Why this anchor |
|----------|---------------------|-----------------|
| `src/lib/db/schema/audience-sources.ts` (renamed from `sales-lead-sources.ts`) | `src/lib/db/schema/sales-lead-sources.ts` | The file being renamed — preserve shape verbatim, only the exported const name + `pgTable` first-arg change. |
| Next sequential migration `drizzle/00XX_*.sql` (ALTER RENAME) | `drizzle/0006_is_staff_member_excludes_dealer.sql` | Most recent ALTER-shaped migration; same generate-then-edit flow via `pnpm db:generate`. **Verify** the generated SQL emits `ALTER TABLE ... RENAME` — not DROP+CREATE. Hand-edit if Drizzle picks the destructive path. |
| `src/lib/db/schema/campaigns.ts:14, 38-40, 65` (modify — rename import + FK column block + index name) | `src/lib/db/schema/campaigns.ts:38-40` | The existing `salesLeadSourceId` column declaration block; in-place rename matching the same shape. Index `campaigns_sales_lead_source_id_idx` → `campaigns_audience_source_id_idx`. |
| `src/features/schedule/actions.ts` (modify — `*SalesLeadSource` Server Actions → `*AudienceSource`) | existing `createSalesLeadSource` / `updateSalesLeadSource` / `archiveSalesLeadSource` | Same shape; function names + table imports + capability gate (`lookup:edit`) unchanged. |
| `src/features/schedule/lookup-admin.tsx` (modify — section heading + labels) | `src/features/schedule/lookup-admin.tsx` (existing "Sales Lead Sources" section) | Existing single-section admin precedent — only the user-facing label "Sales Lead Sources" → "Audience Sources" and any prop names change. |
| `docs/wiki/data-model.md` updates (line 14 STAR mapping, line 350 lookup section, OQ #6 prune) | `docs/wiki/data-model.md` | Three in-place edits to the same wiki page. |
| `docs/wiki/log.md` entry | most recent dated entry | Standard append-only log shape. |
| `docs/designs/0037-commercial-spine-msa/plan.md` Phase 3 checklist | line listing `salesLeadSourceId` in the `quotes` schema additions | One in-place rename in the plan doc. |

**Conventions referenced:**
- `docs/wiki/data-model.md` — lookup tables (`label`, `sort_order`, `archived_at`); skip the `actors` mixin (admin config, not domain data).
- `docs/wiki/conventions.md` — Drizzle migrations via session pooler.
- `db-conventions` skill — invoke before running the schema-rename migration.

**Overall Progress:** 0% (0/4 phases complete)

**Note:**
- **Zero data migration.** The `INSERT INTO sales_lead_sources` rows survive the `RENAME` intact — row contents unchanged.
- The seed migration `drizzle/0001_seed_lookups.sql` stays as historical record (one-time-only by convention). Don't backdate it.
- Drizzle table-rename detection: Drizzle Kit *usually* catches a schema-side `pgTable('audience_sources')` change as a rename when the column shape matches, but sometimes it emits DROP + CREATE instead. **Always verify** the generated SQL contains `ALTER TABLE ... RENAME TO` and `ALTER TABLE ... RENAME COLUMN` — if it emits a destructive pair, hand-edit the SQL into RENAME statements before applying (a destructive pair would drop the rows).

### Phase Checklist

#### Phase 1: Schema rename + Drizzle migration

- [ ] `git mv src/lib/db/schema/sales-lead-sources.ts src/lib/db/schema/audience-sources.ts`.
- [ ] In the moved file: rename exported const `salesLeadSources` → `audienceSources` and the `pgTable('sales_lead_sources', ...)` first-arg → `'audience_sources'`. Keep all column definitions identical.
- [ ] In `src/lib/db/schema/campaigns.ts`: rename the import line, the `salesLeadSourceId` column block, the `salesLeadSources` reference in `.references(() => ...)`, and the index name (`campaigns_sales_lead_source_id_idx` → `campaigns_audience_source_id_idx`). DB column name (`sales_lead_source_id` → `audience_source_id`) renames in the same migration.
- [ ] In `src/lib/db/schema/index.ts`: update the re-export to point at the renamed file/const.
- [ ] `pnpm db:generate`. **Verify** the generated `drizzle/00XX_*.sql` uses `ALTER TABLE ... RENAME TO` + `ALTER TABLE ... RENAME COLUMN` — not DROP + CREATE. If Drizzle picks the destructive path, hand-edit into RENAME statements.
- [ ] Apply migration via the session pooler (per `db-conventions`).
- [ ] Sanity-check via `psql`: `SELECT count(*) FROM audience_sources;` returns the pre-rename row count (4 in the dev DB); `SELECT count(*) FROM campaigns WHERE audience_source_id IS NOT NULL;` matches the pre-rename count.

#### Phase 2: Sweep call sites (code)

- [ ] `grep -rn 'salesLeadSource\|sales_lead_source\|SalesLeadSource' src/ scripts/` and walk every hit. **Active surfaces (rename):**
  - `src/features/schedule/actions.ts` — `createSalesLeadSource` / `updateSalesLeadSource` / `archiveSalesLeadSource` → `*AudienceSource` (capability gate `lookup:edit` unchanged).
  - `src/features/schedule/lookup-admin.tsx` — section heading "Sales Lead Sources" → "Audience Sources"; any prop names; any form field names.
  - `src/features/schedule/loaders.ts` (if it pre-loads the lookup) — rename the loader.
  - Test files: `src/features/schedule/*.test.ts` plus any mock fixtures that reference the table.
  - Reports surfaces: check `src/app/(app)/reports/page.tsx`, `src/app/(app)/reports/export/route.ts`, and `src/features/reports/**` for label refs. If a CSV column header or PDF heading carries the literal string "Sales Lead Source", rename it (see OQ #2 below for customer-facing-label decision).
- [ ] **Leave alone (historical):**
  - `drizzle/0001_seed_lookups.sql` (one-time seed; ran against the legacy table name).
  - `docs/designs/closed/**` (closed plans + eval reports — frozen-in-time records).
  - `docs/wiki/log.md` prior entries.
- [ ] `pnpm tsc --noEmit` — surfaces any missed import / type ref.

#### Phase 3: Wiki + cross-plan reconciliation

- [ ] Edit `docs/wiki/data-model.md` line 14 (STAR vocabulary mapping): rename the `sales_lead_sources` bullet to `audience_sources (lookup) — audience-source provenance for a dealer's marketing campaign (Dealer Database, PBS, Third Party List, Previous Buyers).` Drop the "preserved for the eventual per-campaign target table" parenthetical — that future table, if built, picks a fresh name.
- [ ] Edit `docs/wiki/data-model.md` line 350 (Lookup tables section): rename the bullet and tighten the meaning ("the source of the dealer's contact list used as the *consumer audience* of the campaign").
- [ ] Edit `docs/wiki/data-model.md` Open Question #6: prune the "reserved-for `sales_lead_sources` name" claim. Rewrite the future-target-table OQ as: *"Per-campaign target table (name TBD — e.g. `campaign_targets`, `sales_leads`): a row per (campaign × contact) for per-record outcomes. Not built today; picks a fresh name distinct from `audience_sources` if it lands."*
- [ ] Append to `docs/wiki/log.md`: "2026-MM-DD — 0038 shipped — `sales_lead_sources` lookup renamed to `audience_sources` (and `campaigns.audience_source_id` follows). Breaks a three-way naming overload; clears the path for `quotes.audienceSourceId` in 0037 P3."
- [ ] Edit `docs/designs/0037-commercial-spine-msa/plan.md` Phase 3 schema-patch checklist (currently lists `salesLeadSourceId` as a column to add to `quotes`): rename to `audienceSourceId` everywhere; add a one-line note pointing at 0038's rename.
- [ ] Edit `docs/designs/CURRENT.md`: when this plan ships, flip Active to the next queued chunk (likely 0037 if 0036 is also Done by then; otherwise resume whatever was active when this side-task started).

#### Phase 4: Tests + smoke verification

- [ ] `pnpm tsc --noEmit` clean.
- [ ] `pnpm lint` clean.
- [ ] `pnpm test` — existing lookup-admin action tests pass under the renamed names; no regressions in campaign-related tests.
- [ ] Smoke (web-test): `goto /admin/lookups`; section heading "Audience Sources" present (formerly "Sales Lead Sources"); section lists 4 rows: `Dealer Database`, `PBS`, `Third Party List`, `Previous Buyers`. (Section header text changed; row data unchanged.)
- [ ] Smoke (web-test): on the same page, the `Add` form for Audience Sources is reachable and shows the `Label` input. **Read-only check** — don't submit the form (no real Audience Source row added to dev DB).
- [ ] One-shot psql sanity: `SELECT label FROM audience_sources ORDER BY sort_order;` returns the 4 seeded rows in the original order.

## Open questions

- **#1 — Seed migration `drizzle/0001_seed_lookups.sql` touch-up?** That file's `INSERT INTO "sales_lead_sources"` statement reflects what existed at apply-time; the forward-only RENAME migration handles the schema transition. **Working assumption: leave the seed file as historical record** (don't backdate). Same convention the data-model wiki applies elsewhere — migrations are append-only.
- **#2 — Customer-facing label refs.** If any export (CSV column header, PDF heading) shows the literal string "Sales Lead Source" to dealers/customers, decide whether to rename it cleanly (better — no external systems consume our exports today) or alias at the surface (safer in a world with external integrations). **Working assumption: rename cleanly** — Phase 2's grep should surface every such occurrence.
- **#3 — Should the rename also rebadge the lookup admin's section ordering?** The lookup admin shows Campaign Styles and Sales Lead Sources side-by-side today. After the rename, the two section headers are "Campaign Styles" + "Audience Sources" — arguably "Audience Sources" should sort first since it describes *who* gets reached. **Working assumption: leave sort order unchanged** — that's a UX polish for a different chunk.
