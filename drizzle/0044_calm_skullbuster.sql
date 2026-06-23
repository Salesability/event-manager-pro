DROP INDEX "dealer_contacts_dealer_contact_role_unique";--> statement-breakpoint
DROP INDEX "dealer_contacts_dealer_id_role_idx";--> statement-breakpoint
CREATE INDEX "dealer_contacts_dealer_id_idx" ON "dealer_contacts" USING btree ("dealer_id");--> statement-breakpoint
ALTER TABLE "dealer_contacts" DROP COLUMN "role";--> statement-breakpoint
DROP TYPE "public"."dealer_contact_role";