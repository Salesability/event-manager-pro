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
// Order matches the live Postgres enum (snapshot at drizzle/meta/0020_snapshot.json).
// The 0019 migration inserted `msa.*` BEFORE `campaign.cancelled` (ALTER TYPE ADD VALUE BEFORE),
// and 0020 inserted `quote.edited` AFTER `quote.sent`. 0078 appended the two
// `quote.attachment_*` values at the end (ALTER TYPE ADD VALUE, migration 0039);
// 0103 appended the three `sms.*` values the same way (migration 0050),
// 0106 appended the two `sms.thread_*` values (migration 0053), and 0108
// appended `booking.settings_saved` (migration 0055).
// Keeping the TS array in lock-step with the database order keeps drizzle-kit
// diffs quiet around this enum.
export const auditAction = pgEnum('audit_action', [
  'user.role_changed',
  'user.deactivated',
  'dealer.archived',
  'dealer.activated',
  'msa.created',
  'msa.sent',
  'msa.signed',
  'msa.declined',
  'campaign.cancelled',
  'quote.create',
  'quote.sent',
  'quote.edited',
  'quote.accepted',
  'quote.declined',
  'quote.attachment_added',
  'quote.attachment_removed',
  'sms.recipients_imported',
  'sms.launched',
  'sms.opt_out_recorded',
  'sms.thread_replied',
  'sms.thread_reassigned',
  'booking.settings_saved',
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
