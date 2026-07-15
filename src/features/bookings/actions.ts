'use server';

import { randomBytes } from 'crypto';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { recordAudit } from '@/features/audit/actions';
import { capabilityClient, formDataSchema } from '@/lib/actions/action-client';
import { db } from '@/lib/db';
import { campaignBookingSettings, campaigns, smsRecipients } from '@/lib/db/schema';
import { bookSlot } from './book';
import { SLOT_LENGTH_MINUTES } from './slots';

// Booking domain actions (0108 Phase 2): the public book action the
// /book/<token> page posts to, and the staff settings/token-mint action the
// per-event panel calls. Staff surfaces re-render via /calendar.

// Same idiom as `generatePublicId` (schedule/actions.ts) with bumped entropy:
// this token resolves to a customer's PII and authorizes a booking write, not
// a display-only share id. 18 bytes → 24 url-safe chars, unguessable.
const generateBookingToken = () => randomBytes(18).toString('base64url');

// `slot` is one field ("YYYY-MM-DD#minute") because the page's picker is a
// radio group — a radio can only carry a single value, and one field keeps the
// public form free of client JS.
const bookInputSchema = z
  .object({
    token: z.string().trim().min(1).max(200),
    slot: z.string().regex(/^\d{4}-\d{2}-\d{2}#\d{1,4}$/, 'Malformed slot.'),
  })
  .transform(({ token, slot }) => {
    const [slotDate, minuteRaw] = slot.split('#');
    return { token, slotDate, slotStartMinute: Number(minuteRaw) };
  })
  .refine(
    (v) =>
      v.slotStartMinute % SLOT_LENGTH_MINUTES === 0 &&
      v.slotStartMinute <= 1440 - SLOT_LENGTH_MINUTES,
    'Off-grid slot time.',
  );

// The unguessable token IS the gate (like the /share/coach pages) — the
// domain half (resolve + locked transaction) lives in book.ts so the
// integration suite can exercise it. Results travel as redirects back to the
// token page (no client JS on the public surface): success + already-booked
// re-render as the booked state; refusals carry ?error= for the page to
// surface. Opt-out does NOT block booking — STOP halts SMS, not the
// customer's own web self-serve.
// authz: public
export async function bookAppointment(formData: FormData) {
  const parsed = bookInputSchema.safeParse({
    token: formData.get('token'),
    slot: formData.get('slot'),
  });
  if (!parsed.success) {
    const token = String(formData.get('token') ?? '').trim();
    if (!token) redirect('/');
    redirect(`/book/${encodeURIComponent(token)}?error=invalid`);
  }
  const { token, slotDate, slotStartMinute } = parsed.data;
  const back = (query = '') => `/book/${encodeURIComponent(token)}${query}`;

  const outcome = await bookSlot({ token, slotDate, slotStartMinute });
  switch (outcome) {
    // Unknown token → the page itself 404s; don't leak validity via the action.
    // Ended event → the page renders its "event has passed" state from data.
    case 'unknown-token':
    case 'event-ended':
      redirect(back());
      break;
    case 'invalid-slot':
      redirect(back('?error=invalid'));
      break;
    case 'slot-full':
      redirect(back('?error=full'));
      break;
    default:
      // 'ok' and 'already-booked' both land on the booked-state render.
      revalidatePath('/calendar');
      redirect(back());
  }
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
    if (campaign.status !== 'booked') {
      return {
        error: `Booking can only be enabled for booked campaigns (this one is ${campaign.status}).`,
      };
    }

    const userId = ctx.user.id;
    const tokensMinted = await db.transaction(async (tx) => {
      // Shares the campaign SMS lock key so a mint can't interleave with a
      // recipient re-import's delete + reinsert (sms/actions.ts).
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext('sms_launch_' || ${campaignId}::text))`,
      );
      // Settings writes serialize against in-flight bookings.
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext('booking_' || ${campaignId}::text))`,
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
