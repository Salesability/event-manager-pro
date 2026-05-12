CREATE TYPE "public"."dealer_status" AS ENUM('prospect', 'active');--> statement-breakpoint
ALTER TABLE "dealers" ADD COLUMN "status" "dealer_status" DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "dealers" ADD COLUMN "acquired_via" text;--> statement-breakpoint
CREATE INDEX "dealers_status_idx" ON "dealers" USING btree ("status");