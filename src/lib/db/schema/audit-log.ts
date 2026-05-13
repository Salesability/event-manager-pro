import {
  bigint,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { authUsers } from './auth';
import { bigIdentity } from './_columns';

// Append-only forensic record of sensitive operations. Written by
// `recordAudit()` from inside each Server Action that mutates a sensitive
// surface (role grants, deactivations, archives, lifecycle transitions).
// `actorRole` is denormalised at write time so the row stays interpretable
// even if the actor's role changes later. No `actors`/`archivable` mixin —
// audit rows have a single `occurredAt` and never archive.
export const auditAction = pgEnum('audit_action', [
  'user.role_changed',
  'user.deactivated',
  'dealer.archived',
  'dealer.activated',
  'campaign.cancelled',
  'quote.create',
  'quote.sent',
  'quote.edited',
  'quote.accepted',
  'quote.declined',
  'msa.created',
  'msa.sent',
  'msa.signed',
  'msa.declined',
]);

export const auditLog = pgTable(
  'audit_log',
  {
    id: bigIdentity(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
    actorUserId: uuid('actor_user_id').references(() => authUsers.id, {
      onDelete: 'set null',
    }),
    actorRole: text('actor_role'),
    action: auditAction('action').notNull(),
    targetTable: text('target_table').notNull(),
    targetId: bigint('target_id', { mode: 'number' }),
    payload: jsonb('payload'),
  },
  (table) => [
    index('audit_log_actor_user_id_idx').on(table.actorUserId),
    index('audit_log_action_occurred_at_idx').on(table.action, table.occurredAt),
    index('audit_log_target_idx').on(table.targetTable, table.targetId),
  ],
);
