# Rename `sales_lead_sources` → `audience_sources`

**Started:** 2026-05-11

Rename the `sales_lead_sources` lookup table → `audience_sources` (and `campaigns.salesLeadSourceId` FK column → `audienceSourceId`) **before 0037 Phase 3 propagates the misleading name onto the new `quotes` table.** The lookup's only actual use today is **audience source for a dealer's marketing campaign** (seeded values `Dealer Database / PBS / Third Party List / Previous Buyers`); the legacy name carried two additional ghost meanings — (a) reserved-for-future per-`(campaign × contact)` target table per `docs/wiki/data-model.md` OQ #6, never built; (b) acquisition-source for dealerships, split off onto `dealers.acquiredVia` per the 2026-05-11 funnel review. Renaming now means `quotes.audienceSourceId` lands cleanly in 0037 P3 instead of inheriting three meanings.

**Done =** table + column + schema files + Server Actions + lookup admin UI are renamed; `data-model.md` OQ #6 "reserved-for" claim is pruned and the lookup section reads cleanly; 0037 P3 schema-patch checklist references `audienceSourceId`; tsc/lint/test/smoke all clean.

**Sequencing constraint.** Lands between 0036 (active) and 0037 Phase 3. Recommended order across the queue: `0036 → 0038 → 0037 P1+P2 → 0026 P2 → 0035 → 0037 P4`.

## Progress Tracker

| Phase | Status | Commit |
|-------|--------|--------|
| 1: Schema rename + Drizzle migration | Done | `1b64d12` |
| 2: Sweep call sites (code) | Done | `1b64d12` |
| 3: Wiki + cross-plan reconciliation | Done | `31f0ca2` |
| 4: Tests + smoke verification | Done | `31f0ca2` |

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

**Overall Progress:** 100% (4/4 phases complete) ✅

**Note:**
- **Zero data migration.** The `INSERT INTO sales_lead_sources` rows survive the `RENAME` intact — row contents unchanged.
- The seed migration `drizzle/0001_seed_lookups.sql` stays as historical record (one-time-only by convention). Don't backdate it.
- Drizzle table-rename detection: Drizzle Kit *usually* catches a schema-side `pgTable('audience_sources')` change as a rename when the column shape matches, but sometimes it emits DROP + CREATE instead. **Always verify** the generated SQL contains `ALTER TABLE ... RENAME TO` and `ALTER TABLE ... RENAME COLUMN` — if it emits a destructive pair, hand-edit the SQL into RENAME statements before applying (a destructive pair would drop the rows).

### Phase Checklist

#### Phase 1: Schema rename + Drizzle migration

