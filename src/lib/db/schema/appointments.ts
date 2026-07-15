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
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { actors, bigIdentity, timestamps } from './_columns';
import { campaigns } from './campaigns';
import { smsRecipients } from './sms-recipients';

// Per-campaign booking settings (0108). Slots are DERIVED, not materialized:
// enabling booking creates this row, and the bookable grid is computed at read
// time as half-hour slots (fixed length, code constant) across each campaign
// day within [day_start_minute, day_end_minute). No slot rows to regenerate
// when campaign dates shift. Capacity is per campaign, not per dealer — it
// tracks event staffing (coach + the dealer's own sales staff), which varies
// per event even at the same dealer (owner call 2026-07-14). Minutes are
// local-of-the-event wall-clock offsets from midnight, matching the app-wide
// "dates are local `date` columns" pattern — no timezone math in the grid.
export const campaignBookingSettings = pgTable(
  'campaign_booking_settings',
  {
    id: bigIdentity(),
    campaignId: bigint('campaign_id', { mode: 'number' })
      .notNull()
      .references(() => campaigns.id, { onDelete: 'cascade' }),
    // Bookable day window, minutes from midnight. Defaults 9:00–17:00 (Claude
    // default, owner-editable per campaign — cheap to change).
    dayStartMinute: integer('day_start_minute').notNull().default(540),
    dayEndMinute: integer('day_end_minute').notNull().default(1020),
    // How many concurrent appointments one slot can hold.
    slotCapacity: integer('slot_capacity').notNull(),
    ...timestamps,
    ...actors,
  },
  (table) => [
    uniqueIndex('campaign_booking_settings_campaign_id_unique').on(table.campaignId),
    index('campaign_booking_settings_created_by_id_idx').on(table.createdById),
    index('campaign_booking_settings_updated_by_id_idx').on(table.updatedById),
    check(
      'campaign_booking_settings_window_check',
      sql`day_start_minute >= 0 AND day_end_minute <= 1440 AND day_end_minute > day_start_minute`
    ),
    // Half-hour grid alignment — slot length is a fixed 30-min code constant.
    check(
      'campaign_booking_settings_half_hour_check',
      sql`day_start_minute % 30 = 0 AND day_end_minute % 30 = 0`
    ),
    check('campaign_booking_settings_capacity_check', sql`slot_capacity >= 1`),
  ]
);

export const appointmentStatus = pgEnum('appointment_status', ['booked', 'cancelled']);

// A customer's booked slot (0108) — the first durable customer-intent record
// in the app. Campaign FK is RESTRICT like `sms_sends`: appointments are part
// of the funnel ledger and outlive campaign cleanup. Recipient FK is SET NULL
// because `sms_recipients` rows hard-delete 24 months after import (0103 D5),
// so the customer's name/phone are SNAPSHOT here at booking time rather than
// read through the FK. Slot identity is (slot_date, slot_start_minute) against
// the campaign's derived grid — no slot table to point at. Booked via the
// public token page (null actors, like webhook-written SMS rows); staff
// mutations stamp actors. `cancelled` frees the slot seat and the recipient's
// one-live-booking allowance (both predicates filter on status = 'booked').
export const appointments = pgTable(
  'appointments',
  {
    id: bigIdentity(),
    campaignId: bigint('campaign_id', { mode: 'number' })
      .notNull()
      .references(() => campaigns.id, { onDelete: 'restrict' }),
    recipientId: bigint('recipient_id', { mode: 'number' }).references(() => smsRecipients.id, {
      onDelete: 'set null',
    }),
    slotDate: date('slot_date').notNull(),
    slotStartMinute: integer('slot_start_minute').notNull(),
    // Snapshot of the recipient at booking time; nullable names mirror
    // `sms_recipients` (dealer lists can be single-token or blank).
    firstName: text('first_name'),
    lastName: text('last_name'),
    // E.164, same normalization as the rest of the SMS family.
    phone: text('phone').notNull(),
    status: appointmentStatus('status').notNull().default('booked'),
    ...timestamps,
    ...actors,
  },
  (table) => [
    // One LIVE appointment per recipient — the book action checks first; this
    // is the race backstop (two tabs, double-submit).
    uniqueIndex('appointments_recipient_booked_unique')
      .on(table.recipientId)
      .where(sql`recipient_id IS NOT NULL AND status = 'booked'`),
    // Grid availability counts by (campaign, slot); leading column covers the
    // campaign FK index requirement.
    index('appointments_campaign_slot_idx').on(
      table.campaignId,
      table.slotDate,
      table.slotStartMinute
    ),
    index('appointments_recipient_id_idx').on(table.recipientId),
    index('appointments_created_by_id_idx').on(table.createdById),
    index('appointments_updated_by_id_idx').on(table.updatedById),
    check(
      'appointments_slot_minute_check',
      sql`slot_start_minute >= 0 AND slot_start_minute < 1440 AND slot_start_minute % 30 = 0`
    ),
    check('appointments_phone_e164_check', sql`phone ~ '^\\+[1-9][0-9]{6,14}$'`),
  ]
);
