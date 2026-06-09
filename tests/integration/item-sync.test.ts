import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as schema from '@/lib/db/schema';
import { dealers, quoteLineItems, quotes, serviceItems } from '@/lib/db/schema';
import { applyItemSync } from '@/lib/quickbooks/item-sync';
import type { QboItem } from '@/lib/quickbooks/client';

// Integration test for `applyItemSync` (0071) against a real DB. Every case runs
// inside an always-rolled-back transaction, so nothing persists to the shared
// sandbox DB. `applyItemSync` takes the items array directly (no QBO network),
// so nothing is mocked.
//
// NOTE: the apply does a blanket `DELETE … WHERE quickbooks_id IS NULL`, so in a
// non-empty pull it purges ALL unlinked rows in the tx's view (incl. the real
// sandbox catalog). We therefore assert on SPECIFIC tagged rows + outcomes, not
// on exact `purged`/`skipped` totals.
//
// `pnpm test` skips this file when DATABASE_URL is unset (CI without secrets).

try {
  process.loadEnvFile('.env.local');
} catch {
  // ignore — skipIf below handles a missing DATABASE_URL gracefully.
}

const dbUrl = process.env.DATABASE_URL;
const qbId = () => `9${randomBytes(5).toString('hex')}`;
const tagName = () => `__0071 Item ${randomBytes(4).toString('hex')}__`;
const publicId = () => randomBytes(9).toString('base64url');

class Rollback extends Error {}

type TestDb = PostgresJsDatabase<typeof schema>;
type Tx = Parameters<Parameters<TestDb['transaction']>[0]>[0];