- [x] `git mv src/lib/db/schema/sales-lead-sources.ts src/lib/db/schema/audience-sources.ts`.
- [x] In the moved file: rename exported const `salesLeadSources` → `audienceSources` and the `pgTable('sales_lead_sources', ...)` first-arg → `'audience_sources'`. Keep all column definitions identical.
- [x] In `src/lib/db/schema/campaigns.ts`: rename the import line, the `salesLeadSourceId` column block, the `salesLeadSources` reference in `.references(() => ...)`, and the index name (`campaigns_sales_lead_source_id_idx` → `campaigns_audience_source_id_idx`). DB column name (`sales_lead_source_id` → `audience_source_id`) renames in the same migration.
- [x] In `src/lib/db/schema/index.ts`: update the re-export to point at the renamed file/const. (Also re-sorted alphabetically — `audience-sources` belongs above `audit-log`.)
- [x] ~~`pnpm db:generate`~~ — **TTY-blocked in this harness** (drizzle-kit's rename-vs-drop prompt needs interactive TTY). Used `pnpm drizzle-kit generate --custom` to scaffold blank `0007_thin_thor.sql` + `0007_snapshot.json`, then hand-wrote the RENAME SQL and patched the snapshot via `sed 's/sales_lead_source/audience_source/g'` (14 occurrences, semantic-key-only — no false positives since the snake_case token is unambiguous). Final SQL covers table, sequence, unique constraint, column, FK constraint, and index — each renamed explicitly because Postgres doesn't cascade name updates from `ALTER TABLE ... RENAME TO`.
- [x] Apply migration via the session pooler (per `db-conventions`). First run was a silent no-op because the `--custom`-generated journal entry's `when` (`1778521038769`) was earlier than `0006`'s; bumped to `1778677200000` and re-ran successfully.
- [x] Sanity-check via `psql`: `audience_sources` has 4 rows (matches pre-rename); 13 campaigns retain `audience_source_id` IS NOT NULL; labels in order `Dealer Database / PBS / Third Party List / Previous Buyers`.

#### Phase 2: Sweep call sites (code)

- [x] `grep -rn 'salesLeadSource\|sales_lead_source\|SalesLeadSource' src/ scripts/ tests/` — surfaced **20 files**. Applied via `sed -i -e 's/salesLeadSource/audienceSource/g' -e 's/SalesLeadSource/AudienceSource/g' -e 's/sales_lead_source/audience_source/g'` across all 20 (patterns unambiguous; zero overlap). **Active surfaces (renamed):**
  - `src/features/schedule/actions.ts` — `createSalesLeadSource` / `updateSalesLeadSource` / `archiveSalesLeadSource` → `*AudienceSource` (capability gate `lookup:edit` unchanged).
  - `src/features/schedule/queries.ts` — table import, `loadSalesLeadSources` → `loadAudienceSources`, plus `salesLeadSourceId` / `salesLeadSourceLabel` on returned-row types and join projections.
  - `src/features/schedule/validators.ts` + `validators.test.ts` — form-parse helper key + fixtures.
  - `src/features/schedule/lookup-admin.tsx` — action imports + config entries. **Note:** the user-facing heading was already `Data Sources` (line 44), not "Sales Lead Sources" as this plan assumed. Left "Data Sources" unchanged — it's a UI naming decision separate from the schema rename. Open follow-up: if "Audience Sources" becomes the canonical UX name, file a separate UX-polish chunk.
  - `src/features/__tests__/action-gate-matrix.ts` — capability-pairing matrix labels + invoke refs.
  - `src/features/email/actions.ts` + `actions.test.ts` — `salesLeadSourceLabel` on template props/fixtures.
  - `src/features/reports/reports-columns.tsx` — column id + accessorFn.
  - `src/lib/email/templates.ts` — template type field (rendered label "Data Source:" stays — that's the email's text, not the internal name).
  - `src/app/(app)/calendar/booking-form.tsx` — form input `name="salesLeadSourceId"` → `name="audienceSourceId"` + defaultValue accessor.
  - `src/app/(app)/calendar/page.tsx`, `production/page.tsx`, `admin/lookups/page.tsx` — `loadSalesLeadSources` import + invocation.
  - `src/app/(app)/calendar/event-detail.tsx`, `production/page.tsx` — `salesLeadSourceLabel` row renders.
  - `src/app/(app)/production/export/route.ts`, `reports/export/route.ts`, `reports/export/route.test.ts` — CSV exporter `salesLeadSourceLabel` reads.
  - `scripts/import-from-sheets.ts` — table import, query reads, local var (`scripts/` was not in the plan's original anchor list; added as new row, see anchors table above).
  - `tests/integration/rls.test.ts` — `RLS_TABLES` literal `'sales_lead_sources'` → `'audience_sources'` (also not enumerated in the plan; the Phase 1 eval surfaced it).
- [x] **Leave alone (historical):**
  - `drizzle/0001_seed_lookups.sql` (one-time seed; ran against the legacy table name).
  - `docs/designs/closed/**` (closed plans + eval reports — frozen-in-time records).
  - `docs/wiki/log.md` prior entries.
- [x] `pnpm tsc --noEmit` — clean. `pnpm test` — 480/481 (1 pre-existing skip, no regressions).

#### Phase 3: Wiki + cross-plan reconciliation

- [x] Edit `docs/wiki/data-model.md` line 14 (STAR vocabulary mapping): rewritten to `audience_sources (lookup) — audience-source provenance ...`; the "preserved-for-future-target-table" parenthetical dropped. Also removed the (now obsolete) trailing claim that schema source files hadn't been renamed yet (0038 did that).
- [x] Edit `docs/wiki/data-model.md` line ~348 (Lookup tables section): renamed `sales_lead_sources` → `audience_sources`; tightened meaning to "the source of the dealer's contact list used as the *consumer audience* of a campaign".
- [x] Edit `docs/wiki/data-model.md` Open Question #6: rewrote to mention the future per-campaign target table picks a fresh name distinct from `audience_sources`; old "reserved-for `sales_lead_sources` name" claim removed.
- [x] Also-mechanical: 10 snake_case `sales_lead_source` occurrences (mixins table, ASCII diagram, campaigns row in table-by-table list, relationships bullet, campaigns narrative, audit-columns mixin note) renamed via `sed`. Two sed false-positives in historical references (lines 15 + 348 said "Renamed from `audience_sources`") fixed back to `sales_lead_sources` so the historical record reads correctly.
- [x] Append to `docs/wiki/log.md` with a `2026-05-11` dated entry above the existing 2026-05-11 entries: full headline + why + scope + commit ref + carry-forward.
- [x] Edit `docs/designs/0037-commercial-spine-msa/plan.md` Phase 3 schema-patch checklist (and OQ #7): renamed all `salesLeadSourceId` → `audienceSourceId` and `sales_lead_sources` → `audience_sources` via `sed`. Fixed the historical-context sentence in OQ #7 to read "the lookup (then named `sales_lead_sources`, renamed to `audience_sources` in 0038)" so the funnel-review narrative stays accurate.
- [x] Edit `docs/designs/closed/0035-quote-composer/plan.md` line 74: updated the `acquired_via` distinct-from reference to `audience_sources` (with the renamed-from-`sales_lead_sources` note).
- [x] Edit `docs/designs/CURRENT.md` line 6 (forward-looking 0037 description): `salesLeadSourceId` → `audienceSourceId` in the list of commercial columns moving off campaigns. History entries left as-is (they describe past state, where the old name was canonical).
- [ ] **Deferred to a separate close-the-chunk step (per CLAUDE.md):** move `docs/designs/closed/0038-rename-audience-sources/` → `docs/designs/closed/0038-rename-audience-sources/`, sweep cross-refs to add `closed/` to the path, flip CURRENT.md Active to 0037 + add a History entry.

#### Phase 4: Tests + smoke verification

- [x] `pnpm tsc --noEmit` clean (verified at end of Phase 2 and again after Phase 3 doc edits).
- [x] `pnpm lint` clean (4 pre-existing warnings carried forward, 0 errors).
- [x] `pnpm test` — 480/481 (1 pre-existing skip). RLS integration test now passes against the renamed table.
- [x] Smoke (web-test): `/admin/lookups` renders the Data Sources section with all 4 seeded rows; `/calendar` + `/production` render cleanly. The renamed `loadAudienceSources` query and the `audienceSourceLabel` join projection both verified working. Screenshot at `/tmp/web-test-0038-lookups.png`. (User-facing label "Data Sources" left as-is — pre-existing UI naming, separate UX decision.)
- [x] Smoke (web-test): `/admin/lookups` Add-form for the lookup is reachable. **Read-only check** — form not submitted.
- [x] One-shot psql: `SELECT label FROM audience_sources ORDER BY sort_order;` returned the 4 seeded rows in original order (verified end of Phase 1).

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
