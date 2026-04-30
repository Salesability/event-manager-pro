import { bigint, timestamp, uuid } from 'drizzle-orm/pg-core';
import { authUsers } from './auth';

export const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

export const archivable = {
  archivedAt: timestamp('archived_at', { withTimezone: true }),
};

export const actors = {
  createdById: uuid('created_by_id').references(() => authUsers.id, { onDelete: 'set null' }),
  updatedById: uuid('updated_by_id').references(() => authUsers.id, { onDelete: 'set null' }),
};

export const bigIdentity = () =>
  bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity();
