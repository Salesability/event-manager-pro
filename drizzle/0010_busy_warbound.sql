CREATE TYPE "public"."quote_status" AS ENUM('draft', 'sent', 'accepted', 'declined');--> statement-breakpoint
ALTER TYPE "public"."audit_action" ADD VALUE 'quote.create';--> statement-breakpoint
ALTER TYPE "public"."audit_action" ADD VALUE 'quote.sent';--> statement-breakpoint
ALTER TYPE "public"."audit_action" ADD VALUE 'quote.accepted';--> statement-breakpoint
ALTER TYPE "public"."audit_action" ADD VALUE 'quote.declined';--> statement-breakpoint
CREATE TABLE "quotes" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "quotes_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"dealer_id" bigint NOT NULL,
	"msa_id" bigint,
	"status" "quote_status" DEFAULT 'draft' NOT NULL,
	"accept_token" uuid DEFAULT gen_random_uuid() NOT NULL,
	"pdf_storage_key" text,
	"inputs" jsonb NOT NULL,
	"fee" numeric(10, 2) DEFAULT '0' NOT NULL,
	"travel" numeric(10, 2) DEFAULT '0' NOT NULL,
	"deposit_pct" numeric(5, 2) DEFAULT '0' NOT NULL,
	"tax_pct" numeric(5, 2) DEFAULT '15' NOT NULL,
	"quote_valid_days" integer DEFAULT 30 NOT NULL,
	"audience_source_id" bigint,
	"subtotal" numeric(12, 2) DEFAULT '0' NOT NULL,
	"tax" numeric(12, 2) DEFAULT '0' NOT NULL,
	"total" numeric(12, 2) DEFAULT '0' NOT NULL,
	"line_items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"previous_quote_id" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_id" uuid,
	"updated_by_id" uuid,
	CONSTRAINT "quotes_accept_token_unique" UNIQUE("accept_token"),
	CONSTRAINT "quotes_deposit_pct_range" CHECK ("quotes"."deposit_pct" >= 0 AND "quotes"."deposit_pct" <= 100),
	CONSTRAINT "quotes_tax_pct_range" CHECK ("quotes"."tax_pct" >= 0 AND "quotes"."tax_pct" <= 100),
	CONSTRAINT "quotes_quote_valid_days_positive" CHECK ("quotes"."quote_valid_days" > 0)
);
--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "accepted_quote_id" bigint;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_dealer_id_dealers_id_fk" FOREIGN KEY ("dealer_id") REFERENCES "public"."dealers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_msa_id_master_service_agreements_id_fk" FOREIGN KEY ("msa_id") REFERENCES "public"."master_service_agreements"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_audience_source_id_audience_sources_id_fk" FOREIGN KEY ("audience_source_id") REFERENCES "public"."audience_sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_previous_quote_id_quotes_id_fk" FOREIGN KEY ("previous_quote_id") REFERENCES "public"."quotes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "auth"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_updated_by_id_users_id_fk" FOREIGN KEY ("updated_by_id") REFERENCES "auth"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "quotes_dealer_id_idx" ON "quotes" USING btree ("dealer_id");--> statement-breakpoint
CREATE INDEX "quotes_dealer_id_status_idx" ON "quotes" USING btree ("dealer_id","status");--> statement-breakpoint
CREATE INDEX "quotes_msa_id_idx" ON "quotes" USING btree ("msa_id");--> statement-breakpoint
CREATE INDEX "quotes_audience_source_id_idx" ON "quotes" USING btree ("audience_source_id");--> statement-breakpoint
CREATE INDEX "quotes_previous_quote_id_idx" ON "quotes" USING btree ("previous_quote_id");--> statement-breakpoint
CREATE INDEX "quotes_created_by_id_idx" ON "quotes" USING btree ("created_by_id");--> statement-breakpoint
CREATE INDEX "quotes_updated_by_id_idx" ON "quotes" USING btree ("updated_by_id");--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_accepted_quote_id_quotes_id_fk" FOREIGN KEY ("accepted_quote_id") REFERENCES "public"."quotes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "campaigns_accepted_quote_id_idx" ON "campaigns" USING btree ("accepted_quote_id");

-- ────────────────────────────────────────────────────────────────────────────
-- RLS for `quotes` (hand-appended after `pnpm db:generate`; Drizzle doesn't
-- model RLS — see docs/wiki/conventions.md). Mirrors the baseline established
-- in drizzle/0003_enable_rls.sql so every public domain table is uniformly
-- gated: `service_role` permit-all + `authenticated` staff-only via
-- `public.is_staff_member()`. Drizzle bypasses RLS via the `postgres` role's
-- BYPASSRLS attribute; existing Server Actions are unaffected.
--
-- These two policies only admit service_role and authenticated staff. The
-- Phase 4 public accept-link route handler (`/quote/[token]`) is anonymous
-- by design — it must validate the token server-side and read/write the
-- quote row through the server-side Drizzle `db` client (BYPASSRLS), NOT
-- through anon supabase-js (which would see zero rows). If a future JWT-
-- bearing path (e.g. a dealer portal) needs to read quotes, add a scoped
-- policy here keyed on the appropriate ownership predicate.
-- See docs/designs/0019-security-architecture/plan.md Phase 1.
-- ────────────────────────────────────────────────────────────────────────────

alter table public.quotes enable row level security;
--> statement-breakpoint
drop policy if exists "quotes_service_role_all" on public.quotes;
--> statement-breakpoint
create policy "quotes_service_role_all"
  on public.quotes for all to service_role
  using (true) with check (true);
--> statement-breakpoint
drop policy if exists "quotes_staff_all" on public.quotes;
--> statement-breakpoint
create policy "quotes_staff_all"
  on public.quotes for all to authenticated
  using (public.is_staff_member()) with check (public.is_staff_member());