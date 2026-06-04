ALTER TABLE "quotes" ALTER COLUMN "tax_pct" SET DATA TYPE numeric(6, 3);--> statement-breakpoint
ALTER TABLE "quotes" ALTER COLUMN "tax_pct" SET DEFAULT '0';--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "tax_override" numeric(12, 2);--> statement-breakpoint
-- 0065 backfill: lock every existing quote's tax as a manual override so the
-- new province-based auto-compute can never silently re-tax an already-issued
-- quote. New quotes (tax_override NULL) auto-compute from the dealer's province.
UPDATE "quotes" SET "tax_override" = "tax";