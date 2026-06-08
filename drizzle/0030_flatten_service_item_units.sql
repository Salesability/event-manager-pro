-- 0066: flatten `service_items` to a single `unit_price`.
--
-- The legacy `unit` enum + `unit_price_min`/`unit_price_max` columns modeled a
-- tiered/range pricing scheme the 0053/0062 line-item rebuild made vestigial:
-- the composer (`seedPrice`) + server build (`buildPickedLines`) read only
-- `unit_price`. The DROPs below are drizzle-kit generated.
--
-- The leading UPDATE is hand-added and MUST precede the drops: the one `range`
-- row (`record-retrieval`) carried its price in `unit_price_min`/`max` with
-- `unit_price` NULL, so it seeded $0 in the composer. Backfill it to $100.00
-- (the old menu floor of $100/$200/$300/$400 — seed-then-editable, so a coach
-- bumps it per quote) before the min/max columns disappear. Guarded on
-- `unit_price IS NULL` so it never clobbers a real price, and scoped to
-- `record-retrieval` so the intentionally-NULL `travel` row (variable; coach
-- types the amount) stays NULL.
UPDATE "service_items" SET "unit_price" = '100.00' WHERE "code" = 'record-retrieval' AND "unit_price" IS NULL;--> statement-breakpoint
ALTER TABLE "service_items" DROP COLUMN "unit";--> statement-breakpoint
ALTER TABLE "service_items" DROP COLUMN "unit_price_min";--> statement-breakpoint
ALTER TABLE "service_items" DROP COLUMN "unit_price_max";--> statement-breakpoint
DROP TYPE "public"."service_item_unit";
