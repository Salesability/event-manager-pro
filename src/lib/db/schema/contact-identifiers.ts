import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  index,
  pgEnum,
  pgTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { actors, archivable, bigIdentity, timestamps } from './_columns';
import { contacts } from './contacts';

export const contactIdentifierKind = pgEnum('contact_identifier_kind', ['email', 'phone']);

export const contactIdentifiers = pgTable(
  'contact_identifiers',
  {
    id: bigIdentity(),
    contactId: bigint('contact_id', { mode: 'number' })
      .notNull()
      .references(() => contacts.id, { onDelete: 'cascade' }),
    kind: contactIdentifierKind('kind').notNull(),
    value: text('value').notNull(),
    isPrimary: boolean('is_primary').notNull().default(false),
    source: text('source'),
    ...timestamps,
    ...actors,
    ...archivable,
  },
  (table) => [
    uniqueIndex('contact_identifiers_kind_value_active_unique')
      .on(table.kind, table.value)
      .where(sql`archived_at IS NULL`),
    uniqueIndex('contact_identifiers_contact_kind_primary_unique')
      .on(table.contactId, table.kind)
      .where(sql`is_primary`),
    index('contact_identifiers_contact_id_idx').on(table.contactId),
    index('contact_identifiers_created_by_id_idx').on(table.createdById),
    index('contact_identifiers_updated_by_id_idx').on(table.updatedById),
  ]
);
