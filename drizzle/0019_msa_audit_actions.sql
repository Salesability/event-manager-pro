-- 0041 Phase 3: add MSA lifecycle values to the audit_action enum so
-- `recordAudit({ action: 'msa.*' })` calls from `src/features/msa/actions.ts`
-- (createMsaDraft, sendMsaEnvelope) and Phase 4's webhook lifecycle helper
-- (markMsaSigned / markMsaDeclined) can land their forensic rows.
--
-- Mirrors the `dealer.activated` precedent in 0016_flat_typhoid_mary.sql:
-- ALTER TYPE … ADD VALUE is the only forward-only operation Postgres allows
-- on a pgEnum (no DROP VALUE), so dropping the type to re-create it would
-- cascade onto audit_log.action — a non-starter on a table we treat as
-- append-only.
--
-- Custom-generated (Drizzle does not auto-generate ALTER TYPE ADD VALUE);
-- snapshot 0019_snapshot.json copies 0018's contents with the new values
-- appended to the audit_action enum array.

ALTER TYPE "public"."audit_action" ADD VALUE 'msa.created' BEFORE 'campaign.cancelled';--> statement-breakpoint
ALTER TYPE "public"."audit_action" ADD VALUE 'msa.sent' BEFORE 'campaign.cancelled';--> statement-breakpoint
ALTER TYPE "public"."audit_action" ADD VALUE 'msa.signed' BEFORE 'campaign.cancelled';--> statement-breakpoint
ALTER TYPE "public"."audit_action" ADD VALUE 'msa.declined' BEFORE 'campaign.cancelled';
