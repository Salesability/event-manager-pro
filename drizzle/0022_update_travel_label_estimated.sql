-- 0057 Phase 1: relabel the `travel` catalog row to read "Estimated Travel"
-- so the Client-facing quote PDF (and the composer Summary) frame travel as
-- an estimate, not a fixed charge (owner change-request, 2026-05-21).
--
-- The PDF Travel line `description` is the persisted ComputedLine.label,
-- snapshotted from `service_items.label` at quote-compute time. Updating the
-- catalog row changes the label for newly-computed / recomputed quotes; the
-- seed (0013) is updated in parallel so fresh databases match. Existing
-- persisted JSONB snapshots keep their old label by design.
UPDATE "service_items"
SET "label" = 'Estimated Travel (Hotel / Mileage / Air)'
WHERE "code" = 'travel';
