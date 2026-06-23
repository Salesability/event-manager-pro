ALTER TABLE "dealer_contacts" ADD COLUMN "is_primary" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "dealer_contacts_one_primary_per_dealer_unique" ON "dealer_contacts" USING btree ("dealer_id") WHERE is_primary AND archived_at IS NULL;--> statement-breakpoint
-- 0089 Phase 2 backfill: designate each dealer's current displayed primary contact
-- as is_primary. Reproduces fetchPrimaryDealerContacts (src/features/schedule/queries.ts):
-- among non-archived links whose contact is non-archived, pick min role-priority
-- (staff > customer > prospect) then lowest dealer_contacts.id. One row per dealer
-- (DISTINCT ON), so the partial-unique index above is never violated. Email is NOT
-- required here (the displayed primary may be emailless); the recipient resolver's
-- emailable fallback handles that at send time. Nothing visibly moves.
WITH primary_pick AS (
  SELECT DISTINCT ON (dc.dealer_id) dc.id
  FROM dealer_contacts dc
  JOIN contacts c ON c.id = dc.contact_id AND c.archived_at IS NULL
  WHERE dc.archived_at IS NULL
  ORDER BY
    dc.dealer_id,
    CASE dc.role WHEN 'staff' THEN 0 WHEN 'customer' THEN 1 WHEN 'prospect' THEN 2 ELSE 3 END,
    dc.id
)
UPDATE dealer_contacts
SET is_primary = true
WHERE id IN (SELECT id FROM primary_pick);
