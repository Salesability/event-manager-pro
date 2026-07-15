CREATE TYPE "public"."sms_thread_message_direction" AS ENUM('inbound', 'outbound');--> statement-breakpoint
CREATE TABLE "sms_thread_messages" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "sms_thread_messages_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"thread_id" bigint NOT NULL,
	"direction" "sms_thread_message_direction" NOT NULL,
	"body" text NOT NULL,
	"provider_sid" text,
	"status" "sms_message_status",
	"error_code" text,
	"status_updated_at" timestamp with time zone,
	"ai_drafted" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_id" uuid,
	"updated_by_id" uuid,
	CONSTRAINT "sms_thread_messages_status_direction_check" CHECK ((direction = 'inbound' AND status IS NULL) OR (direction = 'outbound' AND status IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "sms_threads" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "sms_threads_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"campaign_id" bigint NOT NULL,
	"phone" text NOT NULL,
	"last_message_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_inbound_at" timestamp with time zone,
	"last_read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_id" uuid,
	"updated_by_id" uuid,
	CONSTRAINT "sms_threads_phone_e164_check" CHECK (phone ~ '^\+[1-9][0-9]{6,14}$')
);
--> statement-breakpoint
ALTER TABLE "sms_thread_messages" ADD CONSTRAINT "sms_thread_messages_thread_id_sms_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."sms_threads"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sms_thread_messages" ADD CONSTRAINT "sms_thread_messages_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "auth"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sms_thread_messages" ADD CONSTRAINT "sms_thread_messages_updated_by_id_users_id_fk" FOREIGN KEY ("updated_by_id") REFERENCES "auth"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sms_threads" ADD CONSTRAINT "sms_threads_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sms_threads" ADD CONSTRAINT "sms_threads_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "auth"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sms_threads" ADD CONSTRAINT "sms_threads_updated_by_id_users_id_fk" FOREIGN KEY ("updated_by_id") REFERENCES "auth"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "sms_thread_messages_provider_sid_unique" ON "sms_thread_messages" USING btree ("provider_sid") WHERE provider_sid IS NOT NULL;--> statement-breakpoint
CREATE INDEX "sms_thread_messages_thread_id_idx" ON "sms_thread_messages" USING btree ("thread_id");--> statement-breakpoint
CREATE INDEX "sms_thread_messages_created_by_id_idx" ON "sms_thread_messages" USING btree ("created_by_id");--> statement-breakpoint
CREATE INDEX "sms_thread_messages_updated_by_id_idx" ON "sms_thread_messages" USING btree ("updated_by_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sms_threads_campaign_phone_unique" ON "sms_threads" USING btree ("campaign_id","phone");--> statement-breakpoint
CREATE INDEX "sms_threads_campaign_id_idx" ON "sms_threads" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "sms_threads_phone_idx" ON "sms_threads" USING btree ("phone");--> statement-breakpoint
CREATE INDEX "sms_threads_created_by_id_idx" ON "sms_threads" USING btree ("created_by_id");--> statement-breakpoint
CREATE INDEX "sms_threads_updated_by_id_idx" ON "sms_threads" USING btree ("updated_by_id");