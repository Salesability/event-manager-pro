# Flatten service-item units → flat unit_price — Plan

**Intent:** [`intent.md`](intent.md)
**Started:** 2026-06-05

## Progress Tracker

| Phase | Status | Commit |
|-------|--------|--------|
| 1: Backfill + schema migration (db-conventions) | Done | `6f4057c` |
| 2: Schema + query layer | Done | `6f4057c` |
| 3: Admin form + validation | Done | `6f4057c` |
| 4: Tests + wiki + smoke | In Progress | - |

This chunk collapses the now-vestigial `service_items` pricing model (`unit` enum +
`unit_price_min`/`unit_price_max`) down to a flat `unit_price`, which is the only catalog field the
post-0053/0062 composer actually reads. "Done" = the columns + enum are gone, the one `range` row
(`record-retrieval`) is backfilled so it no longer seeds $0, the admin form is simplified, all tests
are green, and the wiki + stale schema comment reflect the flat shape. Quote behavior is unchanged;
existing quotes are untouched (they snapshot into `quote_line_items`).

## Code Anchors

| New code | Anchor (`path:line`) | Why this anchor |
|----------|---------------------|-----------------|
| New migration: backfill `UPDATE` + `ALTER TABLE … DROP COLUMN` ×3 + `DROP TYPE service_item_unit` | `drizzle/0024_quote_line_items_table.sql` | Most recent `service_items`-adjacent schema migration; same SQL-file + journal pattern. Drop-column/drop-type shape per the `db-conventions` skill. |
| `service-items.ts` trimmed to `{ code, label, unit_price, description, …archivable }` + fixed header comment | `src/lib/db/schema/tax-rates.ts` | Sibling lookup table, simple numeric + archivable columns, no enum — the target shape. |
| `service-schema.ts` minus `unit`/min/max + range refinement | `src/features/services/service-schema.ts:50` (current `label`/`moneyField` shape) | Refactor-in-place: keep the surviving fields' exact validation idiom, delete the rest. |
| `services-admin.tsx` form minus unit picker + conditional min/max | `src/features/services/services-admin.tsx` (current form, the "before") | Refactor-in-place; remove the `unit`-conditional block, keep label/code/price/description inputs. |

**Conventions referenced:**
- `db-conventions` skill — **MUST** be invoked before writing the migration (drop-column + drop-enum
  pattern, direct/session-pooler 5432 for DDL, rollback/backfill patterns).
- `docs/wiki/data-model.md` — `service_items` row shape; update to the flat `{code,label,unit_price,description}`.
- `docs/wiki/commercial-spine.md` — catalog → quote_line_items flow; note the composer reads only `unit_price`.
- ⚠️ Drizzle journal `when` gotcha ([[project-drizzle-journal-when-gotcha]]) — after generating the
  migration, verify the new journal `when` > the previous entry's, or it silently never applies.

**Overall Progress:** 75% (3/4 phases complete)

**Note:**
- Each phase includes both implementation and tests.
- Migration applies to **sandbox** DB this chunk; **prod** apply is a deploy-time step (record it, don't auto-run prod).

**Execution notes (2026-06-08):**
- **Phases 1–3 shipped as one atomic commit (`6f4057c`).** They're a single tsc-compile unit: the
  schema column `unit` is `.notNull()`, so inserts must supply it until it's dropped, while every
  select/read breaks the moment it's dropped — there's no intermediate green state. Splitting into
  separate phase-commits would have required a non-compiling intermediate. Phase 4 (docs + smoke)
  stays separate (no compile impact).
- **Migration built via `db:generate` (not `--custom`)** so the drizzle snapshot stays honest (a
  `--custom` hand-write would leave `0030_snapshot.json` still showing the dropped columns → the
  next `db:generate` would re-emit the drops). The generated DDL was hand-annotated with the leading
  backfill UPDATE, exactly mirroring the `0024`/`0025` precedent.
- **Deviation from Phase 3 "always-required price":** kept `unit_price` **optional** (blank = null =
  "variable"). The seeded `travel` row relies on a NULL price (coach types the amount), the form
  field is literally labelled "Unit $ (blank = variable)", and no success criterion mandates a price.
  Making it required would regress `travel`. Trivially flippable to required later (`moneyField` →
  required + `.min(1)`) if the owner wants every catalog row to carry a price.

### Phase Checklist

#### Phase 1: Backfill + schema migration (db-conventions)
- [x] Invoke the `db-conventions` skill before writing any migration.
- [x] **Decision (2026-06-08, owner-confirmed): backfill `record-retrieval.unit_price = 100.00`** —
      the menu floor. Seed-then-editable, so coaches bump it up per quote; an editable seed should
      err low rather than silently over-quote.
- [x] Generate the migration (`drizzle/0030_flatten_service_item_units.sql`). Body, in order: leading
      `UPDATE service_items SET unit_price = '100.00' WHERE code = 'record-retrieval' AND unit_price
      IS NULL;` (hand-added) **then** the `db:generate`d `DROP COLUMN unit` / `unit_price_min` /
      `unit_price_max` **then** `DROP TYPE service_item_unit;`. Backfill precedes the drops.
- [x] Verified the new journal `when` (1780919258320) > previous (1780676928308, `0029`).
- [x] Applied to the **sandbox** DB on the session pooler (`aws-1-us-west-2…:5432`).
- [x] Verified post-migration: `record-retrieval.unit_price` = `100.00` (non-null), `travel` left
      NULL, columns now `{id, code, label, unit_price, description, sort_order, archived_at}`, enum
      `service_item_unit` dropped (pg_type count 0).

#### Phase 2: Schema + query layer
- [x] `src/lib/db/schema/service-items.ts`: dropped the `serviceItemUnit` pgEnum + `unit`/
      `unitPriceMin`/`unitPriceMax` columns; rewrote the stale header comment (flat `unit_price`,
      snapshots into `quote_line_items`, lines up with a QBO `Item`). *(Done in `6f4057c` with
      Phase 1 — generating a correct-snapshot migration requires the schema edit first.)*
- [x] `src/features/services/queries.ts`: removed the `ServiceItemUnit` type + `unit`/`unitPriceMin`/
      `unitPriceMax` from the `ServiceItem` type and the `loadServiceItems` select.
- [x] `src/features/quotes/actions.ts`: removed `unit`/`unitPriceMin`/`unitPriceMax` from
      `loadActiveCatalog`'s select (no other `ServiceItem`-typed usage read them — `seedPrice`/
      `buildPickedLines` only ever read `unitPrice`).
