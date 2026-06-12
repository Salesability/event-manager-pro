CREATE TYPE "public"."campaign_gcal_sync_status" AS ENUM('pending', 'synced', 'failed');--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "gcal_event_id" text;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "gcal_sync_status" "campaign_gcal_sync_status" DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "gcal_synced_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "campaigns_gcal_event_id_idx" ON "campaigns" USING btree ("gcal_event_id") WHERE "campaigns"."gcal_event_id" IS NOT NULL;