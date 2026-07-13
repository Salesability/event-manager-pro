import { bigint, index, integer, pgTable, text } from 'drizzle-orm/pg-core';
import { actors, bigIdentity, timestamps } from './_columns';
import { campaigns } from './campaigns';

// One row per launch (0103). The message BODY lives here — stored once as the
// template with personalization variables (e.g. {{first_name}}), never
// re-rendered per recipient into `sms_messages` — so the permanent ledger
// carries no customer names after the 24-month recipient purge (D5). A row is
// created at launch time: `created_at`/`created_by_id` are the launch
// timestamp/actor. Campaign FK is RESTRICT — sends are part of the compliance
// ledger and must outlive any campaign cleanup.
//
// The three exclusion counts snapshot the pre-send review summary (how many
// recipients the compliance floor removed) so the ledger can show what was
// excluded and why, even after the recipient rows themselves are purged.
export const smsSends = pgTable(
  'sms_sends',
  {
    id: bigIdentity(),
    campaignId: bigint('campaign_id', { mode: 'number' })
      .notNull()
      .references(() => campaigns.id, { onDelete: 'restrict' }),
    body: text('body').notNull(),
    totalRecipients: integer('total_recipients').notNull(),
    excludedOptOut: integer('excluded_opt_out').notNull(),
    excludedStaleConsent: integer('excluded_stale_consent').notNull(),
    ...timestamps,
    ...actors,
  },
  (table) => [
    index('sms_sends_campaign_id_idx').on(table.campaignId),
    index('sms_sends_created_by_id_idx').on(table.createdById),
    index('sms_sends_updated_by_id_idx').on(table.updatedById),
  ]
);
