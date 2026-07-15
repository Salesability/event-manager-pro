CREATE TYPE "public"."sms_prospect_temperature" AS ENUM('hot', 'warm', 'cold');--> statement-breakpoint
CREATE TYPE "public"."sms_thread_sentiment" AS ENUM('positive', 'neutral', 'negative');--> statement-breakpoint
ALTER TABLE "sms_threads" ADD COLUMN "display_name" text;--> statement-breakpoint
ALTER TABLE "sms_threads" ADD COLUMN "sentiment" "sms_thread_sentiment";--> statement-breakpoint
ALTER TABLE "sms_threads" ADD COLUMN "prospect_temperature" "sms_prospect_temperature";--> statement-breakpoint
ALTER TABLE "sms_threads" ADD COLUMN "classified_at" timestamp with time zone;--> statement-breakpoint
UPDATE "sms_threads" t
SET "display_name" = nullif(btrim(concat_ws(' ', r."first_name", r."last_name")), '')
FROM "sms_recipients" r
WHERE r."campaign_id" = t."campaign_id" AND r."phone" = t."phone";
