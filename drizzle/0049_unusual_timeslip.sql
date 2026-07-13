CREATE TYPE "public"."sms_message_status" AS ENUM('queued', 'sent', 'delivered', 'undelivered', 'failed');--> statement-breakpoint
CREATE TYPE "public"."sms_opt_out_source" AS ENUM('stop_reply', 'manual');--> statement-breakpoint
CREATE TYPE "public"."sms_consent_basis" AS ENUM('express', 'implied_purchase', 'implied_inquiry');--> statement-breakpoint
CREATE TABLE "sms_messages" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "sms_messages_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"send_id" bigint NOT NULL,
	"recipient_id" bigint,
	"phone" text NOT NULL,
	"provider_sid" text,
	"status" "sms_message_status" DEFAULT 'queued' NOT NULL,
	"error_code" text,
	"status_updated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sms_messages_phone_e164_check" CHECK (phone ~ '^\+[1-9][0-9]{6,14}$')
);
--> statement-breakpoint
CREATE TABLE "sms_opt_outs" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "sms_opt_outs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"phone" text NOT NULL,
	"source" "sms_opt_out_source" NOT NULL,
	"opted_out_at" timestamp with time zone DEFAULT now() NOT NULL,
	"provider_message_sid" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_id" uuid,
	"updated_by_id" uuid,
	CONSTRAINT "sms_opt_outs_phone_unique" UNIQUE("phone"),
	CONSTRAINT "sms_opt_outs_phone_e164_check" CHECK (phone ~ '^\+[1-9][0-9]{6,14}$')
);
--> statement-breakpoint
CREATE TABLE "sms_recipients" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "sms_recipients_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"campaign_id" bigint NOT NULL,
	"phone" text NOT NULL,
	"first_name" text,
	"last_name" text,
	"consent_basis" "sms_consent_basis" NOT NULL,
	"last_contact_at" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_id" uuid,
	"updated_by_id" uuid,
	CONSTRAINT "sms_recipients_phone_e164_check" CHECK (phone ~ '^\+[1-9][0-9]{6,14}$')
);
--> statement-breakpoint
CREATE TABLE "sms_sends" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "sms_sends_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"campaign_id" bigint NOT NULL,
	"body" text NOT NULL,
	"total_recipients" integer NOT NULL,
	"excluded_opt_out" integer NOT NULL,
	"excluded_stale_consent" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_id" uuid,
	"updated_by_id" uuid
);
--> statement-breakpoint
ALTER TABLE "sms_messages" ADD CONSTRAINT "sms_messages_send_id_sms_sends_id_fk" FOREIGN KEY ("send_id") REFERENCES "public"."sms_sends"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sms_messages" ADD CONSTRAINT "sms_messages_recipient_id_sms_recipients_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."sms_recipients"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sms_opt_outs" ADD CONSTRAINT "sms_opt_outs_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "auth"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sms_opt_outs" ADD CONSTRAINT "sms_opt_outs_updated_by_id_users_id_fk" FOREIGN KEY ("updated_by_id") REFERENCES "auth"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sms_recipients" ADD CONSTRAINT "sms_recipients_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sms_recipients" ADD CONSTRAINT "sms_recipients_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "auth"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sms_recipients" ADD CONSTRAINT "sms_recipients_updated_by_id_users_id_fk" FOREIGN KEY ("updated_by_id") REFERENCES "auth"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sms_sends" ADD CONSTRAINT "sms_sends_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sms_sends" ADD CONSTRAINT "sms_sends_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "auth"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sms_sends" ADD CONSTRAINT "sms_sends_updated_by_id_users_id_fk" FOREIGN KEY ("updated_by_id") REFERENCES "auth"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "sms_messages_provider_sid_unique" ON "sms_messages" USING btree ("provider_sid") WHERE provider_sid IS NOT NULL;--> statement-breakpoint
CREATE INDEX "sms_messages_send_id_idx" ON "sms_messages" USING btree ("send_id");--> statement-breakpoint
CREATE INDEX "sms_messages_recipient_id_idx" ON "sms_messages" USING btree ("recipient_id");--> statement-breakpoint
CREATE INDEX "sms_messages_phone_idx" ON "sms_messages" USING btree ("phone");--> statement-breakpoint
CREATE UNIQUE INDEX "sms_recipients_campaign_phone_unique" ON "sms_recipients" USING btree ("campaign_id","phone");--> statement-breakpoint
CREATE INDEX "sms_recipients_campaign_id_idx" ON "sms_recipients" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "sms_recipients_created_at_idx" ON "sms_recipients" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "sms_recipients_created_by_id_idx" ON "sms_recipients" USING btree ("created_by_id");--> statement-breakpoint
CREATE INDEX "sms_recipients_updated_by_id_idx" ON "sms_recipients" USING btree ("updated_by_id");--> statement-breakpoint
CREATE INDEX "sms_sends_campaign_id_idx" ON "sms_sends" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "sms_sends_created_by_id_idx" ON "sms_sends" USING btree ("created_by_id");--> statement-breakpoint
CREATE INDEX "sms_sends_updated_by_id_idx" ON "sms_sends" USING btree ("updated_by_id");