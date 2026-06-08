import { integer, numeric, pgTable, text } from 'drizzle-orm/pg-core';
import { archivable, bigIdentity } from './_columns';

// Flat service catalog the quote composer reads. Each row is a SKU with a
// single `unit_price` (nullable — a blank price means "variable", e.g.
// `travel`, where the coach types the dollar amount at quote time). The
// composer seeds a picked line's price from `unit_price`; that line then
// snapshots into `quote_line_items`, so catalog edits never touch in-flight or
// historical quotes. `code` is immutable — archive instead of renaming. The
// flat shape lines up with a QuickBooks `Item` (single `UnitPrice`). The legacy
// `unit` enum + `unit_price_min`/`unit_price_max` columns were dropped in 0066
// (they were vestigial after the 0053/0062 line-item rebuild).
export const serviceItems = pgTable('service_items', {
  id: bigIdentity(),
  code: text('code').notNull().unique(),
  label: text('label').notNull(),
  unitPrice: numeric('unit_price', { precision: 10, scale: 2 }),
  description: text('description'),
  sortOrder: integer('sort_order').notNull().default(0),
  ...archivable,
});
