import 'server-only';

import { and, count, eq, or, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import {
  appointments,
  campaignBookingSettings,
  campaigns,
  smsRecipients,
} from '@/lib/db/schema';
import { isSlotInGrid } from './slots';

// The booking transaction (0108 Phase 2/5) — the domain half of the public
// book action, action-free so the integration suite can exercise it against
// real Postgres (same split as `sendThreadReply` in lib/sms/conversations).
// The unguessable token IS the gate: it must resolve to a recipient row before
// anything else runs, and every value the write uses derives from that row,
// never from the caller.

export type BookSlotOutcome =
  | 'ok'
  | 'already-booked'
  | 'slot-full'
  | 'unknown-token'
  | 'event-ended'
  | 'invalid-slot';

// Bookings only race other bookings — capacity + one-per-recipient are
// re-checked under this campaign-scoped lock, so two concurrent submits
// serialize. Distinct from the 'sms_launch_' key (imports/launches/mints).
async function lockCampaignBookingTx(
  tx: Parameters<Parameters<(typeof db)['transaction']>[0]>[0],
  campaignId: number,
) {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtext('booking_' || ${campaignId}::text))`,
  );
}

function isUniqueViolation(err: unknown): boolean {
  const code = (err as { code?: string; cause?: { code?: string } })?.code;
  const causeCode = (err as { cause?: { code?: string } })?.cause?.code;
  return code === '23505' || causeCode === '23505';
}

export async function bookSlot(input: {
  token: string;
  slotDate: string;
  slotStartMinute: number;
}): Promise<BookSlotOutcome> {
  const [target] = await db
    .select({
      recipientId: smsRecipients.id,
      campaignId: campaigns.id,
      firstName: smsRecipients.firstName,
      lastName: smsRecipients.lastName,
      phone: smsRecipients.phone,
      status: campaigns.status,
      startDate: campaigns.startDate,
      endDate: campaigns.endDate,
      dayStartMinute: campaignBookingSettings.dayStartMinute,
      dayEndMinute: campaignBookingSettings.dayEndMinute,
      slotCapacity: campaignBookingSettings.slotCapacity,
    })
    .from(smsRecipients)
    .innerJoin(campaigns, eq(campaigns.id, smsRecipients.campaignId))
    .innerJoin(
      campaignBookingSettings,
      eq(campaignBookingSettings.campaignId, campaigns.id),
    )
    .where(eq(smsRecipients.bookingToken, input.token))
    .limit(1);
  if (!target) return 'unknown-token';

  // Token lifetime: the link outlives the event but stops booking — the page
  // shows "this event has passed" (intent's lean call). Host-local date,
  // app-wide pattern (0097-a).
  if (target.status === 'cancelled') return 'event-ended';
  const now = new Date();
  const todayIso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  if (target.endDate < todayIso) return 'event-ended';

  if (!isSlotInGrid(target, { date: input.slotDate, startMinute: input.slotStartMinute })) {
    return 'invalid-slot';
  }

  try {
    return await db.transaction(async (tx): Promise<BookSlotOutcome> => {
      await lockCampaignBookingTx(tx, target.campaignId);

      const [existing] = await tx
        .select({ id: appointments.id })
        .from(appointments)
        .where(
          and(
            eq(appointments.status, 'booked'),
            or(
              eq(appointments.recipientId, target.recipientId),
              and(
                eq(appointments.campaignId, target.campaignId),
                eq(appointments.phone, target.phone),
              ),
            ),
          ),
        )
        .limit(1);
      if (existing) return 'already-booked';

      const [freshSettings] = await tx
        .select({
          dayStartMinute: campaignBookingSettings.dayStartMinute,
          dayEndMinute: campaignBookingSettings.dayEndMinute,
          slotCapacity: campaignBookingSettings.slotCapacity,
        })
        .from(campaignBookingSettings)
        .where(eq(campaignBookingSettings.campaignId, target.campaignId))
        .limit(1);
      if (!freshSettings) return 'invalid-slot';
      if (
        !isSlotInGrid(
          {
            startDate: target.startDate,
            endDate: target.endDate,
            dayStartMinute: freshSettings.dayStartMinute,
            dayEndMinute: freshSettings.dayEndMinute,
          },
          { date: input.slotDate, startMinute: input.slotStartMinute },
        )
      ) {
        return 'invalid-slot';
      }

      const [slotCount] = await tx
        .select({ booked: count() })
        .from(appointments)
        .where(
          and(
            eq(appointments.campaignId, target.campaignId),
            eq(appointments.slotDate, input.slotDate),
            eq(appointments.slotStartMinute, input.slotStartMinute),
            eq(appointments.status, 'booked'),
          ),
        );
      if ((slotCount?.booked ?? 0) >= freshSettings.slotCapacity) return 'slot-full';

      // Snapshot the recipient's name/phone: the appointment must survive the
      // 24-month recipient purge. Actors stay null — no user on the public path.
      await tx.insert(appointments).values({
        campaignId: target.campaignId,
        recipientId: target.recipientId,
        slotDate: input.slotDate,
        slotStartMinute: input.slotStartMinute,
        firstName: target.firstName,
        lastName: target.lastName,
        phone: target.phone,
      });
      return 'ok';
    });
  } catch (err) {
    // Race backstop tripped (appointments_recipient_booked_unique) — treat as
    // the double-submit it is.
    if (isUniqueViolation(err)) return 'already-booked';
    throw err;
  }
}
