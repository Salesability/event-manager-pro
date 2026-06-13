CREATE TABLE "quote_attachments" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "quote_attachments_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"quote_id" bigint NOT NULL,
	"filename" text NOT NULL,
	"storage_key" text NOT NULL,
	"content_type" text NOT NULL,
	"byte_size" integer NOT NULL,
	"display_order" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_id" uuid,
	"updated_by_id" uuid
);
--> statement-breakpoint
ALTER TABLE "quote_attachments" ADD CONSTRAINT "quote_attachments_quote_id_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quotes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_attachments" ADD CONSTRAINT "quote_attachments_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "auth"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_attachments" ADD CONSTRAINT "quote_attachments_updated_by_id_users_id_fk" FOREIGN KEY ("updated_by_id") REFERENCES "auth"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "quote_attachments_quote_id_idx" ON "quote_attachments" USING btree ("quote_id","display_order");--> statement-breakpoint
CREATE INDEX "quote_attachments_created_by_id_idx" ON "quote_attachments" USING btree ("created_by_id");--> statement-breakpoint
CREATE INDEX "quote_attachments_updated_by_id_idx" ON "quote_attachments" USING btree ("updated_by_id");--> statement-breakpoint
-- RLS (0078): quote_attachments is a child-of-quotes domain table, so it gets the
-- standard two policies matching quote_line_items (service_role permit-all +
-- authenticated staff-only via public.is_staff_member()). New public tables ship
-- RLS-on or Supabase's advisor flags them `rls_disabled_in_public`. Drizzle bypasses
-- RLS via the postgres role's BYPASSRLS, so the admin-only Server Action data path is
-- unaffected; the policies gate any future JWT-bearing query path.
-- Idempotent: ENABLE is re-run-safe; each CREATE POLICY is preceded by DROP IF EXISTS.
ALTER TABLE "public"."quote_attachments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "quote_attachments_service_role_all" ON "public"."quote_attachments";--> statement-breakpoint
CREATE POLICY "quote_attachments_service_role_all"
  ON "public"."quote_attachments" FOR ALL TO service_role
  USING (true) WITH CHECK (true);--> statement-breakpoint
DROP POLICY IF EXISTS "quote_attachments_staff_all" ON "public"."quote_attachments";--> statement-breakpoint
CREATE POLICY "quote_attachments_staff_all"
  ON "public"."quote_attachments" FOR ALL TO authenticated
  USING (public.is_staff_member()) WITH CHECK (public.is_staff_member());