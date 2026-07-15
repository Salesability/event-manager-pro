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
    // 0105: keyed identity fingerprint (HMAC-SHA256 over normalized name +
    // phone, `src/lib/sms/identity.ts`). Verification-only — lets a re-import
    // after the 24-month purge confirm person-continuity on a phone number
    // without the ledger ever holding a readable name. Null when
    // SMS_IDENTITY_HMAC_KEY is unset (feature degrades gracefully).
    identityHmac: text('identity_hmac'),
    // 0108: unguessable token gating the public /book/<token> page. Higher
    // entropy than display publicIds (≥16 random bytes, base64url) — it
    // resolves to this recipient's PII and authorizes a booking write. Null
    // until minted (booking enabled for the campaign). Dies with the row at
    // the 24-month purge; the appointment it produced snapshots name/phone
    // and survives via `appointments.recipient_id` SET NULL.
    bookingToken: text('booking_token'),
    ...timestamps,
    ...actors,
  },
  (table) => [
    uniqueIndex('sms_recipients_campaign_phone_unique').on(table.campaignId, table.phone),
    // Token lookup is the public page's entry point; partial like
    // `sms_thread_messages.provider_sid` (most rows have no token).
    uniqueIndex('sms_recipients_booking_token_unique')
      .on(table.bookingToken)
      .where(sql`booking_token IS NOT NULL`),
    index('sms_recipients_campaign_id_idx').on(table.campaignId),
    // The 24-month retention purge filters on import date (D5).
    index('sms_recipients_created_at_idx').on(table.createdAt),
    index('sms_recipients_created_by_id_idx').on(table.createdById),
    index('sms_recipients_updated_by_id_idx').on(table.updatedById),
    check('sms_recipients_phone_e164_check', sql`phone ~ '^\\+[1-9][0-9]{6,14}$'`),
  ]
);
