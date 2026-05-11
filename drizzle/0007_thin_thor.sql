-- Rename `sales_lead_sources` lookup → `audience_sources` (per 0038-rename-audience-sources).
-- Zero data migration: RENAMEs preserve rows. Postgres doesn't auto-rename
-- indexes / unique constraints / FKs / sequences when their parent table is
-- renamed, so each is renamed explicitly here.

ALTER TABLE "sales_lead_sources" RENAME TO "audience_sources";
ALTER SEQUENCE "sales_lead_sources_id_seq" RENAME TO "audience_sources_id_seq";
ALTER TABLE "audience_sources" RENAME CONSTRAINT "sales_lead_sources_label_unique" TO "audience_sources_label_unique";

ALTER TABLE "campaigns" RENAME COLUMN "sales_lead_source_id" TO "audience_source_id";
ALTER TABLE "campaigns" RENAME CONSTRAINT "campaigns_sales_lead_source_id_sales_lead_sources_id_fk" TO "campaigns_audience_source_id_audience_sources_id_fk";
ALTER INDEX "campaigns_sales_lead_source_id_idx" RENAME TO "campaigns_audience_source_id_idx";
