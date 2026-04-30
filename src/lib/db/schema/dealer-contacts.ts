import {
  bigint,
  boolean,
  date,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { actors, archivable, bigIdentity, timestamps } from './_columns';
import { contacts } from './contacts';
import { dealers } from './dealers';

export const dealerContactRole = pgEnum('dealer_contact_role', [
  'customer',
  'staff',
  'prospect',
]);

export const dealerContacts = pgTable(
  'dealer_contacts',
  {
    id: bigIdentity(),
    dealerId: bigint('dealer_id', { mode: 'number' })
      .notNull()
      .references(() => dealers.id, { onDelete: 'cascade' }),
    contactId: bigint('contact_id', { mode: 'number' })
      .notNull()
      .references(() => contacts.id, { onDelete: 'cascade' }),
    role: dealerContactRole('role').notNull(),
    doNotContact: boolean('do_not_contact').notNull().default(false),
    since: date('since'),
    source: text('source'),
    lastContactedAt: timestamp('last_contacted_at', { withTimezone: true }),
    title: text('title'),
    ...timestamps,
    ...actors,
    ...archivable,
  },
  (table) => [
    uniqueIndex('dealer_contacts_dealer_contact_role_unique').on(
      table.dealerId,
      table.contactId,
      table.role
    ),
    index('dealer_contacts_dealer_id_role_idx').on(table.dealerId, table.role),
    index('dealer_contacts_contact_id_idx').on(table.contactId),
    index('dealer_contacts_created_by_id_idx').on(table.createdById),
    index('dealer_contacts_updated_by_id_idx').on(table.updatedById),
  ]
);
