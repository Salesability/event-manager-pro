'use server';

import { randomBytes } from 'crypto';
import { and, count, eq, isNull, sql } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { recordAudit } from '@/features/audit/actions';
import { capabilityClient, formDataSchema } from '@/lib/actions/action-client';
import { db } from '@/lib/db';
import {
  appointments,
  campaignBookingSettings,
  campaigns,
  smsRecipients,
} from '@/lib/db/schema';
import { isSlotInGrid, SLOT_LENGTH_MINUTES } from './slots';

// Booking domain actions (0108 Phase 2): the public book action the
// /book/<token> page posts to, and the staff settings/token-mint action the
// per-event panel calls. Staff surfaces re-render via /calendar.

// Same idiom as `generatePublicId` (schedule/actions.ts) with bumped entropy:
// this token resolves to a customer's PII and authorizes a booking write, not
// a display-only share id. 18 bytes → 24 url-safe chars, unguessable.
const generateBookingToken = () => randomBytes(18).toString('base64url');

// Bookings only race other bookings — capacity + one-per-recipient are
// re-checked under this campaign-scoped lock, so two concurrent submits
// serialize. Distinct from the 'sms_launch_' key (imports/launches).
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

const bookInputSchema = z.object({
  token: z.string().trim().min(1).max(200),
  slotDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid slot date.'),
  slotStartMinute: z.coerce
    .number()
    .int()
    .min(0)
    .max(1440 - SLOT_LENGTH_MINUTES)
    .refine((m) => m % SLOT_LENGTH_MINUTES === 0, 'Off-grid slot time.'),
});

type BookOutcome = 'ok' | 'already-booked' | 'slot-full';

