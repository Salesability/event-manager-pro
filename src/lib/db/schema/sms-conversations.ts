import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { actors, bigIdentity, timestamps } from './_columns';
import { campaigns } from './campaigns';
import { smsMessageStatus } from './sms-messages';

// A conversation thread is a (campaign, phone) pair (0106 D2) — per-campaign
// even though all campaigns share one sender, so the same number talking about
// two events is two threads. Created by the webhook on the first non-STOP
// inbound; attribution defaults to the campaign that most recently texted the
// number and staff can reassign (campaign_id is mutable, D2). Campaign FK is
// RESTRICT like `sms_sends` — threads are part of the conversation ledger and
// outlive campaign cleanup. `last_*` columns are denormalized by the writers
// so the thread list can sort + badge unread without aggregating messages;
// unread = last_inbound_at > coalesce(last_read_at, -infinity). Machine rows
// (webhook) carry null actors; staff mutations (reassign, mark-read) stamp them.
export const smsThreads = pgTable(
  'sms_threads',
  {
    id: bigIdentity(),
    campaignId: bigint('campaign_id', { mode: 'number' })
      .notNull()
      .references(() => campaigns.id, { onDelete: 'restrict' }),
    // E.164, same normalization as the rest of the SMS family.
    phone: text('phone').notNull(),
    lastMessageAt: timestamp('last_message_at', { withTimezone: true }).notNull().defaultNow(),
    lastInboundAt: timestamp('last_inbound_at', { withTimezone: true }),
    // Single global read pointer (v1, small team) — not per-staff read state.
    lastReadAt: timestamp('last_read_at', { withTimezone: true }),
    ...timestamps,
    ...actors,
  },
  (table) => [
    uniqueIndex('sms_threads_campaign_phone_unique').on(table.campaignId, table.phone),
    index('sms_threads_campaign_id_idx').on(table.campaignId),
    // Inbound attribution looks the number up across campaigns.
    index('sms_threads_phone_idx').on(table.phone),
    index('sms_threads_created_by_id_idx').on(table.createdById),
    index('sms_threads_updated_by_id_idx').on(table.updatedById),
    check('sms_threads_phone_e164_check', sql`phone ~ '^\\+[1-9][0-9]{6,14}$'`),
  ]
);

export const smsThreadMessageDirection = pgEnum('sms_thread_message_direction', [
  'inbound',
  'outbound',
]);

// One row per conversation message, either direction. Unlike `sms_messages`
// (the body-less campaign-send ledger), the BODY lives here — a conversation
// is unreadable without it. Delivery `status` is the Twilio lifecycle for
// outbound replies (same monotonic flips as `sms_messages`, driven by the
// status webhook via provider_sid) and NULL for inbound, CHECK-enforced.
// Inbound rows are webhook-written (null actors); outbound rows stamp the
// staff sender via `created_by_id`. `ai_drafted` records that an outbound
// reply originated as an approved AI draft (0106 D1/D4 — provenance only, no
// disclosure tag in the body).
export const smsThreadMessages = pgTable(
  'sms_thread_messages',
  {
    id: bigIdentity(),
    threadId: bigint('thread_id', { mode: 'number' })
      .notNull()
      .references(() => smsThreads.id, { onDelete: 'restrict' }),
    direction: smsThreadMessageDirection('direction').notNull(),
    body: text('body').notNull(),
    // Twilio message SID (SM…/MM…), both directions. Null when an outbound
    // create call itself failed; partial-unique like `sms_messages`.
    providerSid: text('provider_sid'),
    status: smsMessageStatus('status'),
    // Twilio error code when an outbound reply fails/undelivers.
    errorCode: text('error_code'),
    statusUpdatedAt: timestamp('status_updated_at', { withTimezone: true }),
    aiDrafted: boolean('ai_drafted').notNull().default(false),
    ...timestamps,
    ...actors,
  },
  (table) => [
    uniqueIndex('sms_thread_messages_provider_sid_unique')
      .on(table.providerSid)
      .where(sql`provider_sid IS NOT NULL`),
    index('sms_thread_messages_thread_id_idx').on(table.threadId),
    index('sms_thread_messages_created_by_id_idx').on(table.createdById),
    index('sms_thread_messages_updated_by_id_idx').on(table.updatedById),
    check(
      'sms_thread_messages_status_direction_check',
      sql`(direction = 'inbound' AND status IS NULL) OR (direction = 'outbound' AND status IS NOT NULL)`
    ),
  ]
);
