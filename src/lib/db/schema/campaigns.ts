import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  date,
  index,
  integer,
  numeric,
  pgEnum,
  pgTable,
  text,
} from 'drizzle-orm/pg-core';
import { actors, bigIdentity, timestamps } from './_columns';
import { campaignStyles } from './campaign-styles';
import { contacts } from './contacts';
import { dealers } from './dealers';
import { salesLeadSources } from './sales-lead-sources';

export const campaignStatus = pgEnum('campaign_status', [
  'draft',
  'booked',
  'cancelled',
  'completed',
]);

export const campaigns = pgTable(
  'campaigns',
  {
    id: bigIdentity(),
    publicId: text('public_id').notNull().unique(),
    dealerId: bigint('dealer_id', { mode: 'number' })
      .notNull()
      .references(() => dealers.id, { onDelete: 'restrict' }),
    coachId: bigint('coach_id', { mode: 'number' }).references(() => contacts.id, {
      onDelete: 'set null',
    }),
    styleId: bigint('style_id', { mode: 'number' }).references(() => campaignStyles.id),
    salesLeadSourceId: bigint('sales_lead_source_id', { mode: 'number' }).references(
      () => salesLeadSources.id
    ),
    startDate: date('start_date').notNull(),
    endDate: date('end_date').notNull(),
    qtyRecords: integer('qty_records'),
    smsEmail: integer('sms_email'),
    letters: integer('letters'),
    bdc: integer('bdc'),
    contact: text('contact'),
    phone: text('phone'),
    email: text('email'),
    notes: text('notes'),
    fee: numeric('fee', { precision: 10, scale: 2 }).notNull().default('0'),
    travel: numeric('travel', { precision: 10, scale: 2 }).notNull().default('0'),
    depositPct: numeric('deposit_pct', { precision: 5, scale: 2 }).notNull().default('0'),
    taxPct: numeric('tax_pct', { precision: 5, scale: 2 }).notNull().default('15'),
    quoteValidDays: integer('quote_valid_days').notNull().default(30),
    quoteNotes: text('quote_notes'),
    status: campaignStatus('status').notNull().default('draft'),
    ...timestamps,
    ...actors,
  },
  (table) => [
    index('campaigns_dealer_id_idx').on(table.dealerId),
    index('campaigns_coach_id_idx').on(table.coachId),
    index('campaigns_style_id_idx').on(table.styleId),
    index('campaigns_sales_lead_source_id_idx').on(table.salesLeadSourceId),
    index('campaigns_start_date_idx').on(table.startDate),
    index('campaigns_created_by_id_idx').on(table.createdById),
    index('campaigns_updated_by_id_idx').on(table.updatedById),
    check('campaigns_date_range_check', sql`${table.endDate} >= ${table.startDate}`),
  ]
);
