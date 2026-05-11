CREATE TYPE "public"."msa_status" AS ENUM('pending', 'active', 'expired', 'terminated');--> statement-breakpoint
CREATE TABLE "master_service_agreements" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "master_service_agreements_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"dealer_id" bigint NOT NULL,
	"status" "msa_status" DEFAULT 'pending' NOT NULL,
	"signed_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"signed_pdf_storage_key" text,
	"dropbox_sign_document_id" text,
	"termination_notice_date" timestamp with time zone,
	"termination_effective_date" timestamp with time zone,
	"template_version" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_id" uuid,
	"updated_by_id" uuid
);
--> statement-breakpoint
ALTER TABLE "master_service_agreements" ADD CONSTRAINT "master_service_agreements_dealer_id_dealers_id_fk" FOREIGN KEY ("dealer_id") REFERENCES "public"."dealers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "master_service_agreements" ADD CONSTRAINT "master_service_agreements_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "auth"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "master_service_agreements" ADD CONSTRAINT "master_service_agreements_updated_by_id_users_id_fk" FOREIGN KEY ("updated_by_id") REFERENCES "auth"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "master_service_agreements_dealer_id_idx" ON "master_service_agreements" USING btree ("dealer_id");--> statement-breakpoint
CREATE INDEX "master_service_agreements_dealer_id_status_idx" ON "master_service_agreements" USING btree ("dealer_id","status");--> statement-breakpoint
CREATE INDEX "master_service_agreements_expires_at_idx" ON "master_service_agreements" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "master_service_agreements_created_by_id_idx" ON "master_service_agreements" USING btree ("created_by_id");--> statement-breakpoint
CREATE INDEX "master_service_agreements_updated_by_id_idx" ON "master_service_agreements" USING btree ("updated_by_id");