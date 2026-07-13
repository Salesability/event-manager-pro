import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { bigIdentity, timestamps } from './_columns';
import { smsRecipients } from './sms-recipients';
import { smsSends } from './sms-sends';

// Twilio's message lifecycle as reported by status callbacks. `queued` is the
// row's initial state (accepted by Twilio, not yet handed to a carrier);
// `undelivered` is Twilio's carrier-rejected terminal state, distinct from
// `failed` (Twilio couldn't send at all).
export const smsMessageStatus = pgEnum('sms_message_status', [
  'queued',
  'sent',
  'delivered',
  'undelivered',
  'failed',
]);

// The permanent per-message ledger (0103 D5) — the CASL defense record
// ("texted this number on this date, delivered, STOP honored"). Survives the
// 24-month recipient purge: `recipient_id` goes NULL when its recipient row is
// deleted, and `phone` is snapshotted at send time so the ledger stays
// self-sufficient. The body is NOT here — it lives once on `sms_sends` (no
// customer names linger post-purge). Rows are machine-written (launch loop +
// webhook), so no `actors` — the launch actor is on the parent send.
export const smsMessages = pgTable(
  'sms_messages',
  {
    id: bigIdentity(),
    sendId: bigint('send_id', { mode: 'number' })
      .notNull()
      .references(() => smsSends.id, { onDelete: 'restrict' }),
    recipientId: bigint('recipient_id', { mode: 'number' }).references(
      () => smsRecipients.id,
      { onDelete: 'set null' }
    ),
    // E.164 snapshot at send time (redirected target in non-prod).
    phone: text('phone').notNull(),
    // Twilio message SID (SM…). Null when the create call itself failed —
    // there's nothing to correlate a callback to; partial-unique like
    // `master_service_agreements.provider_document_id`'s usage.
    providerSid: text('provider_sid'),
    status: smsMessageStatus('status').notNull().default('queued'),
    // Twilio error code (e.g. 30007 carrier filtering) when status is
    // failed/undelivered, or the thrown create-call message.
    errorCode: text('error_code'),
    statusUpdatedAt: timestamp('status_updated_at', { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('sms_messages_provider_sid_unique')
      .on(table.providerSid)
      .where(sql`provider_sid IS NOT NULL`),
    index('sms_messages_send_id_idx').on(table.sendId),
    index('sms_messages_recipient_id_idx').on(table.recipientId),
    // Inbound STOP correlation + per-number history reads.
    index('sms_messages_phone_idx').on(table.phone),
    check('sms_messages_phone_e164_check', sql`phone ~ '^\\+[1-9][0-9]{6,14}$'`),
  ]
);
