# Travel Labeled "Estimated" — Plan

**Started:** _Not started — scaffolded 2026-05-21_

> Trivial one-phase chunk (label copy change) — `intent.md` skipped per `CLAUDE.md` convention. The owner asked that the Travel figure under a quote read as "estimated" so Clients don't treat it as a fixed charge.

## Progress Tracker

| Phase | Status | Commit |
|-------|--------|--------|
| 1: Rename Travel label to "Estimated" in composer + PDF | Done | `2b63b0a` |

Rename the "Travel ($)" input label in the quote composer and the matching Travel line in the rendered quote PDF to read "Estimated Travel," then update any test fixtures that assert the old label.

## Code Anchors

| New code | Anchor (`path:line`) | Why this anchor |
|----------|---------------------|-----------------|
| Composer label `"Travel ($)"` → `"Estimated Travel ($)"` | `src/features/quotes/quote-composer.tsx:621` | The input label the owner sees while building a quote |
| ~~PDF Travel line label~~ Catalog `travel.label` (drives the PDF) | `drizzle/0022_update_travel_label_estimated.sql` (new) + seed `drizzle/0013_seed_service_items.sql:16` | **Anchor correction:** the PDF Travel line `description` is the persisted `ComputedLine.label`, snapshotted from `service_items.label` (`actions.ts:668`, `pricing.ts:202`) — NOT hardcoded in `render-quote.ts`. Changing the Client-facing label = a catalog data migration + seed update. |
| Test fixture label | `src/lib/quotes/pricing.test.ts:98` (`'Travel (Hotel / Mileage / Air)'`) | Update if the label is asserted in tests |

**Conventions referenced:**
- `docs/wiki/commercial-spine.md` — quote composer / PDF surface (no behavior change, copy only).
- `db-conventions` — custom data-migration on the `service_items` lookup table (0022).

**Wording decision (2026-05-22):** composer = `Estimated Travel ($)`; catalog/PDF = `Estimated Travel (Hotel / Mileage / Air)` — matched for consistency. Owner's emailed intent ("read as estimated") satisfied; the "Estimated Travel" vs "Travel (estimated)" toss-up resolved to the prefix form to mirror the composer.

**Migration application note:** `DATABASE_URL` points at the shared/remote Supabase; `0022` is committed but NOT auto-applied (the build gate is `tsc + test` only). Apply at deploy via `pnpm db:migrate`. Existing persisted quote JSONB snapshots keep their old label by design — only newly-computed / recomputed quotes pick up "Estimated Travel".

**Overall Progress:** 100% (1/1 phases complete)

### Phase Checklist

#### Phase 1: Rename Travel label
- [x] `quote-composer.tsx:621`: `"Travel ($)"` → `"Estimated Travel ($)"`
- [x] ~~`render-quote.ts`~~ Catalog label: `0022` migration `UPDATE service_items SET label='Estimated Travel (Hotel / Mileage / Air)'` + seed `0013` updated for fresh DBs (PDF label is catalog-driven, not hardcoded)
- [x] Update any test fixtures / assertions referencing the old Travel label (`pricing.test.ts:98`)
- [ ] Smoke (web-test): `goto /quotes/<draft-id>` composer; the Travel field label reads "Estimated Travel"
