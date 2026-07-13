import { sql } from 'drizzle-orm';
import { check, pgEnum, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { actors, bigIdentity, timestamps } from './_columns';

export const smsOptOutSource = pgEnum('sms_opt_out_source', ['stop_reply', 'manual']);

// PERMANENT global opt-out registry keyed by phone number (0103 D2/D5).
// Deliberately campaign- and dealer-agnostic: a STOP means "this number never
// gets texted by us again", enforced on every send across all campaigns. Rows
// are never purged — this is OUR compliance obligation, not dealer data (a
// bare phone number, no name), and it must outlive the 24-month recipient
// purge or a re-imported person could be texted after saying stop. `actors`
// covers the `manual` source (staff-recorded); `stop_reply` rows are
// webhook-written with null actors and the inbound SID as evidence.
export const smsOptOuts = pgTable(
  'sms_opt_outs',
  {
    id: bigIdentity(),
    phone: text('phone').notNull().unique(),
    source: smsOptOutSource('source').notNull(),
    optedOutAt: timestamp('opted_out_at', { withTimezone: true }).notNull().defaultNow(),
    // Twilio SID of the inbound STOP message, when source is stop_reply.
    providerMessageSid: text('provider_message_sid'),
    ...timestamps,
    ...actors,
  },
  (table) => [
    check('sms_opt_outs_phone_e164_check', sql`phone ~ '^\\+[1-9][0-9]{6,14}$'`),
  ]
);
