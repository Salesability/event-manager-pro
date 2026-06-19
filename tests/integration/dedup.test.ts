import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as schema from '@/lib/db/schema';
import { contactIdentifiers, contacts, dealers } from '@/lib/db/schema';
import {
  findExistingContactByIdentifier,
  findExistingDealerByNameAddress,
} from '@/features/dealers/dedup';

// Integration test for the 0085 create-time dedup lookups against a real DB.
// Covers the SQL-level behaviours the pure-stub unit tests can't reach (archived
// exclusion, lower(trim()) case/whitespace-insensitivity) plus the orphan-row
// guarantee: a contact insert + a conflicting identifier in ONE transaction
// rolls the contact back (the structure `createDealer` / `createPerson` rely on).
// Every case runs inside an always-rolled-back transaction, so nothing persists
// to the shared sandbox DB. `pnpm test` skips this file when DATABASE_URL is unset.

vi.mock('server-only', () => ({}));

try {
  process.loadEnvFile('.env.local');
} catch {
  // ignore — skipIf below handles a missing DATABASE_URL gracefully.
}

const dbUrl = process.env.DATABASE_URL;
const uniq = () => randomBytes(6).toString('hex');
const publicId = () => randomBytes(9).toString('base64url');

class Rollback extends Error {}

type TestDb = PostgresJsDatabase<typeof schema>;
type Tx = Parameters<Parameters<TestDb['transaction']>[0]>[0];

describe.skipIf(!dbUrl)('create-time dedup lookups (0085 Phase 6)', () => {
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

  it('findExistingContactByIdentifier matches an active email case-insensitively', async () => {
    await inRolledBackTx(async (tx) => {
      const email = `dedup_${uniq()}@example.test`;
      const [c] = await tx
        .insert(contacts)
        .values({ firstName: 'Jane', lastName: 'Smith' })
        .returning({ id: contacts.id });
      await tx
        .insert(contactIdentifiers)
        .values({ contactId: c.id, kind: 'email', value: email, isPrimary: true });

      // Query with a differently-cased + padded email — the helper normalizes.
      const match = await findExistingContactByIdentifier({ email: `  ${email.toUpperCase()} ` }, tx);
      expect(match?.contactId).toBe(c.id);
      expect(match?.matchedKind).toBe('email');
      expect(match?.firstName).toBe('Jane');
    });
  });

  it('findExistingContactByIdentifier matches phone but excludes archived identifiers', async () => {
    await inRolledBackTx(async (tx) => {
      const phone = `555${uniq()}`;
      const [c] = await tx
        .insert(contacts)
        .values({ firstName: 'Pat', lastName: 'Lee' })
        .returning({ id: contacts.id });
      await tx
        .insert(contactIdentifiers)
        .values({ contactId: c.id, kind: 'phone', value: phone, isPrimary: true });

      expect((await findExistingContactByIdentifier({ phone }, tx))?.contactId).toBe(c.id);

      // Archiving the identifier removes it from the active-uniqueness world,
      // so it no longer warns (mirrors the partial unique index).
      await tx
        .update(contactIdentifiers)
        .set({ archivedAt: new Date(), isPrimary: false })
        .where(eq(contactIdentifiers.contactId, c.id));
      expect(await findExistingContactByIdentifier({ phone }, tx)).toBeNull();
    });
  });

  it('findExistingDealerByNameAddress matches case/whitespace-insensitively and excludes archived', async () => {
    await inRolledBackTx(async (tx) => {
      const name = `ABC Motors ${uniq()}`;
      const [d] = await tx
        .insert(dealers)
        .values({ publicId: publicId(), name, address: '123 King St', status: 'active' })
        .returning({ id: dealers.id });

      const match = await findExistingDealerByNameAddress(`  ${name.toUpperCase()} `, '123 KING ST', tx);
      expect(match?.dealerId).toBe(d.id);

      // Archived dealers shouldn't warn — re-using a removed dealer's identity is fine.
      await tx.update(dealers).set({ archivedAt: new Date() }).where(eq(dealers.id, d.id));
      expect(await findExistingDealerByNameAddress(name, '123 King St', tx)).toBeNull();
    });
  });

  it('a contact insert + conflicting identifier in one tx rolls back — no orphan contact row', async () => {
    await inRolledBackTx(async (tx) => {
      const email = `orphan_${uniq()}@example.test`;
      // The existing holder of the email.
      const [holder] = await tx
        .insert(contacts)
        .values({ firstName: 'First', lastName: 'Holder' })
        .returning({ id: contacts.id });
      await tx
        .insert(contactIdentifiers)
        .values({ contactId: holder.id, kind: 'email', value: email, isPrimary: true });

      const orphanName = `Orphan_${uniq()}`;
      // Mirror createDealer/createPerson exactly: insert the new contact, then
      // insert its identifier — which collides on the active-uniqueness index.
      // Both run in ONE (savepoint) transaction, so the contact must roll back.
      await expect(
        tx.transaction(async (sp) => {
          const [orphan] = await sp
            .insert(contacts)
            .values({ firstName: orphanName, lastName: 'Candidate' })
            .returning({ id: contacts.id });
          await sp
            .insert(contactIdentifiers)
            .values({ contactId: orphan.id, kind: 'email', value: email, isPrimary: true });
        }),
      ).rejects.toBeTruthy();

      const leftover = await tx
        .select({ id: contacts.id })
        .from(contacts)
        .where(eq(contacts.firstName, orphanName));
      expect(leftover).toHaveLength(0);
    });
  });
});
