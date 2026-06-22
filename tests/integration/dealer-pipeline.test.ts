import { randomBytes } from 'node:crypto';
import { and, asc, desc, eq } from 'drizzle-orm';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as schema from '@/lib/db/schema';
import { dealerActivities, dealers } from '@/lib/db/schema';
import { PIPELINE_STAGES } from '@/features/dealers/pipeline';

// Integration test for the 0087 prospecting pipeline schema against a real DB.
// The Server Actions (`setDealerPipeline` / `logDealerActivity`) run on the app
// `db` (not tx-injectable), so rather than persist to the shared sandbox we
// exercise the same DB operations the actions perform — directly on the schema,
// inside an always-rolled-back transaction. This validates: the 3 new enums, the
// nullable pipeline columns, the `dealer_activities` insert + FK cascade, the
// `last_contacted_at` / `stage_changed_at` stamps, and the recent-activity
// ordering `loadDealerActivities` relies on.
//
// `pnpm test` skips this file when DATABASE_URL is unset (CI without secrets).

try {
  process.loadEnvFile('.env.local');
} catch {
  // ignore — skipIf below handles a missing DATABASE_URL gracefully.
}

const dbUrl = process.env.DATABASE_URL;
const tag = () => `__0087_test_${randomBytes(6).toString('hex')}__`;
const publicId = () => randomBytes(9).toString('base64url');

class Rollback extends Error {}

type TestDb = PostgresJsDatabase<typeof schema>;
type Tx = Parameters<Parameters<TestDb['transaction']>[0]>[0];

describe.skipIf(!dbUrl)('dealer pipeline schema (0087)', () => {
  let sql: ReturnType<typeof postgres>;
  let db: TestDb;
  let actorId: string | null = null;

  beforeAll(async () => {
    sql = postgres(dbUrl!, { max: 1, prepare: false });
    db = drizzle(sql, { schema });
    const users = await sql<{ id: string }[]>`select id from auth.users limit 1`;
    actorId = users[0]?.id ?? null;
  });

  afterAll(async () => {
    await sql.end({ timeout: 5 });
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

  async function seedProspect(tx: Tx): Promise<number> {
    const [row] = await tx
      .insert(dealers)
      .values({ publicId: publicId(), name: tag(), status: 'prospect' })
      .returning({ id: dealers.id });
    return row.id;
  }

  it('accepts every pipeline_stage enum value + priority + owner', async () => {
    await inRolledBackTx(async (tx) => {
      const id = await seedProspect(tx);
      for (const stage of PIPELINE_STAGES) {
        await tx.update(dealers).set({ pipelineStage: stage }).where(eq(dealers.id, id));
      }
      await tx
        .update(dealers)
        .set({ priority: 'high', ownerId: actorId, nextAction: 'Call', nextActionAt: '2026-07-01' })
        .where(eq(dealers.id, id));

      const [row] = await tx.select().from(dealers).where(eq(dealers.id, id));
      expect(row.pipelineStage).toBe('lost'); // last set
      expect(row.priority).toBe('high');
      expect(row.ownerId).toBe(actorId);
      expect(row.nextAction).toBe('Call');
      expect(row.nextActionAt).toBe('2026-07-01');
    });
  });

  it('logs activities, stamps last_contacted_at, and returns them newest-first', async () => {
    await inRolledBackTx(async (tx) => {
      const id = await seedProspect(tx);
      const older = new Date('2026-06-01T12:00:00Z');
      const newer = new Date('2026-06-20T12:00:00Z');

      await tx.insert(dealerActivities).values([
        { dealerId: id, kind: 'call', note: 'first', occurredAt: older, createdById: actorId },
        { dealerId: id, kind: 'email', note: 'second', occurredAt: newer, createdById: actorId },
      ]);
      // The action stamps last_contacted_at to the touch time.
      await tx.update(dealers).set({ lastContactedAt: newer }).where(eq(dealers.id, id));

      const rows = await tx
        .select()
        .from(dealerActivities)
        .where(eq(dealerActivities.dealerId, id))
        .orderBy(desc(dealerActivities.occurredAt), desc(dealerActivities.id));
      expect(rows.map((r) => r.note)).toEqual(['second', 'first']);
      expect(rows[0].kind).toBe('email');

      const [dealer] = await tx.select().from(dealers).where(eq(dealers.id, id));
      expect(dealer.lastContactedAt?.toISOString()).toBe(newer.toISOString());
    });
  });

  it('cascades activity rows when the dealer is deleted', async () => {
    await inRolledBackTx(async (tx) => {
      const id = await seedProspect(tx);
      await tx.insert(dealerActivities).values({ dealerId: id, kind: 'note', createdById: actorId });

      const before = await tx
        .select()
        .from(dealerActivities)
        .where(eq(dealerActivities.dealerId, id));
      expect(before).toHaveLength(1);

      await tx.delete(dealers).where(eq(dealers.id, id));
      const after = await tx
        .select()
        .from(dealerActivities)
        .where(eq(dealerActivities.dealerId, id));
      expect(after).toHaveLength(0);
    });
  });

  it('stamps stage_changed_at on a transition (mirrors setDealerPipeline)', async () => {
    await inRolledBackTx(async (tx) => {
      const id = await seedProspect(tx);
      await tx.update(dealers).set({ pipelineStage: 'new' }).where(eq(dealers.id, id));

      // The action only writes stage_changed_at when the stage actually changes.
      const stamp = new Date('2026-06-22T09:00:00Z');
      await tx
        .update(dealers)
        .set({ pipelineStage: 'contacted', stageChangedAt: stamp })
        .where(and(eq(dealers.id, id), eq(dealers.pipelineStage, 'new')));

      const [row] = await tx.select().from(dealers).where(eq(dealers.id, id));
      expect(row.pipelineStage).toBe('contacted');
      expect(row.stageChangedAt?.toISOString()).toBe(stamp.toISOString());
    });
  });

  it('default-sorts a queue by next_action_at ascending (overdue first)', async () => {
    await inRolledBackTx(async (tx) => {
      const a = await seedProspect(tx);
      const b = await seedProspect(tx);
      const c = await seedProspect(tx);
      await tx.update(dealers).set({ nextActionAt: '2026-06-10' }).where(eq(dealers.id, a)); // overdue
      await tx.update(dealers).set({ nextActionAt: '2026-07-01' }).where(eq(dealers.id, b)); // future
      // c left with null next_action_at (idle)

      const rows = await tx
        .select({ id: dealers.id, due: dealers.nextActionAt })
        .from(dealers)
        .where(eq(dealers.status, 'prospect'))
        .orderBy(asc(dealers.nextActionAt));
      // Among our three, the overdue one precedes the future one.
      const ours = rows.filter((r) => [a, b, c].includes(r.id));
      const idxA = ours.findIndex((r) => r.id === a);
      const idxB = ours.findIndex((r) => r.id === b);
      expect(idxA).toBeLessThan(idxB);
    });
  });
});
