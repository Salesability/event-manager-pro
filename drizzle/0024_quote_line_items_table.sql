-- 0062 Phase 1: create `quote_line_items` and backfill it from the existing
-- `quotes.line_items` jsonb snapshot.
--
-- 0062 pivots the quote composer from a parametric calculator to a SKU
-- line-item picker (docs/chunks/0062-quote-line-item-picker/). This table is
-- the picker's backing store — one row per line a coach picked, with a per-quote
-- quantity and price. It folds in the table migration the superseded
-- 0053-quote-line-items-table chunk scoped but never built.
--
-- The CREATE TABLE block below is drizzle-kit generated. The trailing
-- INSERT … SELECT is hand-added: it explodes each quote's `line_items` jsonb
-- array into rows (preserving order via WITH ORDINALITY), so every existing
-- quote survives the pivot as ordinary picked lines. It carries the per-line
-- coach override (`overrideUnitPrice` — NULL when the key is absent, i.e. an
-- untuned line) so 0052 price overrides aren't lost, and resolves
-- `service_item_id` by matching the snapshot `code` to the live catalogue
-- (NULL if the code was archived/renamed). `description` stays NULL — the old
-- calculator jsonb never carried it; it self-heals on the next composer save.
-- `coalesce(line_items, '[]')` makes the backfill safe against null / empty
-- arrays and idempotent against a freshly-created (empty) table.
--
-- The `quotes.line_items` column is NOT dropped here — it stays as a safety net
-- through Phases 2–6 and is removed by 0025_drop_quotes_line_items_jsonb.sql.

CREATE TABLE "quote_line_items" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "quote_line_items_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"quote_id" bigint NOT NULL,
	"service_item_id" bigint,
	"code" text NOT NULL,
	"label" text NOT NULL,
	"description" text,
	"qty" integer NOT NULL,
	"unit_price" numeric(10, 2) NOT NULL,
	"override_unit_price" numeric(10, 2),
	"line_total" numeric(12, 2) NOT NULL,
	"display_order" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_id" uuid,
	"updated_by_id" uuid
);
--> statement-breakpoint
ALTER TABLE "quote_line_items" ADD CONSTRAINT "quote_line_items_quote_id_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quotes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_line_items" ADD CONSTRAINT "quote_line_items_service_item_id_service_items_id_fk" FOREIGN KEY ("service_item_id") REFERENCES "public"."service_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_line_items" ADD CONSTRAINT "quote_line_items_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "auth"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_line_items" ADD CONSTRAINT "quote_line_items_updated_by_id_users_id_fk" FOREIGN KEY ("updated_by_id") REFERENCES "auth"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "quote_line_items_quote_id_idx" ON "quote_line_items" USING btree ("quote_id","display_order");--> statement-breakpoint
CREATE INDEX "quote_line_items_service_item_id_idx" ON "quote_line_items" USING btree ("service_item_id");--> statement-breakpoint
CREATE INDEX "quote_line_items_created_by_id_idx" ON "quote_line_items" USING btree ("created_by_id");--> statement-breakpoint
CREATE INDEX "quote_line_items_updated_by_id_idx" ON "quote_line_items" USING btree ("updated_by_id");--> statement-breakpoint
INSERT INTO "quote_line_items" ("quote_id", "service_item_id", "code", "label", "qty", "unit_price", "override_unit_price", "line_total", "display_order", "created_at", "updated_at")
SELECT
	q."id",
	(SELECT si."id" FROM "service_items" si WHERE si."code" = elem->>'code'),
	elem->>'code',
	elem->>'label',
	(elem->>'qty')::int,
	(elem->>'unitPrice')::numeric,
	(elem->>'overrideUnitPrice')::numeric,
	(elem->>'lineTotal')::numeric,
	ord,
	now(),
	now()
FROM "quotes" q
CROSS JOIN LATERAL jsonb_array_elements(coalesce(q."line_items", '[]'::jsonb)) WITH ORDINALITY AS t(elem, ord);