// The unguessable token IS the gate (like the /share/coach pages): it must
// resolve to a recipient row before anything else runs, and every value the
// write uses derives from that row, never from the caller. Results travel as
// redirects back to the token page (no client JS on the public surface):
// success + already-booked re-render as the booked state; refusals carry
// ?error= for the page to surface. Opt-out does NOT block booking — STOP
// halts SMS, not the customer's own web self-serve.
// authz: public
export async function bookAppointment(formData: FormData) {
  const parsed = bookInputSchema.safeParse({
    token: formData.get('token'),
    slotDate: formData.get('slotDate'),
    slotStartMinute: formData.get('slotStartMinute'),
  });
  if (!parsed.success) {
    const token = String(formData.get('token') ?? '').trim();
    if (!token) redirect('/');
    redirect(`/book/${encodeURIComponent(token)}?error=invalid`);
  }
  const { token, slotDate, slotStartMinute } = parsed.data;
  const back = (query = '') => `/book/${encodeURIComponent(token)}${query}`;

  const [target] = await db
    .select({
      recipientId: smsRecipients.id,
      campaignId: campaigns.id,
      firstName: smsRecipients.firstName,
      lastName: smsRecipients.lastName,
      phone: smsRecipients.phone,
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
    .where(eq(smsRecipients.bookingToken, token))
    .limit(1);
  // Unknown token → the page itself 404s; don't leak validity via the action.
  if (!target) redirect(back());

  // Token lifetime: the link outlives the event but stops booking — the page
  // shows "this event has passed" (intent's lean call).
  const now = new Date();
  const todayIso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  if (target.endDate < todayIso) redirect(back());

  if (!isSlotInGrid(target, { date: slotDate, startMinute: slotStartMinute })) {
    redirect(back('?error=invalid'));
  }

  let outcome: BookOutcome;
  try {
    outcome = await db.transaction(async (tx): Promise<BookOutcome> => {
      await lockCampaignBookingTx(tx, target.campaignId);

      const [existing] = await tx
        .select({ id: appointments.id })
        .from(appointments)
        .where(
          and(
            eq(appointments.recipientId, target.recipientId),
            eq(appointments.status, 'booked'),
          ),
        )
        .limit(1);
      if (existing) return 'already-booked';

      const [slotCount] = await tx
        .select({ booked: count() })
        .from(appointments)
        .where(
          and(
            eq(appointments.campaignId, target.campaignId),
            eq(appointments.slotDate, slotDate),
            eq(appointments.slotStartMinute, slotStartMinute),
            eq(appointments.status, 'booked'),
          ),
        );
      if ((slotCount?.booked ?? 0) >= target.slotCapacity) return 'slot-full';

      // Snapshot the recipient's name/phone: the appointment must survive the
      // 24-month recipient purge. Actors stay null — no user on the public path.
      await tx.insert(appointments).values({
        campaignId: target.campaignId,
        recipientId: target.recipientId,
        slotDate,
        slotStartMinute,
        firstName: target.firstName,
        lastName: target.lastName,
        phone: target.phone,
      });
      return 'ok';
    });
  } catch (err) {
    // Race backstop tripped (appointments_recipient_booked_unique) — treat as
    // the double-submit it is.
    if (isUniqueViolation(err)) {
      outcome = 'already-booked';
    } else {
      throw err;
    }
  }

  if (outcome === 'slot-full') redirect(back('?error=full'));
  // Success and already-booked both land on the booked-state render.
  revalidatePath('/calendar');
  redirect(back());
}

const settingsSchema = z
  .object({
    campaignId: z.coerce.number().int().positive(),
    slotCapacity: z.coerce
      .number()
      .int()
      .min(1, 'Capacity must be at least 1.')
      .max(50, 'Capacity above 50 is almost certainly a typo.'),
    dayStartMinute: z.coerce.number().int().min(0).max(1410),
    dayEndMinute: z.coerce.number().int().min(30).max(1440),
  })
  .refine((v) => v.dayEndMinute > v.dayStartMinute, {
    message: 'The booking window must end after it starts.',
  })
  .refine((v) => v.dayStartMinute % 30 === 0 && v.dayEndMinute % 30 === 0, {
    message: 'Window times must land on the half hour.',
  });

export type SaveBookingSettingsResult =
  | { ok: true; tokensMinted: number }
  | { error: string };

// Enable-or-edit in one shape: upserts the campaign's booking settings and
// mints tokens for any recipients still missing one (idempotent — re-running
// after a list re-import tokenizes the new rows without touching held links).
// Gate matches the rest of the SMS family (`sms:send`) — the booking link
// rides the SMS campaign. (Intent's "who builds the grid" open question,
// resolved to the lean default; widening to coaches is a one-line change.)
export const saveCampaignBookingSettings = capabilityClient('sms:send')
  .schema(formDataSchema)
  .action(async ({ parsedInput: formData, ctx }): Promise<SaveBookingSettingsResult> => {
    const parsed = settingsSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) {
      return { error: parsed.error.issues[0]?.message ?? 'Invalid booking settings.' };
    }
    const { campaignId, slotCapacity, dayStartMinute, dayEndMinute } = parsed.data;

    const [campaign] = await db
      .select({ status: campaigns.status })
      .from(campaigns)
      .where(eq(campaigns.id, campaignId))
      .limit(1);
    if (!campaign) return { error: 'Campaign not found.' };
    if (campaign.status === 'cancelled') {
      return { error: 'Booking cannot be enabled on a cancelled campaign.' };
    }

    const userId = ctx.user.id;
    const tokensMinted = await db.transaction(async (tx) => {
      // Shares the campaign SMS lock key so a mint can't interleave with a
      // recipient re-import's delete + reinsert (sms/actions.ts).
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext('sms_launch_' || ${campaignId}::text))`,
      );

      await tx
        .insert(campaignBookingSettings)
        .values({
          campaignId,
          slotCapacity,
          dayStartMinute,
          dayEndMinute,
          createdById: userId,
          updatedById: userId,
        })
        .onConflictDoUpdate({
          target: campaignBookingSettings.campaignId,
          set: { slotCapacity, dayStartMinute, dayEndMinute, updatedById: userId },
        });

      const unminted = await tx
        .select({ id: smsRecipients.id })
        .from(smsRecipients)
        .where(
          and(eq(smsRecipients.campaignId, campaignId), isNull(smsRecipients.bookingToken)),
        );
      // Per-row updates (unique token each) — dealer lists are hundreds to low
      // thousands of rows, same simple-loop doctrine as the 0103 launch loop.
      for (const row of unminted) {
        await tx
          .update(smsRecipients)
          .set({ bookingToken: generateBookingToken(), updatedById: userId })
          .where(eq(smsRecipients.id, row.id));
      }
      return unminted.length;
    });

    await recordAudit({
      action: 'booking.settings_saved',
      targetTable: 'campaign_booking_settings',
      targetId: campaignId,
      payload: { slotCapacity, dayStartMinute, dayEndMinute, tokensMinted },
    });

    revalidatePath('/calendar');
    return { ok: true, tokensMinted };
  });
