import { randomBytes } from 'node:crypto';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as schema from '@/lib/db/schema';
import { contactIdentifiers, contacts, dealerContacts, dealers } from '@/lib/db/schema';

// Integration test for `resolveQuoteRecipient` against a real DB. The resolver is
// pure DB (always mocked in the action unit tests), so it needs a real-row test.
// Validates the hotfix (A): the recipient is the dealer's priority-primary contact
// (staff > customer > prospect) with a primary email — NOT a customer-only rule,
// which rejected every UI-created / 0086-imported dealer (all tagged `staff`).
//
// Everything runs inside an always-rolled-back transaction. The resolver uses the
// app `db` (not tx-injectable), so the query below is kept in lock-step with
// src/features/quotes/recipient.ts.
//
// `pnpm test` skips this file when DATABASE_URL is unset.

try {
  process.loadEnvFile('.env.local');
} catch {
  // ignore — skipIf below handles a missing DATABASE_URL gracefully.
}

const dbUrl = process.env.DATABASE_URL;
const tag = () => `__recipient_test_${randomBytes(6).toString('hex')}__`;
const publicId = () => randomBytes(9).toString('base64url');

class Rollback extends Error {}

type TestDb = PostgresJsDatabase<typeof schema>;
type Tx = Parameters<Parameters<TestDb['transaction']>[0]>[0];
type Role = 'customer' | 'staff' | 'prospect';

describe.skipIf(!dbUrl)('resolveQuoteRecipient priority (hotfix A)', () => {
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

  async function addContact(
    tx: Tx,
    dealerId: number,
    role: Role,
    firstName: string,
    email: string | null,
  ): Promise<void> {
    const [c] = await tx
      .insert(contacts)
      .values({ firstName, lastName: 'Test' })
      .returning({ id: contacts.id });
    await tx.insert(dealerContacts).values({ dealerId, contactId: c.id, role });
    if (email) {
      await tx
        .insert(contactIdentifiers)
        .values({ contactId: c.id, kind: 'email', value: email, isPrimary: true });
    }
  }

  // Mirrors resolveQuoteRecipient exactly (same joins + priority order).
  async function recipientEmail(tx: Tx, dealerId: number): Promise<string | null> {
    const [row] = await tx
      .select({ email: contactIdentifiers.value })
      .from(dealerContacts)
      .innerJoin(
        contacts,
        and(eq(contacts.id, dealerContacts.contactId), isNull(contacts.archivedAt)),
      )
      .innerJoin(
        contactIdentifiers,
        and(
          eq(contactIdentifiers.contactId, contacts.id),
          eq(contactIdentifiers.kind, 'email'),
          eq(contactIdentifiers.isPrimary, true),
          isNull(contactIdentifiers.archivedAt),
        ),
      )
      .where(and(eq(dealerContacts.dealerId, dealerId), isNull(dealerContacts.archivedAt)))
      .orderBy(
        sql`case ${dealerContacts.role} when 'staff' then 0 when 'customer' then 1 when 'prospect' then 2 else 3 end`,
        asc(dealerContacts.id),
      )
      .limit(1);
    return row?.email ?? null;
  }

  it('resolves a STAFF contact with a primary email (the 0086-prospect bug)', async () => {
    await inRolledBackTx(async (tx) => {
      const id = await seedDealer(tx);
      await addContact(tx, id, 'staff', 'Jonathan', 'gm@rooftop.test');
      expect(await recipientEmail(tx, id)).toBe('gm@rooftop.test');
    });
  });

  it('prefers the higher-priority contact (staff over customer)', async () => {
    await inRolledBackTx(async (tx) => {
      const id = await seedDealer(tx);
      await addContact(tx, id, 'customer', 'Cust', 'cust@x.test');
      await addContact(tx, id, 'staff', 'Staff', 'staff@x.test');
      expect(await recipientEmail(tx, id)).toBe('staff@x.test');
    });
  });

  it('skips an emailless higher-priority contact for an emailable lower-priority one', async () => {
    await inRolledBackTx(async (tx) => {
      const id = await seedDealer(tx);
      await addContact(tx, id, 'staff', 'NoEmail', null); // higher priority, no email
      await addContact(tx, id, 'customer', 'HasEmail', 'cust@x.test');
      expect(await recipientEmail(tx, id)).toBe('cust@x.test');
    });
  });

  it('returns nothing when no contact has a primary email (fail-closed)', async () => {
    await inRolledBackTx(async (tx) => {
      const id = await seedDealer(tx);
      await addContact(tx, id, 'staff', 'NoEmail', null);
      expect(await recipientEmail(tx, id)).toBeNull();
    });
  });
});
