import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  date,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { actors, bigIdentity, timestamps } from './_columns';
import { campaignStyles } from './campaign-styles';
import { contacts } from './contacts';
import { dealers } from './dealers';
import { audienceSources } from './audience-sources';
import { quotes } from './quotes';

export const campaignStatus = pgEnum('campaign_status', [
  'draft',
  'booked',
  'cancelled',
  'completed',
]);

// Best-effort Google Calendar projection state (0077). The app is the source of
// truth and is never blocked by a Google failure (decision.md §6): a booked
// campaign starts `pending`, flips to `synced` on a successful push (recording
// `gcal_synced_at`) or `failed` on a Google error, and an edit drops it back to
// `pending`. The admin "needs sync" list + manual re-sync filter on this.
export const campaignGcalSyncStatus = pgEnum('campaign_gcal_sync_status', [
  'pending',
  'synced',
  'failed',
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
    audienceSourceId: bigint('audience_source_id', { mode: 'number' }).references(
      () => audienceSources.id
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
    quoteNotes: text('quote_notes'),
    acceptedQuoteId: bigint('accepted_quote_id', { mode: 'number' }).references(
      () => quotes.id,
      { onDelete: 'restrict' }
    ),
    status: campaignStatus('status').notNull().default('draft'),
    // Google Calendar projection (0077). `gcalEventId` is the durable link to
    // the projected event (nullable: unset until the first successful push, like
    // dealers.quickbooks_id / quotes.quickbooks_estimate_id). `gcalSyncStatus` +
    // `gcalSyncedAt` track best-effort sync state. Coach colour is NOT stored —
    // it's derived from coach id at map time (coachGcalColorId).
    gcalEventId: text('gcal_event_id'),
    gcalSyncStatus: campaignGcalSyncStatus('gcal_sync_status').notNull().default('pending'),
    gcalSyncedAt: timestamp('gcal_synced_at', { withTimezone: true }),
    ...timestamps,
    ...actors,
  },
  (table) => [
    index('campaigns_dealer_id_idx').on(table.dealerId),
    index('campaigns_coach_id_idx').on(table.coachId),
    index('campaigns_style_id_idx').on(table.styleId),
    index('campaigns_audience_source_id_idx').on(table.audienceSourceId),
    index('campaigns_accepted_quote_id_idx').on(table.acceptedQuoteId),
    index('campaigns_start_date_idx').on(table.startDate),
    index('campaigns_created_by_id_idx').on(table.createdById),
    index('campaigns_updated_by_id_idx').on(table.updatedById),
    // One campaign per projected event (and vice-versa) — partial unique so the
    // many unlinked NULLs stay out of the constraint (cf. dealers.quickbooks_id).
    uniqueIndex('campaigns_gcal_event_id_idx')
      .on(table.gcalEventId)
      .where(sql`${table.gcalEventId} IS NOT NULL`),
    check('campaigns_date_range_check', sql`${table.endDate} >= ${table.startDate}`),
  ]
);
