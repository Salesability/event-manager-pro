import { bigint, index, pgEnum, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { actors, bigIdentity, timestamps } from './_columns';
import { dealers } from './dealers';

// One row per logged touch on a dealer (0087 — the prospecting activity log).
// "Log an activity" inserts a row here AND stamps `dealers.last_contacted_at`;
// it does NOT append to `dealers.notes` (decision.md D4 — the activity log is
// the trail now; `notes` stays free-form context + the 0086 import block).
//
// `created_by_id` (via the `actors` mixin) = who logged the touch — the 0088
// dashboard counts activity by actor, so the `(created_by_id, occurred_at)`
// composite index serves both the "recent activity by rep" read and the FK.
//
// The dealer panel renders the most recent N rows as a lite per-dealer timeline;
// the rich timeline UI + Kanban are v2 (intent.md non-goals).
export const dealerActivityKind = pgEnum('dealer_activity_kind', [
  'call',
  'email',
  'meeting',
  'note',
  'other',
]);

export const dealerActivities = pgTable(
  'dealer_activities',
  {
    id: bigIdentity(),
    dealerId: bigint('dealer_id', { mode: 'number' })
      .notNull()
      .references(() => dealers.id, { onDelete: 'cascade' }),
    kind: dealerActivityKind('kind').notNull(),
    note: text('note'),
    // When the touch actually happened (rep-settable; defaults to now). Distinct
    // from `created_at` (when the row was logged) so a rep can backfill a call
    // they forgot to log.
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
    ...timestamps,
    ...actors,
  },
  (table) => [
    index('dealer_activities_dealer_id_idx').on(table.dealerId),
    // Covers the "recent activity by rep" read + the `created_by_id` FK (leftmost).
    index('dealer_activities_created_by_id_occurred_at_idx').on(
      table.createdById,
      table.occurredAt
    ),
    index('dealer_activities_updated_by_id_idx').on(table.updatedById),
  ]
);
