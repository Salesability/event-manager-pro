-- 0051 Phase 4: rename `master_service_agreements.dropbox_sign_document_id`
-- to `provider_document_id` (provider-agnostic per D #1 in
-- docs/chunks/0051-dropbox-sign-to-boldsign/intent.md). The column was
-- introduced in 0008 to hold a Dropbox Sign signature-request id; the
-- 0051 migration to BoldSign replaces the provider, and the rename
-- future-proofs the schema against the next provider swap by removing
-- the vendor name from the column.
--
-- Custom-generated to emit RENAME COLUMN (Drizzle's auto-detection would
-- have produced DROP + ADD, losing any existing values). Safe to RENAME
-- in a single migration because no production rows hold a value here
-- (per D #3 — Dropbox Sign was never used in production).
--
-- Snapshot 0021_snapshot.json copies 0020's contents with the column
-- entry renamed.

ALTER TABLE "master_service_agreements" RENAME COLUMN "dropbox_sign_document_id" TO "provider_document_id";
