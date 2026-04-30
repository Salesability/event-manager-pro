import { index, pgTable, text } from 'drizzle-orm/pg-core';
import { actors, archivable, bigIdentity, timestamps } from './_columns';

export const dealers = pgTable(
  'dealers',
  {
    id: bigIdentity(),
    publicId: text('public_id').notNull().unique(),
    name: text('name').notNull(),
    address: text('address'),
    ...timestamps,
    ...actors,
    ...archivable,
  },
  (table) => [
    index('dealers_created_by_id_idx').on(table.createdById),
    index('dealers_updated_by_id_idx').on(table.updatedById),
  ]
);
