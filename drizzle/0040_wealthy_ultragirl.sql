ALTER TABLE "quotes" DROP CONSTRAINT "quotes_msa_id_master_service_agreements_id_fk";
--> statement-breakpoint
DROP INDEX "quotes_msa_id_idx";--> statement-breakpoint
ALTER TABLE "quotes" DROP COLUMN "msa_id";