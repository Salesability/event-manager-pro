import { sql } from 'drizzle-orm';
import { integer, numeric, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';
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
//
// 0071: **QuickBooks is the item master.** This catalog is a read-through mirror
// of the connected QBO company's Items — populated only by the on-demand "Pull
// items" sync, never edited in-app. `unit_price`/`label`/`description` are
// overwritten from QBO on every pull; rows QBO drops are archived; legacy
// unlinked rows are purged. See `docs/chunks/0071-quickbooks-item-pull/`.
export const serviceItems = pgTable(
  'service_items',
  {
    id: bigIdentity(),
    code: text('code').notNull().unique(),
    label: text('label').notNull(),
    unitPrice: numeric('unit_price', { precision: 10, scale: 2 }),
    description: text('description'),
    sortOrder: integer('sort_order').notNull().default(0),
    // Durable link to the QBO `Item.Id` this row mirrors (0071). Set ONLY by the
    // item pull. Unique among linked rows (partial index) — many unlinked NULLs
    // are tolerated transiently but the pull purges them.
    quickbooksId: text('quickbooks_id'),
    ...archivable,
  },
  (table) => [
    uniqueIndex('service_items_quickbooks_id_idx')
      .on(table.quickbooksId)
      .where(sql`${table.quickbooksId} IS NOT NULL`),
  ]
);
