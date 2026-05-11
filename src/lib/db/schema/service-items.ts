import { integer, numeric, pgEnum, pgTable, text } from 'drizzle-orm/pg-core';
import { archivable, bigIdentity } from './_columns';

// `unit` discriminates how a quote-composer input maps to a line-item qty.
// `flat` and `per-*` rows carry `unit_price`; `range` rows carry
// `unit_price_min` + `unit_price_max` (catalog menu of acceptable values);
// `travel` is `flat` with `unit_price` null because the coach types the
// actual dollar amount at quote-edit time (see 0035 plan Phase 3).
export const serviceItemUnit = pgEnum('service_item_unit', [
  'flat',
  'per-record',
  'per-touch',
  'per-day',
  'range',
]);

export const serviceItems = pgTable('service_items', {
  id: bigIdentity(),
  code: text('code').notNull().unique(),
  label: text('label').notNull(),
  unit: serviceItemUnit('unit').notNull(),
  unitPrice: numeric('unit_price', { precision: 10, scale: 2 }),
  unitPriceMin: numeric('unit_price_min', { precision: 10, scale: 2 }),
  unitPriceMax: numeric('unit_price_max', { precision: 10, scale: 2 }),
  description: text('description'),
  sortOrder: integer('sort_order').notNull().default(0),
  ...archivable,
});
