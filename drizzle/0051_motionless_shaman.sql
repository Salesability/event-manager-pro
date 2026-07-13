ALTER TABLE "sms_messages" ADD COLUMN "consent_basis" "sms_consent_basis";--> statement-breakpoint
ALTER TABLE "sms_messages" ADD COLUMN "last_contact_at" date;--> statement-breakpoint
ALTER TABLE "sms_messages" ADD COLUMN "identity_hmac" text;--> statement-breakpoint
ALTER TABLE "sms_recipients" ADD COLUMN "identity_hmac" text;