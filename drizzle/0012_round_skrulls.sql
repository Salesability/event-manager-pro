CREATE TYPE "public"."service_item_unit" AS ENUM('flat', 'per-record', 'per-touch', 'per-day', 'range');--> statement-breakpoint
CREATE TABLE "service_items" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "service_items_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"code" text NOT NULL,
	"label" text NOT NULL,
	"unit" "service_item_unit" NOT NULL,
	"unit_price" numeric(10, 2),
	"unit_price_min" numeric(10, 2),
	"unit_price_max" numeric(10, 2),
	"description" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "service_items_code_unique" UNIQUE("code")
);