- [x] `tsc` clean.

#### Phase 3: Admin form + validation
- [x] `src/features/services/service-schema.ts`: dropped the `unit` enum field, `SERVICE_UNITS`,
      `unitPriceMin`/`unitPriceMax`. **Deviation:** `unit_price` kept **optional** (blank = "variable"),
      NOT made always-required — see Execution notes (preserves the NULL-price `travel` row; no
      success criterion mandates a price). The `range` cross-field rule lived in `actions.ts`, not the
      schema; removed there.
- [x] `src/features/services/actions.ts`: removed the `range` branch in `toServiceItemFields`; it now
      returns `ServiceItemFields` directly (no error path left), so the `'error' in fields` guards at
      both call sites are gone. `unitPrice = normalizeMoney(v.unitPrice)` (still null for blank).
- [x] `src/features/services/services-admin.tsx`: removed the `unit` picker, `UNIT_LABEL`, the
      conditional min/max inputs, and the `formatPrice` range branch; the form now shows
      Code / Label / Sort / Unit price / Description (Sort kept — orthogonal to this chunk).
- [x] Updated `src/features/services/actions.test.ts` fixtures (dropped `unit`/min/max; deleted the
      obsolete unknown-unit + range-validation + range-insert tests) and the `quotes/actions.test.ts`
      `CATALOG_FIXTURE`. Full suite green (940 passed / 2 skipped).

#### Phase 4: Tests + wiki + smoke
- [x] Ran the full suite (`vitest run`): **940 passed / 2 skipped**, no fixtures left referencing
      removed fields (confirmed by repo-wide grep).
- [x] Ingested into `docs/wiki/data-model.md`: Mermaid ERD `service_items` entity, the "deliberately
      not drawn" note (removed the marked-for-removal clause), the entity-summary table row, and the
      `### service_items` detail prose + seed-catalog line — all now flat `{code,label,unit_price,
      description,sort_order}`, noting the composer reads only `unit_price` and the QBO-`Item` shape
      alignment. `commercial-spine.md` describes the flow, not the column shape — no change needed.
      Added a `log.md` entry (above the prior-session ERD entry).
- [ ] Smoke (web-test): `goto /admin/lookups` — form shows Code / Label / Sort / Unit price /
      Description, **no** unit dropdown, **no** min/max. *(Verified by chunk-end `/eval` web-test.)*
- [ ] Smoke (web-test): `goto /quotes/new`; add "Record Retrieval and Preparation" → line seeds a
      **non-zero** ($100) price. *(Verified by chunk-end `/eval` web-test.)*
- [x] **Prod migration apply recorded as a deploy-time step** (NOT auto-run here): apply `0030` to the
      **prod** DB via `pnpm db:migrate:prod` (fetches the `database-url-production` 5432 session-pooler
      secret) **before** deploying 0066's code to prod Cloud Run (`GCP_REGION=us-east4 …`). 0066's
      migration is additive-then-drop and independent of 0065 — but sequence both prod migrations
      before their respective deploys. See [[project-prod-db]] / CURRENT.md carry-forward.
