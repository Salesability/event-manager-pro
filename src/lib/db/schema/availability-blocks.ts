import { sql } from 'drizzle-orm';
import { bigint, check, date, index, pgEnum, pgTable, text } from 'drizzle-orm/pg-core';
import { actors, archivable, bigIdentity, timestamps } from './_columns';
import { contacts } from './contacts';

export const availabilityBlockKind = pgEnum('availability_block_kind', [
  'statutory_holiday',
  'company_closure',
  'coach_unavailable',
]);

export const availabilityBlocks = pgTable(
  'availability_blocks',
  {
    id: bigIdentity(),
    startDate: date('start_date').notNull(),
    endDate: date('end_date').notNull(),
    kind: availabilityBlockKind('kind').notNull(),
    coachId: bigint('coach_id', { mode: 'number' }).references(() => contacts.id, {
      onDelete: 'cascade',
    }),
    region: text('region'),
    reason: text('reason'),
    source: text('source'),
    ...timestamps,
    ...actors,
    ...archivable,
  },
  (table) => [
    index('availability_blocks_date_range_idx').on(table.startDate, table.endDate),
    index('availability_blocks_coach_id_start_date_idx')
      .on(table.coachId, table.startDate)
      .where(sql`coach_id IS NOT NULL`),
    index('availability_blocks_kind_start_date_idx').on(table.kind, table.startDate),
    index('availability_blocks_created_by_id_idx').on(table.createdById),
    index('availability_blocks_updated_by_id_idx').on(table.updatedById),
    check('availability_blocks_date_range_check', sql`${table.endDate} >= ${table.startDate}`),
  ]
);
