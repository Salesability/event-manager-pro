-- Custom SQL migration file, put your code below! --

-- 0093: backfill quotes.campaign_id for already-accepted quotes.
-- A campaign points at the quote it was spawned from via accepted_quote_id, so
-- that reverse link gives us the event for every accepted quote cheaply. Only
-- fills NULLs (idempotent; re-running is a no-op). Pre-existing draft/sent
-- quotes have no reliable event link and stay NULL — acceptable (forward-only).
UPDATE "quotes" q
SET "campaign_id" = c."id"
FROM "campaigns" c
WHERE c."accepted_quote_id" = q."id"
  AND q."campaign_id" IS NULL;