describe.skipIf(!dbUrl)('applyItemSync (0071)', () => {
  let sql: ReturnType<typeof postgres>;
  let db: TestDb;

  beforeAll(() => {
    sql = postgres(dbUrl!, { max: 1, prepare: false });
    db = drizzle(sql, { schema });
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

  it('creates a service item linked to a QBO Item with no local match', async () => {
    await inRolledBackTx(async (tx) => {
      const id = qbId();
      const name = tagName();
      const result = await applyItemSync(
        [{ Id: id, Name: name, Type: 'Service', UnitPrice: 50 }],
        tx,
      );
      expect(result.created).toBe(1);

      const [row] = await tx.select().from(serviceItems).where(eq(serviceItems.quickbooksId, id));
      expect(row).toBeTruthy();
      expect(row.label).toBe(name);
      expect(Number(row.unitPrice)).toBe(50);
    });
  });

  it('overwrites a linked row label/price from QBO (QBO is master)', async () => {
    await inRolledBackTx(async (tx) => {
      const id = qbId();
      const [seed] = await tx
        .insert(serviceItems)
        .values({ code: `c-${id}`, label: 'Old Label', unitPrice: '50.00', quickbooksId: id })
        .returning({ id: serviceItems.id });

      const result = await applyItemSync(
        [{ Id: id, Name: 'New Label', Type: 'Service', UnitPrice: 75 }],
        tx,
      );
      expect(result.updated).toBe(1);

      const [row] = await tx.select().from(serviceItems).where(eq(serviceItems.id, seed.id));
      expect(row.label).toBe('New Label');
      expect(Number(row.unitPrice)).toBe(75);
      expect(row.code).toBe(`c-${id}`); // immutable — unchanged
    });
  });

  it('archives a linked row whose QBO Item is absent from the active set', async () => {
    await inRolledBackTx(async (tx) => {
      const goneId = qbId();
      const [seed] = await tx
        .insert(serviceItems)
        .values({ code: `c-${goneId}`, label: 'Gone', quickbooksId: goneId })
        .returning({ id: serviceItems.id });

      // A pull that contains some OTHER item — `goneId` is no longer present.
      const result = await applyItemSync(
        [{ Id: qbId(), Name: tagName(), Type: 'Service' }],
        tx,
      );
      // `>= 1`, not `=== 1`: the blanket archive also covers any OTHER linked
      // rows already in the shared sandbox catalog (absent from this 1-item
      // pull), so the exact count is shared-state-dependent. Assert our seeded
      // row specifically below. (Mirrors the `purge` test's `>= 1`.)
      expect(result.archived).toBeGreaterThanOrEqual(1);

      const [row] = await tx.select().from(serviceItems).where(eq(serviceItems.id, seed.id));
      expect(row.archivedAt).not.toBeNull();
    });
  });

  it('purges a pre-existing unlinked (legacy) row', async () => {
    await inRolledBackTx(async (tx) => {
      const legacyCode = `legacy-${randomBytes(4).toString('hex')}`;
      const [legacy] = await tx
        .insert(serviceItems)
        .values({ code: legacyCode, label: 'Legacy SKU' })
        .returning({ id: serviceItems.id });

      const result = await applyItemSync([{ Id: qbId(), Name: tagName(), Type: 'Service' }], tx);
      expect(result.purged).toBeGreaterThanOrEqual(1); // includes our legacy row (+ any sandbox unlinked)

      const rows = await tx.select().from(serviceItems).where(eq(serviceItems.id, legacy.id));
      expect(rows).toHaveLength(0); // legacy row gone
    });
  });

  it('is idempotent — a re-pull of the same item is a no-op `current`', async () => {
    await inRolledBackTx(async (tx) => {
      const id = qbId();
      const item: QboItem = { Id: id, Name: tagName(), Type: 'Service', UnitPrice: 20 };
      const first = await applyItemSync([item], tx);
      expect(first.created).toBe(1);

      const second = await applyItemSync([item], tx);
      expect(second.created).toBe(0);
      expect(second.updated).toBe(0); // already current

      const rows = await tx.select().from(serviceItems).where(eq(serviceItems.quickbooksId, id));
      expect(rows).toHaveLength(1); // no duplicate
    });
  });

  it('empty-pull guard: zero items writes NOTHING (never wipes the catalog)', async () => {
    await inRolledBackTx(async (tx) => {
      const code = `keep-${randomBytes(4).toString('hex')}`;
      const [seed] = await tx
        .insert(serviceItems)
        .values({ code, label: 'Keep me' })
        .returning({ id: serviceItems.id });

      const result = await applyItemSync([], tx);
      expect(result).toEqual({ created: 0, updated: 0, archived: 0, purged: 0, skipped: 0 });

      const rows = await tx.select().from(serviceItems).where(eq(serviceItems.id, seed.id));
      expect(rows).toHaveLength(1); // unlinked row NOT purged — guard held
    });
  });

  it('destructive-pull guard: a non-empty response with NO syncable items writes nothing', async () => {
    await inRolledBackTx(async (tx) => {
      const code = `keep-${randomBytes(4).toString('hex')}`;
      const [seed] = await tx
        .insert(serviceItems)
        .values({ code, label: 'Keep me' })
        .returning({ id: serviceItems.id });

      // Only a Category (non-syncable) — mimics a transient/partial QBO read.
      const result = await applyItemSync([{ Id: qbId(), Name: 'A Category', Type: 'Category' }], tx);
      expect(result).toEqual({ created: 0, updated: 0, archived: 0, purged: 0, skipped: 0 });

      const rows = await tx.select().from(serviceItems).where(eq(serviceItems.id, seed.id));
      expect(rows).toHaveLength(1); // not purged — guard held on zero syncable items
    });
  });

  it('purging an item does not break a historical quote line (snapshot + set-null FK)', async () => {
    await inRolledBackTx(async (tx) => {
      const [dealer] = await tx
        .insert(dealers)
        .values({ publicId: publicId(), name: tagName(), status: 'active' })
        .returning({ id: dealers.id });
      const [quote] = await tx
        .insert(quotes)
        .values({ dealerId: dealer.id, inputs: {} })
        .returning({ id: quotes.id });
      const legacyCode = `legacy-${randomBytes(4).toString('hex')}`;
      const [legacy] = await tx
        .insert(serviceItems)
        .values({ code: legacyCode, label: 'Legacy SKU', unitPrice: '100.00' })
        .returning({ id: serviceItems.id });
      const [line] = await tx
        .insert(quoteLineItems)
        .values({
          quoteId: quote.id,
          serviceItemId: legacy.id,
          code: legacyCode, // snapshot
          label: 'Legacy SKU', // snapshot
          qty: 1,
          unitPrice: '100.00', // snapshot
          lineTotal: '100.00',
          displayOrder: 0,
        })
        .returning({ id: quoteLineItems.id });

      await applyItemSync([{ Id: qbId(), Name: tagName(), Type: 'Service' }], tx); // purges legacy

      const [row] = await tx.select().from(quoteLineItems).where(eq(quoteLineItems.id, line.id));
      expect(row.serviceItemId).toBeNull(); // FK set null on delete
      expect(row.code).toBe(legacyCode); // snapshot intact
      expect(row.label).toBe('Legacy SKU');
      expect(Number(row.unitPrice)).toBe(100);
    });
  });
});
