ALTER TABLE "quotes" ADD COLUMN "campaign_id" bigint;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "quotes_campaign_id_idx" ON "quotes" USING btree ("campaign_id");