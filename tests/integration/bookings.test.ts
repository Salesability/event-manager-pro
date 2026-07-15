import { randomBytes } from 'node:crypto';
import { eq, inArray } from 'drizzle-orm';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

// Real-Postgres checks for the 0108 booking domain:
//   • loadBookingContext resolves a token to the greeting context + derived
//     grid with live counts, and nulls for unknown tokens / booking-not-enabled;
//   • bookSlot books once per recipient, enforces capacity under CONCURRENT
//     submits (advisory lock), refuses off-grid slots and ended events;
//   • an appointment outlives its sms_recipients row (24-month purge posture).
// The sandbox DB is shared, so assertions filter to this file's fixtures and
// cleanup deletes in FK order (appointments RESTRICT campaigns).
//
// `pnpm test` skips when DATABASE_URL is unset.

vi.mock('server-only', () => ({}));

// MUST precede every `@/…` import: the domain module's chain evaluates the
// app db pool, which reads DATABASE_URL at import time.
import './helpers/load-env';

import * as schema from '@/lib/db/schema';
import {
  appointments,
  campaignBookingSettings,
  campaigns,
  dealers,
  smsRecipients,
} from '@/lib/db/schema';
import { bookSlot } from '@/features/bookings/book';
import { loadBookingContext } from '@/features/bookings/queries';

const dbUrl = process.env.DATABASE_URL;
const publicId = () => randomBytes(9).toString('base64url');
const token = () => randomBytes(18).toString('base64url');

// Distinct from the other sms integration files (+1999555/6/7) so the files'
// sweeps never touch each other's rows on the shared DB.
const PHONE_PREFIX = '+1999558';

// Future-dated so the event-ended gate never trips on the happy paths.
const START = '2026-08-14';
const END = '2026-08-15';

type TestDb = PostgresJsDatabase<typeof schema>;

