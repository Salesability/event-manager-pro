CREATE TABLE "quickbooks_connection" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "quickbooks_connection_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"singleton" boolean DEFAULT true NOT NULL,
	"realm_id" text NOT NULL,
	"access_token_enc" text NOT NULL,
	"refresh_token_enc" text NOT NULL,
	"access_token_expires_at" timestamp with time zone NOT NULL,
	"refresh_token_expires_at" timestamp with time zone NOT NULL,
	"connected_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "quickbooks_connection_singleton_true" CHECK ("quickbooks_connection"."singleton")
);
--> statement-breakpoint
ALTER TABLE "quickbooks_connection" ADD CONSTRAINT "quickbooks_connection_connected_by_id_users_id_fk" FOREIGN KEY ("connected_by_id") REFERENCES "auth"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "quickbooks_connection_singleton_unique" ON "quickbooks_connection" USING btree ("singleton");--> statement-breakpoint
CREATE INDEX "quickbooks_connection_connected_by_id_idx" ON "quickbooks_connection" USING btree ("connected_by_id");