import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  date,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { actors, archivable, bigIdentity, timestamps } from './_columns';
import { contacts } from './contacts';
import { dealers } from './dealers';

// A `dealer_contacts` row is "a person at this dealership" (free-text `title`
// for what they do) with an explicit `is_primary` designation for who receives
// quotes/MSAs. The legacy `customer | staff | prospect` role enum was a category
// error and was dropped in chunk 0089 (Phase 4) — superseded by `is_primary`.
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
    // Explicit primary-contact designation (0089): the person who receives
    // quotes/MSAs for this dealer. At most one active primary per dealer
    // (partial-unique index below).
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
    // One active link per (dealer, contact) (0089) — replaces the dropped
    // (dealer_id, contact_id, role) unique now that role is gone, so the
    // "one row per (dealer, contact)" model is actually enforced and the
    // import scripts' onConflictDoNothing stays idempotent. Scoped to
    // non-archived rows so a contact can be re-linked after being archived.
    uniqueIndex('dealer_contacts_dealer_contact_active_unique')
      .on(table.dealerId, table.contactId)
      .where(sql`archived_at IS NULL`),
    // One active primary contact per dealer (0089). Scoped to non-archived rows
    // so an archived former-primary never blocks designating a new one.
    uniqueIndex('dealer_contacts_one_primary_per_dealer_unique')
      .on(table.dealerId)
      .where(sql`is_primary AND archived_at IS NULL`),
    index('dealer_contacts_dealer_id_idx').on(table.dealerId),
    index('dealer_contacts_contact_id_idx').on(table.contactId),
    index('dealer_contacts_created_by_id_idx').on(table.createdById),
    index('dealer_contacts_updated_by_id_idx').on(table.updatedById),
  ]
);
