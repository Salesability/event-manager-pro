import { sql } from 'drizzle-orm';
import { index, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { actors, archivable, bigIdentity, timestamps } from './_columns';
import { authUsers } from './auth';

export const contacts = pgTable(
  'contacts',
  {
    id: bigIdentity(),
    firstName: text('first_name').notNull(),
    lastName: text('last_name').notNull(),
    displayName: text('display_name')
      .generatedAlwaysAs(sql`first_name || ' ' || last_name`)
      .notNull(),
    userId: uuid('user_id').references(() => authUsers.id, { onDelete: 'set null' }),
    ...timestamps,
    ...actors,
    ...archivable,
  },
  (table) => [
    uniqueIndex('contacts_user_id_unique').on(table.userId),
    index('contacts_created_by_id_idx').on(table.createdById),
    index('contacts_updated_by_id_idx').on(table.updatedById),
  ]
);
