import { sql } from 'drizzle-orm';
import { bigint, date, index, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';
import { actors, archivable, bigIdentity, timestamps } from './_columns';
import { contacts } from './contacts';
import { vehicles } from './vehicles';

export const vehicleOwnerships = pgTable(
  'vehicle_ownerships',
  {
    id: bigIdentity(),
    vehicleId: bigint('vehicle_id', { mode: 'number' })
      .notNull()
      .references(() => vehicles.id, { onDelete: 'cascade' }),
    contactId: bigint('contact_id', { mode: 'number' })
      .notNull()
      .references(() => contacts.id, { onDelete: 'cascade' }),
    acquiredAt: date('acquired_at'),
    soldAt: date('sold_at'),
    notes: text('notes'),
    ...timestamps,
    ...actors,
    ...archivable,
  },
  (table) => [
    uniqueIndex('vehicle_ownerships_current_owner_unique')
      .on(table.vehicleId)
      .where(sql`sold_at IS NULL AND archived_at IS NULL`),
    index('vehicle_ownerships_contact_id_idx').on(table.contactId),
    index('vehicle_ownerships_vehicle_id_acquired_idx').on(
      table.vehicleId,
      table.acquiredAt.desc()
    ),
    index('vehicle_ownerships_created_by_id_idx').on(table.createdById),
    index('vehicle_ownerships_updated_by_id_idx').on(table.updatedById),
  ]
);
