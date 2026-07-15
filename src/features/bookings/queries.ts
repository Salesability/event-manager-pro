import 'server-only';

import { and, asc, count, eq, isNotNull, or, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import {
  appointments,
  campaignBookingSettings,
  campaigns,
  dealers,
  smsRecipients,
} from '@/lib/db/schema';
import { deriveSlotGrid, type SlotRef } from './slots';

// Read models for the booking surface (0108 Phase 2): the public token page
// and the staff per-event panel. Slots are derived from the campaign's booking
// settings at read time (slots.ts) and decorated with live booked counts.

export type SlotAvailability = SlotRef & {
  capacity: number;
  booked: number;
  isFull: boolean;
};

export type BookingContext = {
  recipientId: number;
  campaignId: number;
  firstName: string | null;
  lastName: string | null;
  phone: string;
  dealerName: string;
  startDate: string;
  endDate: string;
  /** The event's last day is behind today (host-local, app-wide pattern) —
   * the token still resolves, the page shows "this event has passed". */
  eventEnded: boolean;
  slots: SlotAvailability[];
  /** The recipient's live appointment, if any — one per recipient. */
  existingAppointment: { slotDate: string; slotStartMinute: number } | null;
};

// Host-process-local calendar date, matching `production/filter.ts` & friends
// (0097-a: business-timezone handling is a deliberate app-wide pass, not
// something the booking page fixes alone).
function todayIso(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

/** Resolve a booking token to everything the public page needs. Null for an
 * unknown token OR a campaign whose booking settings were never created —
 * both render as not-found, never a login redirect. */
export async function loadBookingContext(token: string): Promise<BookingContext | null> {
  if (!token) return null;

  const [row] = await db
    .select({
      recipientId: smsRecipients.id,
      campaignId: campaigns.id,
      firstName: smsRecipients.firstName,
      lastName: smsRecipients.lastName,
      phone: smsRecipients.phone,
      dealerName: dealers.name,
      status: campaigns.status,
      startDate: campaigns.startDate,
      endDate: campaigns.endDate,
      dayStartMinute: campaignBookingSettings.dayStartMinute,
      dayEndMinute: campaignBookingSettings.dayEndMinute,
      slotCapacity: campaignBookingSettings.slotCapacity,
    })
    .from(smsRecipients)
    .innerJoin(campaigns, eq(campaigns.id, smsRecipients.campaignId))
    .innerJoin(dealers, eq(dealers.id, campaigns.dealerId))
    .innerJoin(
      campaignBookingSettings,
      eq(campaignBookingSettings.campaignId, campaigns.id),
    )
    .where(eq(smsRecipients.bookingToken, token))
    .limit(1);
  if (!row) return null;

  const [slots, [existing]] = await Promise.all([
    loadSlotAvailability(row.campaignId, {
      startDate: row.startDate,
      endDate: row.endDate,
      dayStartMinute: row.dayStartMinute,
      dayEndMinute: row.dayEndMinute,
      slotCapacity: row.slotCapacity,
    }),
    db
      .select({
        slotDate: appointments.slotDate,
        slotStartMinute: appointments.slotStartMinute,
      })
      .from(appointments)
      .where(
        and(
          eq(appointments.status, 'booked'),
          or(
            eq(appointments.recipientId, row.recipientId),
            // Phone arm keeps a re-imported recipient's booked state visible.
            and(eq(appointments.campaignId, row.campaignId), eq(appointments.phone, row.phone)),
          ),
        ),
      )
      .limit(1),
  ]);

  return {
    recipientId: row.recipientId,
    campaignId: row.campaignId,
    firstName: row.firstName,
    lastName: row.lastName,
    phone: row.phone,
    dealerName: row.dealerName,
    startDate: row.startDate,
    endDate: row.endDate,
    // Cancelled campaigns read as ended on the public page.
    eventEnded: row.status === 'cancelled' || row.endDate < todayIso(),
    slots,
    existingAppointment: existing ?? null,
  };
}

export type BookingSettings = {
  dayStartMinute: number;
  dayEndMinute: number;
  slotCapacity: number;
};

export type AppointmentListItem = {
  id: number;
  slotDate: string;
  slotStartMinute: number;
  firstName: string | null;
  lastName: string | null;
  phone: string;
  status: 'booked' | 'cancelled';
  createdAt: Date;
};

export type RecipientBookingLink = {
  recipientId: number;
  firstName: string | null;
  lastName: string | null;
  phone: string;
  /** Path only (`/book/<token>`) — the panel prefixes the origin at copy time. */
  bookingPath: string;
};

export type CampaignBookingOverview = {
  /** Null until booking is enabled for the campaign. */
  settings: BookingSettings | null;
  /** How many of the campaign's recipients hold a booking token. */
  tokensMinted: number;
  totalRecipients: number;
  slots: SlotAvailability[];
  appointments: AppointmentListItem[];
  /** Every token-holding recipient's shareable link — this chunk ships with
   * links handed out manually (the `{{booking_link}}` send token is chunk 2). */
  recipientLinks: RecipientBookingLink[];
};

/** Staff read model for the per-event booking panel (Phase 4): settings +
 * grid-with-counts + the appointment list (cancelled rows included — the
 * ledger view, like the send log). */
export async function loadCampaignBookingOverview(
  campaignId: number,
): Promise<CampaignBookingOverview> {
  const [campaign] = await db
    .select({
      startDate: campaigns.startDate,
      endDate: campaigns.endDate,
      dayStartMinute: campaignBookingSettings.dayStartMinute,
      dayEndMinute: campaignBookingSettings.dayEndMinute,
      slotCapacity: campaignBookingSettings.slotCapacity,
    })
    .from(campaigns)
    .leftJoin(
      campaignBookingSettings,
      eq(campaignBookingSettings.campaignId, campaigns.id),
    )
    .where(eq(campaigns.id, campaignId))
    .limit(1);

  const settings =
    campaign && campaign.slotCapacity != null
      ? {
          dayStartMinute: campaign.dayStartMinute!,
          dayEndMinute: campaign.dayEndMinute!,
          slotCapacity: campaign.slotCapacity,
        }
      : null;

  const [tokenCounts, slots, appointmentRows, linkRows] = await Promise.all([
    db
      .select({
        total: count(),
        minted: count(sql`case when ${isNotNull(smsRecipients.bookingToken)} then 1 end`),
      })
      .from(smsRecipients)
      .where(eq(smsRecipients.campaignId, campaignId)),
    campaign && settings
      ? loadSlotAvailability(campaignId, {
          startDate: campaign.startDate,
          endDate: campaign.endDate,
          ...settings,
        })
      : Promise.resolve([]),
    db
      .select({
        id: appointments.id,
        slotDate: appointments.slotDate,
        slotStartMinute: appointments.slotStartMinute,
        firstName: appointments.firstName,
        lastName: appointments.lastName,
        phone: appointments.phone,
        status: appointments.status,
        createdAt: appointments.createdAt,
      })
      .from(appointments)
      .where(eq(appointments.campaignId, campaignId))
      .orderBy(asc(appointments.slotDate), asc(appointments.slotStartMinute)),
    db
      .select({
        recipientId: smsRecipients.id,
        firstName: smsRecipients.firstName,
        lastName: smsRecipients.lastName,
        phone: smsRecipients.phone,
        bookingToken: smsRecipients.bookingToken,
      })
      .from(smsRecipients)
      .where(
        and(eq(smsRecipients.campaignId, campaignId), isNotNull(smsRecipients.bookingToken)),
      )
      .orderBy(asc(smsRecipients.lastName), asc(smsRecipients.firstName)),
  ]);

  return {
    settings,
    tokensMinted: tokenCounts[0]?.minted ?? 0,
    totalRecipients: tokenCounts[0]?.total ?? 0,
    slots,
    appointments: appointmentRows,
    recipientLinks: linkRows.map((r) => ({
      recipientId: r.recipientId,
      firstName: r.firstName,
      lastName: r.lastName,
      phone: r.phone,
      bookingPath: `/book/${encodeURIComponent(r.bookingToken!)}`,
    })),
  };
}

// Grid + live booked counts. Counts only `booked` rows — a cancellation frees
// the seat (same predicate the book action re-checks under lock).
async function loadSlotAvailability(
  campaignId: number,
  settings: BookingSettings & { startDate: string; endDate: string },
): Promise<SlotAvailability[]> {
  const counts = await db
    .select({
      slotDate: appointments.slotDate,
      slotStartMinute: appointments.slotStartMinute,
      booked: count(),
    })
    .from(appointments)
    .where(and(eq(appointments.campaignId, campaignId), eq(appointments.status, 'booked')))
    .groupBy(appointments.slotDate, appointments.slotStartMinute);

  const bookedBySlot = new Map(
    counts.map((c) => [`${c.slotDate}#${c.slotStartMinute}`, c.booked]),
  );
  return deriveSlotGrid(settings).map((slot) => {
    const booked = bookedBySlot.get(`${slot.date}#${slot.startMinute}`) ?? 0;
    return {
      ...slot,
      capacity: settings.slotCapacity,
      booked,
      isFull: booked >= settings.slotCapacity,
    };
  });
}
