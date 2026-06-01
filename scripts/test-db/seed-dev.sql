-- chunk 0063 — dev/test fixtures for the disposable test DB.
--
-- NOT a migration: this never runs against prod. It populates the test
-- container with a small, deterministic data set so you can exercise the app
-- (the quote picker, dealer pages, lists) without hand-inserting rows. Re-runs
-- cleanly — TRUNCATE … RESTART IDENTITY CASCADE gives stable ids every time
-- (dealers 1-3, quotes 1-2), so URLs like /quotes/1 are predictable.
--
-- `service_items` is left alone (it's seeded by migration 0013 — the real
-- catalogue). Run via `pnpm db:test:seed`, or automatically as the last step of
-- `pnpm db:test:reset` (unless TEST_DB_SEED=0).

TRUNCATE dealers, contacts, quotes RESTART IDENTITY CASCADE;

-- Dealers (ids 1, 2, 3).
INSERT INTO dealers (public_id, name, status, address) VALUES
  ('seed-acme',     'Acme Auto Group', 'active',   E'456 Dealership Blvd\nMississauga, ON  L5B 3C2'),
  ('seed-capital',  'Capital Ford',    'active',   E'12 King St\nHalifax, NS  B3J 1A1'),
  ('seed-prospect', 'Prospect Motors', 'prospect', E'99 Future Way\nDartmouth, NS  B2W 1A1');

-- Customer contacts (ids 1, 2) + primary emails, linked to the two active
-- dealers as 'customer' (so the quote-send recipient resolves).
WITH c AS (
  INSERT INTO contacts (first_name, last_name)
  VALUES ('Pat', 'Buyer'), ('Sam', 'Lane')
  RETURNING id, first_name
)
INSERT INTO contact_identifiers (contact_id, kind, value, is_primary)
SELECT id, 'email', lower(first_name) || '@dealer.test', true FROM c;

INSERT INTO dealer_contacts (dealer_id, contact_id, role) VALUES
  (1, 1, 'customer'),
  (2, 2, 'customer');

-- Draft quote 1 (Acme) — 3 picked lines, one with a per-quote price override
-- (bdc-call tuned $2.25 → $2.00) so the composer shows the "Catalogue: …" diff.
WITH q AS (
  INSERT INTO quotes (dealer_id, status, inputs, subtotal, tax, total)
  VALUES (
    1, 'draft',
    '{"audienceSize":500,"eventDays":1,"bdcCallCount":0,"letterCount":0,"digitalCount":0,"recordRetrievalAmount":0,"travelAmount":0,"travelNotes":"","quoteNotes":"Seed draft — exercise the picker here"}'::jsonb,
    '7300.00', '0.00', '7300.00'
  )
  RETURNING id
)
INSERT INTO quote_line_items
  (quote_id, service_item_id, code, label, description, qty, unit_price, override_unit_price, line_total, display_order)
SELECT q.id, si.id, si.code, si.label, si.description, v.qty, si.unit_price, v.override, v.line_total, v.ord
FROM q
CROSS JOIN (VALUES
  ('base-event',         1,   NULL::numeric,   6900.00::numeric, 0),
  ('additional-contact', 100, NULL::numeric,    300.00::numeric, 1),
  ('bdc-call',           50,  2.00::numeric,    100.00::numeric, 2)
) AS v(code, qty, override, line_total, ord)
JOIN service_items si ON si.code = v.code;

-- Draft quote 2 (Capital Ford) — a single base-event line.
WITH q AS (
  INSERT INTO quotes (dealer_id, status, inputs, subtotal, tax, total)
  VALUES (
    2, 'draft',
    '{"audienceSize":500,"eventDays":1,"bdcCallCount":0,"letterCount":0,"digitalCount":0,"recordRetrievalAmount":0,"travelAmount":0,"travelNotes":"","quoteNotes":"Seed draft 2"}'::jsonb,
    '6900.00', '0.00', '6900.00'
  )
  RETURNING id
)
INSERT INTO quote_line_items
  (quote_id, service_item_id, code, label, description, qty, unit_price, override_unit_price, line_total, display_order)
SELECT q.id, si.id, si.code, si.label, si.description, 1, si.unit_price, NULL, 6900.00, 0
FROM q
JOIN service_items si ON si.code = 'base-event';

\echo 'Seeded: 3 dealers, 2 contacts, 2 draft quotes (ids 1-2) with picked line items.'
