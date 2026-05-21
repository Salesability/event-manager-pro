-- Seed lookup tables with values observed in the legacy Sheet (2026-04-30).
-- Idempotent: re-running is a no-op. See docs/chunks/2026-04-30-sheets-import/notes.md.

INSERT INTO "campaign_styles" ("label", "sort_order") VALUES
  ('VIP Sales Event', 0)
ON CONFLICT ("label") DO NOTHING;
--> statement-breakpoint
INSERT INTO "sales_lead_sources" ("label", "sort_order") VALUES
  ('Dealer Database', 0),
  ('PBS', 1),
  ('Third Party List', 2),
  ('Previous Buyers', 3)
ON CONFLICT ("label") DO NOTHING;
