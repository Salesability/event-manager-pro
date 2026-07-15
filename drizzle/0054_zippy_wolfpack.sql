CREATE TYPE "public"."appointment_status" AS ENUM('booked', 'cancelled');--> statement-breakpoint
CREATE TABLE "appointments" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "appointments_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"campaign_id" bigint NOT NULL,
	"recipient_id" bigint,
	"slot_date" date NOT NULL,
	"slot_start_minute" integer NOT NULL,
	"first_name" text,
	"last_name" text,
	"phone" text NOT NULL,
	"status" "appointment_status" DEFAULT 'booked' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_id" uuid,
	"updated_by_id" uuid,
	CONSTRAINT "appointments_slot_minute_check" CHECK (slot_start_minute >= 0 AND slot_start_minute < 1440 AND slot_start_minute % 30 = 0),
	CONSTRAINT "appointments_phone_e164_check" CHECK (phone ~ '^\+[1-9][0-9]{6,14}$')
);
--> statement-breakpoint
CREATE TABLE "campaign_booking_settings" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "campaign_booking_settings_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"campaign_id" bigint NOT NULL,
	"day_start_minute" integer DEFAULT 540 NOT NULL,
	"day_end_minute" integer DEFAULT 1020 NOT NULL,
	"slot_capacity" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_id" uuid,
	"updated_by_id" uuid,
	CONSTRAINT "campaign_booking_settings_window_check" CHECK (day_start_minute >= 0 AND day_end_minute <= 1440 AND day_end_minute > day_start_minute),
	CONSTRAINT "campaign_booking_settings_half_hour_check" CHECK (day_start_minute % 30 = 0 AND day_end_minute % 30 = 0),
	CONSTRAINT "campaign_booking_settings_capacity_check" CHECK (slot_capacity >= 1)
);
--> statement-breakpoint
ALTER TABLE "sms_recipients" ADD COLUMN "booking_token" text;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_recipient_id_sms_recipients_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."sms_recipients"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "auth"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_updated_by_id_users_id_fk" FOREIGN KEY ("updated_by_id") REFERENCES "auth"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_booking_settings" ADD CONSTRAINT "campaign_booking_settings_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_booking_settings" ADD CONSTRAINT "campaign_booking_settings_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "auth"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_booking_settings" ADD CONSTRAINT "campaign_booking_settings_updated_by_id_users_id_fk" FOREIGN KEY ("updated_by_id") REFERENCES "auth"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "appointments_recipient_booked_unique" ON "appointments" USING btree ("recipient_id") WHERE recipient_id IS NOT NULL AND status = 'booked';--> statement-breakpoint
CREATE INDEX "appointments_campaign_slot_idx" ON "appointments" USING btree ("campaign_id","slot_date","slot_start_minute");--> statement-breakpoint
CREATE INDEX "appointments_recipient_id_idx" ON "appointments" USING btree ("recipient_id");--> statement-breakpoint
CREATE INDEX "appointments_created_by_id_idx" ON "appointments" USING btree ("created_by_id");--> statement-breakpoint
CREATE INDEX "appointments_updated_by_id_idx" ON "appointments" USING btree ("updated_by_id");--> statement-breakpoint
CREATE UNIQUE INDEX "campaign_booking_settings_campaign_id_unique" ON "campaign_booking_settings" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "campaign_booking_settings_created_by_id_idx" ON "campaign_booking_settings" USING btree ("created_by_id");--> statement-breakpoint
CREATE INDEX "campaign_booking_settings_updated_by_id_idx" ON "campaign_booking_settings" USING btree ("updated_by_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sms_recipients_booking_token_unique" ON "sms_recipients" USING btree ("booking_token") WHERE booking_token IS NOT NULL;