CREATE TABLE "tax_rates" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "tax_rates_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"province" "ca_province" NOT NULL,
	"label" text NOT NULL,
	"rate" numeric(6, 3) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tax_rates_province_unique" UNIQUE("province")
);
--> statement-breakpoint
-- 0065 seed: combined Canadian sales-tax rate per province/territory, as of
-- June 2026 (GST/HST/PST/QST collapsed into one percent). Idempotent — admins
-- edit these in /admin/lookups afterwards. QC is 14.975 (5% GST + 9.975% QST).
INSERT INTO "tax_rates" ("province", "label", "rate") VALUES
	('AB', 'Alberta', 5.000),
	('BC', 'British Columbia', 12.000),
	('MB', 'Manitoba', 12.000),
	('NB', 'New Brunswick', 15.000),
	('NL', 'Newfoundland and Labrador', 15.000),
	('NS', 'Nova Scotia', 14.000),
	('NT', 'Northwest Territories', 5.000),
	('NU', 'Nunavut', 5.000),
	('ON', 'Ontario', 13.000),
	('PE', 'Prince Edward Island', 15.000),
	('QC', 'Quebec', 14.975),
	('SK', 'Saskatchewan', 11.000),
	('YT', 'Yukon', 5.000)
ON CONFLICT ("province") DO NOTHING;
