import { index, integer, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';
import { actors, archivable, bigIdentity, timestamps } from './_columns';

export const vehicles = pgTable(
  'vehicles',
  {
    id: bigIdentity(),
    vin: text('vin').notNull(),
    year: integer('year'),
    make: text('make'),
    model: text('model'),
    trim: text('trim'),
    ...timestamps,
    ...actors,
    ...archivable,
  },
  (table) => [
    uniqueIndex('vehicles_vin_unique').on(table.vin),
    index('vehicles_created_by_id_idx').on(table.createdById),
    index('vehicles_updated_by_id_idx').on(table.updatedById),
  ]
);
