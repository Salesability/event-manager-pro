import { integer, pgTable, text } from 'drizzle-orm/pg-core';
import { archivable, bigIdentity } from './_columns';

export const salesLeadSources = pgTable('sales_lead_sources', {
  id: bigIdentity(),
  label: text('label').notNull().unique(),
  sortOrder: integer('sort_order').notNull().default(0),
  ...archivable,
});
