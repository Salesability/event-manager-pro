import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '@/lib/db/schema';
import {
  campaignStyles,
  campaigns,
  contactIdentifiers,
  contacts,
  dealers,
} from '@/lib/db/schema';
import { reconcileCampaignCalendar } from '@/features/schedule/calendar-sync';
import {
  createEvent,
  deleteEvent,
  googleCalendarConfigured,
  patchEvent,
} from '@/lib/google/calendar';

// Integration test for `reconcileCampaignCalendar` (0077, Phase 4/5). The Google
// Calendar HTTP calls are MOCKED — only the DB side (the sync-column writes +
// `gcal_event_id` backfill) hits Postgres, in always-rolled-back transactions.
// The REAL mapper runs, so the asserted event body is the production payload.
//
// `pnpm test` skips this file when DATABASE_URL is unset.

vi.mock('server-only', () => ({}));
vi.mock('@/lib/google/calendar', () => ({
  createEvent: vi.fn(),
  patchEvent: vi.fn(),
  deleteEvent: vi.fn(),
  googleCalendarConfigured: vi.fn(() => true),
}));

try {
  process.loadEnvFile('.env.local');
} catch {
  // skipIf handles a missing DATABASE_URL.
}
// The mapper needs an absolute origin to build the event's source link.
process.env.SITE_URL = process.env.SITE_URL || 'https://app.example.test';

const dbUrl = process.env.DATABASE_URL;
const publicId = () => randomBytes(9).toString('base64url');
const eventId = () => `g${randomBytes(6).toString('hex')}`;

class Rollback extends Error {}

type TestDb = PostgresJsDatabase<typeof schema>;
type Tx = Parameters<Parameters<TestDb['transaction']>[0]>[0];

type SeedOpts = {
  status?: 'draft' | 'booked' | 'cancelled' | 'completed';
  gcalEventId?: string | null;
  withCoach?: boolean;
};

