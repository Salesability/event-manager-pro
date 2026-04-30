-- auth.users is managed by Supabase; not created here. FK references are emitted below.
CREATE TYPE "public"."availability_block_kind" AS ENUM('statutory_holiday', 'company_closure', 'coach_unavailable');--> statement-breakpoint
CREATE TYPE "public"."campaign_status" AS ENUM('draft', 'booked', 'cancelled', 'completed');--> statement-breakpoint
CREATE TYPE "public"."contact_identifier_kind" AS ENUM('email', 'phone');--> statement-breakpoint
CREATE TYPE "public"."dealer_contact_role" AS ENUM('customer', 'staff', 'prospect');--> statement-breakpoint
CREATE TYPE "public"."team_member_role" AS ENUM('admin', 'staff', 'coach', 'viewer');--> statement-breakpoint
CREATE TABLE "availability_blocks" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "availability_blocks_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"kind" "availability_block_kind" NOT NULL,
	"coach_id" bigint,
	"region" text,
	"reason" text,
	"source" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_id" uuid,
	"updated_by_id" uuid,
	"archived_at" timestamp with time zone,
	CONSTRAINT "availability_blocks_date_range_check" CHECK ("availability_blocks"."end_date" >= "availability_blocks"."start_date")
);
--> statement-breakpoint
CREATE TABLE "campaign_styles" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "campaign_styles_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"label" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "campaign_styles_label_unique" UNIQUE("label")
);
--> statement-breakpoint
CREATE TABLE "campaigns" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "campaigns_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"public_id" text NOT NULL,
	"dealer_id" bigint NOT NULL,
	"coach_id" bigint,
	"style_id" bigint,
	"sales_lead_source_id" bigint,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"qty_records" integer,
	"sms_email" integer,
	"letters" integer,
	"bdc" integer,
	"contact" text,
	"phone" text,
	"email" text,
	"notes" text,
	"fee" numeric(10, 2) DEFAULT '0' NOT NULL,
	"travel" numeric(10, 2) DEFAULT '0' NOT NULL,
	"deposit_pct" numeric(5, 2) DEFAULT '0' NOT NULL,
	"tax_pct" numeric(5, 2) DEFAULT '15' NOT NULL,
	"quote_valid_days" integer DEFAULT 30 NOT NULL,
	"quote_notes" text,
	"status" "campaign_status" DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_id" uuid,
	"updated_by_id" uuid,
	CONSTRAINT "campaigns_public_id_unique" UNIQUE("public_id"),
	CONSTRAINT "campaigns_date_range_check" CHECK ("campaigns"."end_date" >= "campaigns"."start_date")
);
--> statement-breakpoint
CREATE TABLE "contact_identifiers" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "contact_identifiers_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"contact_id" bigint NOT NULL,
	"kind" "contact_identifier_kind" NOT NULL,
	"value" text NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"source" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_id" uuid,
	"updated_by_id" uuid,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "contacts" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "contacts_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"display_name" text GENERATED ALWAYS AS (first_name || ' ' || last_name) STORED NOT NULL,
	"user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_id" uuid,
	"updated_by_id" uuid,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "dealer_contacts" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "dealer_contacts_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"dealer_id" bigint NOT NULL,
	"contact_id" bigint NOT NULL,
	"role" "dealer_contact_role" NOT NULL,
	"do_not_contact" boolean DEFAULT false NOT NULL,
	"since" date,
	"source" text,
	"last_contacted_at" timestamp with time zone,
	"title" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_id" uuid,
	"updated_by_id" uuid,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "dealers" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "dealers_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"public_id" text NOT NULL,
	"name" text NOT NULL,
	"address" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_id" uuid,
	"updated_by_id" uuid,
	"archived_at" timestamp with time zone,
	CONSTRAINT "dealers_public_id_unique" UNIQUE("public_id")
);
--> statement-breakpoint
CREATE TABLE "sales_lead_sources" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "sales_lead_sources_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"label" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "sales_lead_sources_label_unique" UNIQUE("label")
);
--> statement-breakpoint
CREATE TABLE "team_member_roles" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "team_member_roles_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"contact_id" bigint NOT NULL,
	"role" "team_member_role" NOT NULL,
	"specialty" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_id" uuid,
	"updated_by_id" uuid,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "vehicle_ownerships" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "vehicle_ownerships_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"vehicle_id" bigint NOT NULL,
	"contact_id" bigint NOT NULL,
	"acquired_at" date,
	"sold_at" date,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_id" uuid,
	"updated_by_id" uuid,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "vehicles" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "vehicles_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"vin" text NOT NULL,
	"year" integer,
	"make" text,
	"model" text,
	"trim" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_id" uuid,
	"updated_by_id" uuid,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "availability_blocks" ADD CONSTRAINT "availability_blocks_coach_id_contacts_id_fk" FOREIGN KEY ("coach_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "availability_blocks" ADD CONSTRAINT "availability_blocks_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "auth"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "availability_blocks" ADD CONSTRAINT "availability_blocks_updated_by_id_users_id_fk" FOREIGN KEY ("updated_by_id") REFERENCES "auth"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_dealer_id_dealers_id_fk" FOREIGN KEY ("dealer_id") REFERENCES "public"."dealers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_coach_id_contacts_id_fk" FOREIGN KEY ("coach_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_style_id_campaign_styles_id_fk" FOREIGN KEY ("style_id") REFERENCES "public"."campaign_styles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_sales_lead_source_id_sales_lead_sources_id_fk" FOREIGN KEY ("sales_lead_source_id") REFERENCES "public"."sales_lead_sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "auth"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_updated_by_id_users_id_fk" FOREIGN KEY ("updated_by_id") REFERENCES "auth"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_identifiers" ADD CONSTRAINT "contact_identifiers_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_identifiers" ADD CONSTRAINT "contact_identifiers_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "auth"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_identifiers" ADD CONSTRAINT "contact_identifiers_updated_by_id_users_id_fk" FOREIGN KEY ("updated_by_id") REFERENCES "auth"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "auth"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_updated_by_id_users_id_fk" FOREIGN KEY ("updated_by_id") REFERENCES "auth"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dealer_contacts" ADD CONSTRAINT "dealer_contacts_dealer_id_dealers_id_fk" FOREIGN KEY ("dealer_id") REFERENCES "public"."dealers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dealer_contacts" ADD CONSTRAINT "dealer_contacts_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dealer_contacts" ADD CONSTRAINT "dealer_contacts_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "auth"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dealer_contacts" ADD CONSTRAINT "dealer_contacts_updated_by_id_users_id_fk" FOREIGN KEY ("updated_by_id") REFERENCES "auth"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dealers" ADD CONSTRAINT "dealers_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "auth"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dealers" ADD CONSTRAINT "dealers_updated_by_id_users_id_fk" FOREIGN KEY ("updated_by_id") REFERENCES "auth"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_member_roles" ADD CONSTRAINT "team_member_roles_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_member_roles" ADD CONSTRAINT "team_member_roles_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "auth"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_member_roles" ADD CONSTRAINT "team_member_roles_updated_by_id_users_id_fk" FOREIGN KEY ("updated_by_id") REFERENCES "auth"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_ownerships" ADD CONSTRAINT "vehicle_ownerships_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_ownerships" ADD CONSTRAINT "vehicle_ownerships_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_ownerships" ADD CONSTRAINT "vehicle_ownerships_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "auth"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_ownerships" ADD CONSTRAINT "vehicle_ownerships_updated_by_id_users_id_fk" FOREIGN KEY ("updated_by_id") REFERENCES "auth"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "auth"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_updated_by_id_users_id_fk" FOREIGN KEY ("updated_by_id") REFERENCES "auth"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "availability_blocks_date_range_idx" ON "availability_blocks" USING btree ("start_date","end_date");--> statement-breakpoint
CREATE INDEX "availability_blocks_coach_id_start_date_idx" ON "availability_blocks" USING btree ("coach_id","start_date") WHERE coach_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX "availability_blocks_kind_start_date_idx" ON "availability_blocks" USING btree ("kind","start_date");--> statement-breakpoint
CREATE INDEX "availability_blocks_created_by_id_idx" ON "availability_blocks" USING btree ("created_by_id");--> statement-breakpoint
CREATE INDEX "availability_blocks_updated_by_id_idx" ON "availability_blocks" USING btree ("updated_by_id");--> statement-breakpoint
CREATE INDEX "campaigns_dealer_id_idx" ON "campaigns" USING btree ("dealer_id");--> statement-breakpoint
CREATE INDEX "campaigns_coach_id_idx" ON "campaigns" USING btree ("coach_id");--> statement-breakpoint
CREATE INDEX "campaigns_style_id_idx" ON "campaigns" USING btree ("style_id");--> statement-breakpoint
CREATE INDEX "campaigns_sales_lead_source_id_idx" ON "campaigns" USING btree ("sales_lead_source_id");--> statement-breakpoint
CREATE INDEX "campaigns_start_date_idx" ON "campaigns" USING btree ("start_date");--> statement-breakpoint
CREATE INDEX "campaigns_created_by_id_idx" ON "campaigns" USING btree ("created_by_id");--> statement-breakpoint
CREATE INDEX "campaigns_updated_by_id_idx" ON "campaigns" USING btree ("updated_by_id");--> statement-breakpoint
CREATE UNIQUE INDEX "contact_identifiers_kind_value_active_unique" ON "contact_identifiers" USING btree ("kind","value") WHERE archived_at IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "contact_identifiers_contact_kind_primary_unique" ON "contact_identifiers" USING btree ("contact_id","kind") WHERE is_primary;--> statement-breakpoint
CREATE INDEX "contact_identifiers_contact_id_idx" ON "contact_identifiers" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "contact_identifiers_created_by_id_idx" ON "contact_identifiers" USING btree ("created_by_id");--> statement-breakpoint
CREATE INDEX "contact_identifiers_updated_by_id_idx" ON "contact_identifiers" USING btree ("updated_by_id");--> statement-breakpoint
CREATE UNIQUE INDEX "contacts_user_id_unique" ON "contacts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "contacts_created_by_id_idx" ON "contacts" USING btree ("created_by_id");--> statement-breakpoint
CREATE INDEX "contacts_updated_by_id_idx" ON "contacts" USING btree ("updated_by_id");--> statement-breakpoint
CREATE UNIQUE INDEX "dealer_contacts_dealer_contact_role_unique" ON "dealer_contacts" USING btree ("dealer_id","contact_id","role");--> statement-breakpoint
CREATE INDEX "dealer_contacts_dealer_id_role_idx" ON "dealer_contacts" USING btree ("dealer_id","role");--> statement-breakpoint
CREATE INDEX "dealer_contacts_contact_id_idx" ON "dealer_contacts" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "dealer_contacts_created_by_id_idx" ON "dealer_contacts" USING btree ("created_by_id");--> statement-breakpoint
CREATE INDEX "dealer_contacts_updated_by_id_idx" ON "dealer_contacts" USING btree ("updated_by_id");--> statement-breakpoint
CREATE INDEX "dealers_created_by_id_idx" ON "dealers" USING btree ("created_by_id");--> statement-breakpoint
CREATE INDEX "dealers_updated_by_id_idx" ON "dealers" USING btree ("updated_by_id");--> statement-breakpoint
CREATE UNIQUE INDEX "team_member_roles_contact_id_role_unique" ON "team_member_roles" USING btree ("contact_id","role");--> statement-breakpoint
CREATE INDEX "team_member_roles_contact_id_idx" ON "team_member_roles" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "team_member_roles_created_by_id_idx" ON "team_member_roles" USING btree ("created_by_id");--> statement-breakpoint
CREATE INDEX "team_member_roles_updated_by_id_idx" ON "team_member_roles" USING btree ("updated_by_id");--> statement-breakpoint
CREATE UNIQUE INDEX "vehicle_ownerships_current_owner_unique" ON "vehicle_ownerships" USING btree ("vehicle_id") WHERE sold_at IS NULL AND archived_at IS NULL;--> statement-breakpoint
CREATE INDEX "vehicle_ownerships_contact_id_idx" ON "vehicle_ownerships" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "vehicle_ownerships_vehicle_id_acquired_idx" ON "vehicle_ownerships" USING btree ("vehicle_id","acquired_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "vehicle_ownerships_created_by_id_idx" ON "vehicle_ownerships" USING btree ("created_by_id");--> statement-breakpoint
CREATE INDEX "vehicle_ownerships_updated_by_id_idx" ON "vehicle_ownerships" USING btree ("updated_by_id");--> statement-breakpoint
CREATE UNIQUE INDEX "vehicles_vin_unique" ON "vehicles" USING btree ("vin");--> statement-breakpoint
CREATE INDEX "vehicles_created_by_id_idx" ON "vehicles" USING btree ("created_by_id");--> statement-breakpoint
CREATE INDEX "vehicles_updated_by_id_idx" ON "vehicles" USING btree ("updated_by_id");