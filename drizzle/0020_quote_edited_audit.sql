-- 0046 Phase 1: add `quote.edited` to the audit_action enum so
-- `recordAudit({ action: 'quote.edited' })` calls from the relaxed
-- `setQuoteInputs` Server Action in `src/features/quotes/actions.ts` can land
-- their forensic rows when a save changes the priced output (subtotal/tax/
-- total/lineItems) on a draft or already-sent quote.
--
-- Mirrors the `msa.*` precedent in 0019_msa_audit_actions.sql: ALTER TYPE …
-- ADD VALUE is the only forward-only operation Postgres allows on a pgEnum
-- (no DROP VALUE), so dropping the type to re-create it would cascade onto
-- audit_log.action — a non-starter on a table we treat as append-only.
--
-- Custom-generated (Drizzle does not auto-generate ALTER TYPE ADD VALUE);
-- snapshot 0020_snapshot.json copies 0019's contents with `quote.edited`
-- appended to the audit_action enum array (positioned next to `quote.sent`
-- for grep-by-prefix legibility).

ALTER TYPE "public"."audit_action" ADD VALUE 'quote.edited' AFTER 'quote.sent';
