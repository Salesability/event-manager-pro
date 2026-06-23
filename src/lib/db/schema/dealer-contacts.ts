import { sql } from 'drizzle-orm';
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

// Legacy contact-role taxonomy (customer | staff | prospect). Being retired by
// chunk 0089 — superseded by the explicit `is_primary` designation below. The
// enum + the `role` column + their indexes are dropped in 0089 Phase 4 once all
// reads are off them; kept here through the expand→migrate phases.
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
    // Explicit primary-contact designation (0089): the person who receives
    // quotes/MSAs for this dealer. Supersedes the role-priority heuristic. At
    // most one active primary per dealer (partial-unique index below).
    isPrimary: boolean('is_primary').notNull().default(false),
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
    // One active primary contact per dealer (0089). Scoped to non-archived rows
    // so an archived former-primary never blocks designating a new one.
    uniqueIndex('dealer_contacts_one_primary_per_dealer_unique')
      .on(table.dealerId)
      .where(sql`is_primary AND archived_at IS NULL`),
    index('dealer_contacts_dealer_id_role_idx').on(table.dealerId, table.role),
    index('dealer_contacts_contact_id_idx').on(table.contactId),
    index('dealer_contacts_created_by_id_idx').on(table.createdById),
    index('dealer_contacts_updated_by_id_idx').on(table.updatedById),
  ]
);
