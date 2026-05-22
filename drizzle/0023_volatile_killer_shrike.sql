CREATE TABLE "billing_adjustments" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "billing_adjustments_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"campaign_id" bigint NOT NULL,
	"field" text NOT NULL,
	"value" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_id" uuid,
	"updated_by_id" uuid,
	CONSTRAINT "billing_adjustments_campaign_field_uq" UNIQUE("campaign_id","field"),
	CONSTRAINT "billing_adjustments_field_check" CHECK ("billing_adjustments"."field" in ('qty_records', 'sms_email', 'letters', 'bdc')),
	CONSTRAINT "billing_adjustments_value_nonneg_check" CHECK ("billing_adjustments"."value" >= 0)
);
--> statement-breakpoint
ALTER TABLE "billing_adjustments" ADD CONSTRAINT "billing_adjustments_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_adjustments" ADD CONSTRAINT "billing_adjustments_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "auth"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_adjustments" ADD CONSTRAINT "billing_adjustments_updated_by_id_users_id_fk" FOREIGN KEY ("updated_by_id") REFERENCES "auth"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "billing_adjustments_campaign_id_idx" ON "billing_adjustments" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "billing_adjustments_created_by_id_idx" ON "billing_adjustments" USING btree ("created_by_id");--> statement-breakpoint
CREATE INDEX "billing_adjustments_updated_by_id_idx" ON "billing_adjustments" USING btree ("updated_by_id");--> statement-breakpoint
-- 0059: enable RLS on billing_adjustments, mirroring the baseline in
-- drizzle/0003_enable_rls.sql + 0014_service_items_rls.sql (service_role
-- permit-all + authenticated staff-only via public.is_staff_member()).
-- Drizzle bypasses RLS via the postgres role's BYPASSRLS attribute, so the
-- admin-only Server Action path is unaffected; the policies gate any future
-- JWT-bearing query path. Idempotent: ENABLE is re-run-safe; each policy is
-- preceded by DROP POLICY IF EXISTS.
alter table public.billing_adjustments enable row level security;--> statement-breakpoint
drop policy if exists "billing_adjustments_service_role_all" on public.billing_adjustments;--> statement-breakpoint
create policy "billing_adjustments_service_role_all"
  on public.billing_adjustments for all to service_role
  using (true) with check (true);--> statement-breakpoint
drop policy if exists "billing_adjustments_staff_all" on public.billing_adjustments;--> statement-breakpoint
create policy "billing_adjustments_staff_all"
  on public.billing_adjustments for all to authenticated
  using (public.is_staff_member()) with check (public.is_staff_member());