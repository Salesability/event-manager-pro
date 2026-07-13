import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  date,
  index,
  pgEnum,
  pgTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { actors, bigIdentity, timestamps } from './_columns';
import { campaigns } from './campaigns';

// CASL consent basis for a dealer-supplied recipient (0103 D2/D3). Implied
// consent lapses — 2 years from a purchase/contract, 6 months from an inquiry,
// measured against `last_contact_at`; express consent has no expiry. The
// windows are fixed constants in the eligibility predicate, not schema.
export const smsConsentBasis = pgEnum('sms_consent_basis', [
  'express',
  'implied_purchase',
  'implied_inquiry',
]);

// Per-campaign import of the DEALER's contact list (0103 D2). Not first-class
// contact records — the list belongs to the dealer, is scoped to one campaign,
// and is retention-bound: rows are hard-deleted 24 months after import
// (`created_at`, D5), so nothing else may FK to a recipient without tolerating
// deletion (`sms_messages.recipient_id` is SET NULL).
export const smsRecipients = pgTable(
  'sms_recipients',
  {
    id: bigIdentity(),
    campaignId: bigint('campaign_id', { mode: 'number' })
      .notNull()
      .references(() => campaigns.id, { onDelete: 'cascade' }),
    // E.164 (+1902…); normalised at import time, CHECK-guarded below.
    phone: text('phone').notNull(),
    firstName: text('first_name'),
    lastName: text('last_name'),
    consentBasis: smsConsentBasis('consent_basis').notNull(),
    // Date of the last dealer↔customer contact/transaction — what the implied-
    // consent window is measured from. Nullable: an implied-basis row without
    // it is treated as stale by the eligibility predicate (never sendable),
    // not rejected at import, so the pre-send summary can report it.
    lastContactAt: date('last_contact_at'),
    ...timestamps,
    ...actors,
  },
  (table) => [
    uniqueIndex('sms_recipients_campaign_phone_unique').on(table.campaignId, table.phone),
    index('sms_recipients_campaign_id_idx').on(table.campaignId),
    // The 24-month retention purge filters on import date (D5).
    index('sms_recipients_created_at_idx').on(table.createdAt),
    index('sms_recipients_created_by_id_idx').on(table.createdById),
    index('sms_recipients_updated_by_id_idx').on(table.updatedById),
    check('sms_recipients_phone_e164_check', sql`phone ~ '^\\+[1-9][0-9]{6,14}$'`),
  ]
);
