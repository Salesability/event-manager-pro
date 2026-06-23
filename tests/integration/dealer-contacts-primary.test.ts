import { randomBytes } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as schema from '@/lib/db/schema';
import { contacts, dealerContacts, dealers } from '@/lib/db/schema';

// Integration test for the 0089 one-active-primary-per-dealer invariant — the
// `dealer_contacts_one_primary_per_dealer_unique` partial-unique index scoped to
// `WHERE is_primary AND archived_at IS NULL`. Verifies (a) a dealer can't have two
// active primaries, and (b) an *archived* former primary never blocks designating
// a new one (the reason the index is archived-scoped).
//
// Everything runs inside an always-rolled-back transaction.
// `pnpm test` skips this file when DATABASE_URL is unset.

try {
  process.loadEnvFile('.env.local');
} catch {
  // ignore — skipIf below handles a missing DATABASE_URL gracefully.
}

const dbUrl = process.env.DATABASE_URL;
const tag = () => `__primary_test_${randomBytes(6).toString('hex')}__`;
const publicId = () => randomBytes(9).toString('base64url');

class Rollback extends Error {}

type TestDb = PostgresJsDatabase<typeof schema>;
type Tx = Parameters<Parameters<TestDb['transaction']>[0]>[0];

describe.skipIf(!dbUrl)('dealer_contacts one-active-primary-per-dealer (0089)', () => {
  let sqlClient: ReturnType<typeof postgres>;
  let db: TestDb;

  beforeAll(() => {
    sqlClient = postgres(dbUrl!, { max: 1, prepare: false });
    db = drizzle(sqlClient, { schema });
  });

  afterAll(async () => {
    await sqlClient.end({ timeout: 5 });
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

  async function seedDealer(tx: Tx): Promise<number> {
    const [d] = await tx
      .insert(dealers)
      .values({ publicId: publicId(), name: tag(), status: 'prospect' })
      .returning({ id: dealers.id });
    return d.id;
  }

  async function seedContact(tx: Tx, firstName: string): Promise<number> {
    const [c] = await tx
      .insert(contacts)
      .values({ firstName, lastName: 'Test' })
      .returning({ id: contacts.id });
    return c.id;
  }

  it('rejects a second active primary for the same dealer', async () => {
    let caught: unknown;
    try {
      await inRolledBackTx(async (tx) => {
        const dealerId = await seedDealer(tx);
        const c1 = await seedContact(tx, 'First');
        const c2 = await seedContact(tx, 'Second');
        await tx.insert(dealerContacts).values({ dealerId, contactId: c1, isPrimary: true });
        // Second active primary violates the partial-unique index.
        await tx.insert(dealerContacts).values({ dealerId, contactId: c2, isPrimary: true });
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeDefined();
    // drizzle wraps the pg error; the constraint name lives on the cause.
    const cause = (caught as { cause?: { message?: string } })?.cause;
    expect(String(cause?.message ?? caught)).toMatch(
      /dealer_contacts_one_primary_per_dealer_unique/,
    );
  });

  it('allows many non-primary links plus exactly one active primary', async () => {
    await inRolledBackTx(async (tx) => {
      const dealerId = await seedDealer(tx);
      const c1 = await seedContact(tx, 'NonPrimaryA');
      const c2 = await seedContact(tx, 'NonPrimaryB');
      const c3 = await seedContact(tx, 'Primary');
      await tx.insert(dealerContacts).values({ dealerId, contactId: c1, isPrimary: false });
      await tx.insert(dealerContacts).values({ dealerId, contactId: c2, isPrimary: false });
      await tx.insert(dealerContacts).values({ dealerId, contactId: c3, isPrimary: true });

      const rows = await tx
        .select({ isPrimary: dealerContacts.isPrimary })
        .from(dealerContacts)
        .where(and(eq(dealerContacts.dealerId, dealerId), isNull(dealerContacts.archivedAt)));
      expect(rows).toHaveLength(3);
      expect(rows.filter((r) => r.isPrimary)).toHaveLength(1);
    });
  });

  it('an archived former primary does not block a new active primary', async () => {
    await inRolledBackTx(async (tx) => {
      const dealerId = await seedDealer(tx);
      const c1 = await seedContact(tx, 'OldPrimary');
      const c2 = await seedContact(tx, 'NewPrimary');
      // Archived primary — should NOT count toward the one-active-primary rule.
      await tx
        .insert(dealerContacts)
        .values({ dealerId, contactId: c1, isPrimary: true, archivedAt: new Date() });
      // New active primary is allowed.
      await tx.insert(dealerContacts).values({ dealerId, contactId: c2, isPrimary: true });

      const active = await tx
        .select({ contactId: dealerContacts.contactId })
        .from(dealerContacts)
        .where(
          and(
            eq(dealerContacts.dealerId, dealerId),
            eq(dealerContacts.isPrimary, true),
            isNull(dealerContacts.archivedAt),
          ),
        );
      expect(active).toHaveLength(1);
      expect(active[0].contactId).toBe(c2);
    });
  });
});