describe.skipIf(!dbUrl)('reconcileCampaignCalendar DB writes (0077)', () => {
  let sql: ReturnType<typeof postgres>;
  let db: TestDb;
  // A real auth.users id — the actors FK on campaigns/contacts requires it, and
  // reconcile stamps updatedById. The sandbox is seeded, so one exists.
  let userId: string;

  beforeAll(async () => {
    sql = postgres(dbUrl!, { max: 1, prepare: false });
    db = drizzle(sql, { schema });
    const [u] = await sql<{ id: string }[]>`select id from auth.users limit 1`;
    userId = u?.id;
  });

  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });

  beforeEach(() => {
    vi.mocked(createEvent).mockReset();
    vi.mocked(patchEvent).mockReset();
    vi.mocked(deleteEvent).mockReset();
    vi.mocked(googleCalendarConfigured).mockReset().mockReturnValue(true);
  });

  async function inRolledBackTx(fn: (tx: Tx) => Promise<void>): Promise<void> {
    try {
      await db.transaction(async (tx) => {
        await fn(tx);
        throw new Rollback();
      });
    } catch (err) {
      if (!(err instanceof Rollback)) throw err;
    }
  }

  // Seed a dealer (+ optional coach contact with a primary email) + a campaign,
  // returning the campaign id.
  async function seedCampaign(tx: Tx, opts: SeedOpts = {}): Promise<number> {
    const { status = 'booked', gcalEventId = null, withCoach = true } = opts;
    const [d] = await tx
      .insert(dealers)
      .values({ publicId: publicId(), name: '__0077 dealer__', address: '1 Test Rd', status: 'active' })
      .returning({ id: dealers.id });
    const [style] = await tx
      .insert(campaignStyles)
      .values({ label: `__0077 style ${publicId()}__` })
      .returning({ id: campaignStyles.id });

    let coachId: number | null = null;
    if (withCoach) {
      const [coach] = await tx
        .insert(contacts)
        .values({ firstName: 'Jordan', lastName: 'Coach', createdById: userId, updatedById: userId })
        .returning({ id: contacts.id });
      coachId = coach.id;
      await tx.insert(contactIdentifiers).values({
        contactId: coach.id,
        kind: 'email',
        value: `coach-${publicId()}@example.test`,
        isPrimary: true,
        source: 'admin',
      });
    }

    const [c] = await tx
      .insert(campaigns)
      .values({
        publicId: publicId(),
        dealerId: d.id,
        coachId,
        styleId: style.id,
        startDate: '2026-08-10',
        endDate: '2026-08-12',
        contact: 'Dana Dealer',
        phone: '555-0100',
        email: `dealer-${publicId()}@example.test`,
        qtyRecords: 5000, // an ops field — must NOT leak into the event
        status,
        gcalEventId,
        createdById: userId,
        updatedById: userId,
      })
      .returning({ id: campaigns.id });
    return c.id;
  }

  it('create path: creates an event, backfills gcal_event_id, marks synced', async () => {
    await inRolledBackTx(async (tx) => {
      const newEventId = eventId();
      vi.mocked(createEvent).mockResolvedValue({ id: newEventId, summary: 'x', start: {}, end: {} });
      const campaignId = await seedCampaign(tx, { status: 'booked', gcalEventId: null });

      const outcome = await reconcileCampaignCalendar(campaignId, userId, tx);

      expect(outcome).toBe('synced');
      expect(vi.mocked(patchEvent)).not.toHaveBeenCalled();
      const [event] = vi.mocked(createEvent).mock.calls[0];
      // Real mapper output: branded title, EXCLUSIVE end (+1), coach + dealer guests.
      expect(event.summary).toBe('🚗 __0077 dealer__ — SaleDay Event');
      expect(event.end).toEqual({ date: '2026-08-13' });
      expect(event.attendees).toHaveLength(2);
      expect(event.attendees?.[0].responseStatus).toBe('accepted'); // the coach
      // The description must stay customer-safe — no internal ops field leaks.
      expect(event.description).not.toMatch(/5000|qty|records|sms|letters|bdc/i);

      const [row] = await tx.select().from(campaigns).where(eq(campaigns.id, campaignId));
      expect(row.gcalEventId).toBe(newEventId);
      expect(row.gcalSyncStatus).toBe('synced');
      expect(row.gcalSyncedAt).not.toBeNull();
    });
  });

  it('patch path: a linked campaign patches in place, never creates', async () => {
    await inRolledBackTx(async (tx) => {
      const linkedId = eventId();
      vi.mocked(patchEvent).mockResolvedValue({ id: linkedId, summary: 'x', start: {}, end: {} });
      const campaignId = await seedCampaign(tx, { status: 'booked', gcalEventId: linkedId });

      const outcome = await reconcileCampaignCalendar(campaignId, userId, tx);

      expect(outcome).toBe('synced');
      expect(vi.mocked(createEvent)).not.toHaveBeenCalled();
      expect(vi.mocked(patchEvent)).toHaveBeenCalledWith(linkedId, expect.objectContaining({ summary: expect.any(String) }));
      const [row] = await tx.select().from(campaigns).where(eq(campaigns.id, campaignId));
      expect(row.gcalEventId).toBe(linkedId); // unchanged
      expect(row.gcalSyncStatus).toBe('synced');
    });
  });

  it('cancel path: a cancelled+linked campaign deletes the event and clears the link', async () => {
    await inRolledBackTx(async (tx) => {
      const linkedId = eventId();
      vi.mocked(deleteEvent).mockResolvedValue(undefined);
      const campaignId = await seedCampaign(tx, { status: 'cancelled', gcalEventId: linkedId });

      const outcome = await reconcileCampaignCalendar(campaignId, userId, tx);

      expect(outcome).toBe('removed');
      expect(vi.mocked(deleteEvent)).toHaveBeenCalledWith(linkedId);
      expect(vi.mocked(createEvent)).not.toHaveBeenCalled();
      const [row] = await tx.select().from(campaigns).where(eq(campaigns.id, campaignId));
      expect(row.gcalEventId).toBeNull();
      expect(row.gcalSyncStatus).toBe('synced');
    });
  });

  it('best-effort: a Google failure marks the row failed and never throws', async () => {
    await inRolledBackTx(async (tx) => {
      vi.mocked(createEvent).mockRejectedValue(new Error('google is down'));
      const campaignId = await seedCampaign(tx, { status: 'booked', gcalEventId: null });

      const outcome = await reconcileCampaignCalendar(campaignId, userId, tx);

      expect(outcome).toBe('failed');
      const [row] = await tx.select().from(campaigns).where(eq(campaigns.id, campaignId));
      expect(row.gcalSyncStatus).toBe('failed');
      expect(row.gcalEventId).toBeNull(); // never linked
    });
  });

  it('skipped: when Google is unconfigured, no calls run and status is untouched', async () => {
    await inRolledBackTx(async (tx) => {
      vi.mocked(googleCalendarConfigured).mockReturnValue(false);
      const campaignId = await seedCampaign(tx, { status: 'booked', gcalEventId: null });

      const outcome = await reconcileCampaignCalendar(campaignId, userId, tx);

      expect(outcome).toBe('skipped');
      expect(vi.mocked(createEvent)).not.toHaveBeenCalled();
      const [row] = await tx.select().from(campaigns).where(eq(campaigns.id, campaignId));
      expect(row.gcalSyncStatus).toBe('pending'); // default, untouched
    });
  });

  it('a campaign with no coach still syncs (dealer-only guest)', async () => {
    await inRolledBackTx(async (tx) => {
      vi.mocked(createEvent).mockResolvedValue({ id: eventId(), summary: 'x', start: {}, end: {} });
      const campaignId = await seedCampaign(tx, { status: 'booked', withCoach: false });

      const outcome = await reconcileCampaignCalendar(campaignId, userId, tx);

      expect(outcome).toBe('synced');
      const [event] = vi.mocked(createEvent).mock.calls[0];
      expect(event.attendees).toHaveLength(1); // dealer only
      expect(event.colorId).toBeUndefined(); // no coach → no colour
    });
  });
});
