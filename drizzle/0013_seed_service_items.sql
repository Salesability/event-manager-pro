-- Seed v1 service catalog (per 0035-quote-composer Phase 1, 2026-05-11).
-- Idempotent: re-running is a no-op via ON CONFLICT (code).
-- Pricing locked 2026-05-11: `additional-contact` at $3.00/record (OQ #4
-- resolved). `travel` rides `unit='flat'` with `unit_price` NULL because the
-- coach types the actual dollar amount at quote-edit time (composer drives
-- price from `QuoteInputs.travelAmount`, not the catalog row).

INSERT INTO "service_items" ("code", "label", "unit", "unit_price", "unit_price_min", "unit_price_max", "description", "sort_order") VALUES
  ('base-event',          'Base Event (includes 500 records)',  'flat',        '6900.00', NULL,     NULL,     'Standard event package, up to 500 audience records.',                          0),
  ('additional-contact',  'Additional Contact',                 'per-record',  '3.00',    NULL,     NULL,     'Per-record uplift when audience size exceeds the 500-record base.',            1),
  ('bdc-call',            'BDC Call',                           'per-touch',   '2.25',    NULL,     NULL,     'Outbound BDC call touch.',                                                     2),
  ('letter-postage',      'Letter / Postage',                   'per-touch',   '2.50',    NULL,     NULL,     'Mailed letter, postage included.',                                             3),
  ('digital-record',      'Digital (SMS / Email)',              'per-touch',   '0.59',    NULL,     NULL,     'SMS or email touch.',                                                          4),
  ('additional-day',      'Additional Day with Trainer',        'per-day',     '995.00',  NULL,     NULL,     'Each additional event day beyond day one.',                                    5),
  ('record-retrieval',    'Record Retrieval and Preparation',   'range',       NULL,      '100.00', '400.00', 'Catalog menu: $100 / $200 / $300 / $400 (coach picks at quote time).',         6),
  ('travel',              'Travel (Hotel / Mileage / Air)',     'flat',        NULL,      NULL,     NULL,     'Variable; coach types actual cost at quote time, breakdown in travel notes.',  7)
ON CONFLICT ("code") DO NOTHING;
