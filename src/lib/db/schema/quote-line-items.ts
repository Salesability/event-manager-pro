import {
  bigint,
  index,
  integer,
  numeric,
  pgTable,
  text,
} from 'drizzle-orm/pg-core';
import { actors, bigIdentity, timestamps } from './_columns';
import { quotes } from './quotes';
import { serviceItems } from './service-items';

// One row per line on a quote (0062 — the SKU line-item picker). Replaces the
// `quotes.line_items` jsonb snapshot: each line is a SKU the coach picked from
// the `service_items` catalogue, with a per-quote quantity and price.
//
// **Snapshot discipline.** `code`/`label`/`description`/`unitPrice` are copied
// from the chosen catalogue row at save time so the line stays self-contained
// even if the catalogue row is later edited or archived. `serviceItemId` keeps
// the FK link for "which SKU did they pick" reporting but is `set null` on
// catalogue delete — the snapshot columns carry the prospect-facing truth.
//
// **Price model (0062 "seed-then-editable").** `unitPrice` is the catalogue
// seed; `overrideUnitPrice` is the coach's per-quote price when they changed it.
// `effectiveUnit(line) = overrideUnitPrice ?? unitPrice` (see
// `src/lib/quotes/pricing.ts`) drives `lineTotal` + the roll-ups on `quotes.*`.
// Money columns are `numeric` (string mode) to match `quotes` / `service_items`.
//
// Rows are delete-and-inserted by `setQuoteInputs` on every save, so there is
// no unique constraint on `(quote_id, code)` — a picker may legitimately carry
// two lines of the same SKU. Order is the stored `displayOrder`.
export const quoteLineItems = pgTable(
  'quote_line_items',
  {
    id: bigIdentity(),
    quoteId: bigint('quote_id', { mode: 'number' })
      .notNull()
      .references(() => quotes.id, { onDelete: 'cascade' }),
    serviceItemId: bigint('service_item_id', { mode: 'number' }).references(
      () => serviceItems.id,
      { onDelete: 'set null' }
    ),
    code: text('code').notNull(),
    label: text('label').notNull(),
    description: text('description'),
    qty: integer('qty').notNull(),
    unitPrice: numeric('unit_price', { precision: 10, scale: 2 }).notNull(),
    overrideUnitPrice: numeric('override_unit_price', { precision: 10, scale: 2 }),
    lineTotal: numeric('line_total', { precision: 12, scale: 2 }).notNull(),
    displayOrder: integer('display_order').notNull(),
    ...timestamps,
    ...actors,
  },
  (table) => [
    index('quote_line_items_quote_id_idx').on(table.quoteId, table.displayOrder),
    index('quote_line_items_service_item_id_idx').on(table.serviceItemId),
    index('quote_line_items_created_by_id_idx').on(table.createdById),
    index('quote_line_items_updated_by_id_idx').on(table.updatedById),
  ]
);
