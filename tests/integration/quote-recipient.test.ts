import { randomBytes } from 'node:crypto';
import { and, asc, desc, eq, isNull } from 'drizzle-orm';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as schema from '@/lib/db/schema';
import { contactIdentifiers, contacts, dealerContacts, dealers } from '@/lib/db/schema';

// Integration test for `resolveQuoteRecipient` against a real DB. The resolver is
// pure DB (always mocked in the action unit tests), so it needs a real-row test.
// Validates the 0089 model: the recipient is the dealer's designated primary
// contact (`is_primary`) with a primary email, falling back to the lowest-id
// emailable contact when the primary is emailless or unset (decision.md D3).
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

describe.skipIf(!dbUrl)('resolveQuoteRecipient primary designation (0089)', () => {
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
    isPrimary: boolean,
    firstName: string,
    email: string | null,
  ): Promise<void> {
    const [c] = await tx
      .insert(contacts)
      .values({ firstName, lastName: 'Test' })
      .returning({ id: contacts.id });
    await tx.insert(dealerContacts).values({ dealerId, contactId: c.id, isPrimary });
    if (email) {
      await tx
        .insert(contactIdentifiers)
        .values({ contactId: c.id, kind: 'email', value: email, isPrimary: true });
    }
  }

  // Mirrors resolveQuoteRecipient exactly (same joins + is_primary ordering).
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
      .orderBy(desc(dealerContacts.isPrimary), asc(dealerContacts.id))
      .limit(1);
    return row?.email ?? null;
  }

  it('resolves the designated primary contact with a primary email', async () => {
    await inRolledBackTx(async (tx) => {
      const id = await seedDealer(tx);
      await addContact(tx, id, true, 'Jonathan', 'gm@rooftop.test');
      expect(await recipientEmail(tx, id)).toBe('gm@rooftop.test');
    });
  });

  it('prefers the designated primary over a non-primary, regardless of id order', async () => {
    await inRolledBackTx(async (tx) => {
      const id = await seedDealer(tx);
      // Non-primary inserted first (lower id) — id-only ordering would pick it.
      await addContact(tx, id, false, 'Other', 'other@x.test');
      await addContact(tx, id, true, 'Primary', 'primary@x.test');
      expect(await recipientEmail(tx, id)).toBe('primary@x.test');
    });
  });

  it('skips an emailless primary for an emailable non-primary (D3 fallback)', async () => {
    await inRolledBackTx(async (tx) => {
      const id = await seedDealer(tx);
      await addContact(tx, id, true, 'NoEmail', null); // primary, but no email
      await addContact(tx, id, false, 'HasEmail', 'fallback@x.test');
      expect(await recipientEmail(tx, id)).toBe('fallback@x.test');
    });
  });

  it('falls back to the lowest-id emailable contact when no primary is set', async () => {
    await inRolledBackTx(async (tx) => {
      const id = await seedDealer(tx);
      await addContact(tx, id, false, 'First', 'first@x.test');
      await addContact(tx, id, false, 'Second', 'second@x.test');
      expect(await recipientEmail(tx, id)).toBe('first@x.test');
    });
  });

  it('returns nothing when no contact has a primary email (fail-closed)', async () => {
    await inRolledBackTx(async (tx) => {
      const id = await seedDealer(tx);
      await addContact(tx, id, true, 'NoEmail', null);
      expect(await recipientEmail(tx, id)).toBeNull();
    });
  });
});