describe.skipIf(!dbUrl)('booking domain (0108)', () => {
  let sql: ReturnType<typeof postgres>;
  let db: TestDb;
  const fixtures = { dealerIds: [] as number[], campaignIds: [] as number[] };

  beforeAll(() => {
    sql = postgres(dbUrl!, { max: 1, prepare: false });
    db = drizzle(sql, { schema });
  });

  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });

  afterEach(async () => {
    if (fixtures.campaignIds.length) {
      // appointments RESTRICT campaigns; settings + recipients cascade.
      await db
        .delete(appointments)
        .where(inArray(appointments.campaignId, fixtures.campaignIds));
      await db.delete(campaigns).where(inArray(campaigns.id, fixtures.campaignIds));
    }
    if (fixtures.dealerIds.length) {
      await db.delete(dealers).where(inArray(dealers.id, fixtures.dealerIds));
    }
    fixtures.dealerIds = [];
    fixtures.campaignIds = [];
  });

  async function seedBookableCampaign(opts: {
    dealerName: string;
    slotCapacity?: number;
    withSettings?: boolean;
    startDate?: string;
    endDate?: string;
    status?: (typeof campaigns.$inferInsert)['status'];
  }) {
    const [dealer] = await db
      .insert(dealers)
      .values({ publicId: publicId(), name: opts.dealerName })
      .returning({ id: dealers.id });
    fixtures.dealerIds.push(dealer.id);
    const [campaign] = await db
      .insert(campaigns)
      .values({
        publicId: publicId(),
        dealerId: dealer.id,
        startDate: opts.startDate ?? START,
        endDate: opts.endDate ?? END,
        status: opts.status ?? 'booked',
        smsEmail: 100,
      })
      .returning({ id: campaigns.id });
    fixtures.campaignIds.push(campaign.id);
    if (opts.withSettings !== false) {
      await db.insert(campaignBookingSettings).values({
        campaignId: campaign.id,
        dayStartMinute: 540,
        dayEndMinute: 1020,
        slotCapacity: opts.slotCapacity ?? 2,
      });
    }
    return campaign.id;
  }

  async function seedRecipient(
    campaignId: number,
    suffix: string,
    over: Partial<typeof smsRecipients.$inferInsert> = {},
  ) {
    const [row] = await db
      .insert(smsRecipients)
      .values({
        campaignId,
        phone: `${PHONE_PREFIX}${suffix}`,
        firstName: 'Sarah',
        lastName: `Tester${suffix}`,
        consentBasis: 'express',
        bookingToken: token(),
        ...over,
      })
      .returning({ id: smsRecipients.id, bookingToken: smsRecipients.bookingToken });
    return { id: row.id, token: row.bookingToken! };
  }

  it('resolves a token to greeting context + derived grid, and nulls otherwise', async () => {
    const campaignId = await seedBookableCampaign({ dealerName: 'Booking Test Motors' });
    const recipient = await seedRecipient(campaignId, '0001');

    const ctx = await loadBookingContext(recipient.token);
    expect(ctx).toMatchObject({
      recipientId: recipient.id,
      campaignId,
      firstName: 'Sarah',
      dealerName: 'Booking Test Motors',
      startDate: START,
      endDate: END,
      eventEnded: false,
      existingAppointment: null,
    });
    // 9:00–17:00 half-hour grid × 2 event days, all empty.
    expect(ctx!.slots).toHaveLength(32);
    expect(ctx!.slots[0]).toMatchObject({ date: START, startMinute: 540, booked: 0 });
    expect(ctx!.slots.every((s) => !s.isFull && s.capacity === 2)).toBe(true);

    expect(await loadBookingContext('no-such-token')).toBeNull();

    // Booking never enabled → null even though the token resolves a recipient.
    const bare = await seedBookableCampaign({
      dealerName: 'No Settings Motors',
      withSettings: false,
    });
    const bareRecipient = await seedRecipient(bare, '0002');
    expect(await loadBookingContext(bareRecipient.token)).toBeNull();
  });

  it('books once per recipient and snapshots name/phone', async () => {
    const campaignId = await seedBookableCampaign({ dealerName: 'One-Per Motors' });
    const recipient = await seedRecipient(campaignId, '0003');

    const outcome = await bookSlot({
      token: recipient.token,
      slotDate: START,
      slotStartMinute: 600,
    });
    expect(outcome).toBe('ok');

    const [row] = await db
      .select()
      .from(appointments)
      .where(eq(appointments.recipientId, recipient.id));
    expect(row).toMatchObject({
      campaignId,
      slotDate: START,
      slotStartMinute: 600,
      firstName: 'Sarah',
      lastName: 'Tester0003',
      phone: `${PHONE_PREFIX}0003`,
      status: 'booked',
      createdById: null,
    });

    // Second attempt via the same token — refused even for a different slot.
    expect(
      await bookSlot({ token: recipient.token, slotDate: END, slotStartMinute: 660 }),
    ).toBe('already-booked');

    // The context now shows the booked state + the slot's live count.
    const ctx = await loadBookingContext(recipient.token);
    expect(ctx!.existingAppointment).toEqual({ slotDate: START, slotStartMinute: 600 });
    expect(
      ctx!.slots.find((s) => s.date === START && s.startMinute === 600),
    ).toMatchObject({ booked: 1, isFull: false });

    // Re-import deletes + reinserts the recipient; the same phone still gets
    // one booked appointment for this campaign.
    await db.delete(smsRecipients).where(eq(smsRecipients.id, recipient.id));
    const reimported = await seedRecipient(campaignId, '1003', {
      phone: `${PHONE_PREFIX}0003`,
    });
    expect(
      await bookSlot({ token: reimported.token, slotDate: END, slotStartMinute: 660 }),
    ).toBe('already-booked');
    expect((await loadBookingContext(reimported.token))!.existingAppointment).toEqual({
      slotDate: START,
      slotStartMinute: 600,
    });
  });

  it('enforces capacity under concurrent submits (exactly one wins the last seat)', async () => {
    const campaignId = await seedBookableCampaign({
      dealerName: 'Capacity Motors',
      slotCapacity: 1,
    });
    const a = await seedRecipient(campaignId, '0004');
    const b = await seedRecipient(campaignId, '0005');

    const slot = { slotDate: START, slotStartMinute: 540 };
    const outcomes = await Promise.all([
      bookSlot({ token: a.token, ...slot }),
      bookSlot({ token: b.token, ...slot }),
    ]);
    expect(outcomes.toSorted()).toEqual(['ok', 'slot-full']);

    const rows = await db
      .select({ id: appointments.id })
      .from(appointments)
      .where(eq(appointments.campaignId, campaignId));
    expect(rows).toHaveLength(1);

    // The full slot reads as full; a later attempt on it stays refused.
    const loser = outcomes[0] === 'ok' ? b : a;
    expect(await bookSlot({ token: loser.token, ...slot })).toBe('slot-full');
    const ctx = await loadBookingContext(loser.token);
    expect(ctx!.slots.find((s) => s.startMinute === 540 && s.date === START)).toMatchObject({
      booked: 1,
      isFull: true,
    });
  });

  it('refuses off-grid slots, unknown tokens, and ended events', async () => {
    const campaignId = await seedBookableCampaign({ dealerName: 'Grid Motors' });
    const recipient = await seedRecipient(campaignId, '0006');

    // Off the half-hour, outside the window, outside the event days.
    for (const slot of [
      { slotDate: START, slotStartMinute: 555 },
      { slotDate: START, slotStartMinute: 510 },
      { slotDate: START, slotStartMinute: 1020 },
      { slotDate: '2026-08-16', slotStartMinute: 540 },
    ]) {
      expect(await bookSlot({ token: recipient.token, ...slot })).toBe('invalid-slot');
    }

    expect(
      await bookSlot({ token: 'no-such-token', slotDate: START, slotStartMinute: 540 }),
    ).toBe('unknown-token');

    const ended = await seedBookableCampaign({
      dealerName: 'Ended Motors',
      startDate: '2025-01-06',
      endDate: '2025-01-07',
    });
    const endedRecipient = await seedRecipient(ended, '0007');
    expect(
      await bookSlot({
        token: endedRecipient.token,
        slotDate: '2025-01-06',
        slotStartMinute: 540,
      }),
    ).toBe('event-ended');
    const ctx = await loadBookingContext(endedRecipient.token);
    expect(ctx!.eventEnded).toBe(true);

    const cancelled = await seedBookableCampaign({
      dealerName: 'Cancelled Motors',
      status: 'cancelled',
    });
    const cancelledRecipient = await seedRecipient(cancelled, '0009');
    expect(
      await bookSlot({
        token: cancelledRecipient.token,
        slotDate: START,
        slotStartMinute: 540,
      }),
    ).toBe('event-ended');
    const cancelledCtx = await loadBookingContext(cancelledRecipient.token);
    expect(cancelledCtx!.eventEnded).toBe(true);
  });

  it('keeps the appointment when its recipient row is purged', async () => {
    const campaignId = await seedBookableCampaign({ dealerName: 'Retention Motors' });
    const recipient = await seedRecipient(campaignId, '0008');
    expect(
      await bookSlot({ token: recipient.token, slotDate: START, slotStartMinute: 720 }),
    ).toBe('ok');

    // The 24-month purge hard-deletes the recipient row.
    await db.delete(smsRecipients).where(eq(smsRecipients.id, recipient.id));

    const [row] = await db
      .select({
        recipientId: appointments.recipientId,
        firstName: appointments.firstName,
        phone: appointments.phone,
        status: appointments.status,
      })
      .from(appointments)
      .where(eq(appointments.campaignId, campaignId));
    expect(row).toEqual({
      recipientId: null,
      firstName: 'Sarah',
      phone: `${PHONE_PREFIX}0008`,
      status: 'booked',
    });
  });
});
