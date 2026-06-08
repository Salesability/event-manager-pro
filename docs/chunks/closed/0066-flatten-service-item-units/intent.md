# Flatten service-item units → flat unit_price — Intent

**Created:** 2026-06-05

## Problem

The `service_items` catalog still carries a richer pricing model than the product uses. The
`unit` enum (`flat` / `per-record` / `per-touch` / `per-day` / `range`) and the
`unit_price_min` / `unit_price_max` columns were load-bearing in the **bespoke 0035 quote
composer**, where `unit` drove how an input mapped to a line-item qty. The **0053/0062 rebuild**
around the `quote_line_items` table replaced that with a generic *pick-a-service → type qty →
type price* model. Since then:

- The live composer (`quote-composer.tsx` `seedPrice`) and the server build
  (`features/quotes/actions.ts` `buildPickedLines`) read **only** `unit_price`. `unit`,
  `unit_price_min`, and `unit_price_max` are selected-but-unused dead reads.
- Four of the five `unit` values (`flat`/`per-record`/`per-touch`/`per-day`) are now
  indistinguishable — every row carrying them already has a real `unit_price`, so they all behave
  as flat. The `unit` label is cosmetic.
- The fifth value, `range`, is **mildly broken**: the one row using it (`record-retrieval`,
  unit_price `NULL`, min `100` / max `400`) seeds at **$0.00** in the composer because `seedPrice`
  returns 0 when `unit_price` is null. The catalog min/max menu is silently ignored.

So the catalog advertises a pricing model the app no longer honors, ships one row that seeds $0,
and the schema comment in `service-items.ts` still describes the dead 0035 mapping.

## Desired outcome

`service_items` collapses to the shape the composer actually uses — `{ code, label, unit_price,
description }` — with the `unit` enum + min/max columns gone, the one `range` row backfilled with a
real price (so it stops seeding $0), and the admin lookup form simplified to match. Quote behavior
is unchanged (it already only used `unit_price`); existing quotes are untouched (they snapshot into
`quote_line_items`). The stale schema comment is corrected and the wiki records the new flat shape.

As a side benefit, the flattened catalog shape lines up cleanly with a QuickBooks `Item` (single
`UnitPrice`), de-risking a future QBO Item → `service_items` import.

## Non-goals

- Reviving tiered / per-unit / range pricing in the composer (the "option C" path). If the product
  ever wants tiered pricing back, that's a new chunk with composer work, not this cleanup.
- The QuickBooks `Item` → `service_items` import itself — a separate future chunk. This only
  *aligns the shape* for it.
- Any change to `quote_line_items` or in-flight/historical quotes (they snapshot price at build
  time and are unaffected by catalog edits).

## Success criteria

- [ ] `service_items` has no `unit`, `unit_price_min`, or `unit_price_max` columns; the
  `service_item_unit` pg enum type is dropped.
- [ ] `record-retrieval` carries a non-null `unit_price` and no longer seeds $0 in the composer.
- [ ] The `/admin/lookups` service-item form shows only Label / Code / Unit price / Description —
  no unit dropdown, no min/max fields.
- [ ] Composer + server quote-build behavior is unchanged (still seed from `unit_price`); the full
  test suite is green with updated fixtures.
- [ ] The stale comment block atop `src/lib/db/schema/service-items.ts` is corrected; `docs/wiki`
  (`data-model.md` and/or `commercial-spine.md`) records the flat shape.

## Open questions

- ~~**What `unit_price` to backfill onto `record-retrieval`?**~~ **Resolved 2026-06-08 → $100.00**
  (owner-confirmed). The old menu was $100 / $200 / $300 / $400 (min 100 / max 400); we take the
  floor. Seed-then-editable, so a coach bumps it up per quote when the job is bigger — an editable
  seed should err low rather than silently over-quote.
- ~~Drop `unit` entirely vs. keep a single descriptive label column?~~ **Resolved 2026-06-08 →
  drop entirely** (owner-confirmed). Verified no reader of `service_items.unit` exists outside the
  schema, the admin CRUD, and the dead selects 0066 removes — no reporting/display surface needs it.

## Why now

Surfaced while scoping "use QuickBooks as the source for SKU inventory" — establishing that the
`unit`/range model is vestigial both removed the main blocker for that import *and* exposed the
`record-retrieval` $0-seed bug. Cleaning the catalog now is a small, self-contained win that also
pre-aligns the schema for the QBO Item slice.
