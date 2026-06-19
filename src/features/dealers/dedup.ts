import { and, eq, isNull, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { contactIdentifiers, contacts, dealers } from '@/lib/db/schema';

// Re-export the result contract from its types-only home (client forms import it
// from there to avoid this module's server-side DB imports).
export type { DuplicateResult } from './duplicate-types';

// Create-time duplicate-detection lookups (chunk 0085). The one-time import
// scripts dedup carefully — email/phone for contacts
// (`scripts/import-from-sheets.ts:246-273`), `lower(name)+lower(address)` for
// dealers (`:212-235`) — but the interactive `createDealer` / `updateDealer` /
// `createPerson` paths blind-insert. These helpers port that lookup logic into a
// UI-callable module so the actions can *warn + offer to reuse* before inserting.
//
// Read-only: no writes, no throws. Both accept an `Executor` (the live `db` or a
// transaction handle) so the action can run them inside or outside its tx and a
// test can drive them with a stub — mirrors `dealer-push.ts`'s `Executor` shape.

type Database = typeof db;
type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
type Executor = Database | Transaction;

export type ContactMatch = {
  contactId: number;
  firstName: string;
  lastName: string;
  matchedKind: 'email' | 'phone';
  matchedValue: string;
};

export type DealerMatch = {
  dealerId: number;
  name: string;
  address: string | null;
};

// Find an existing ACTIVE contact holding this email or phone. Mirrors the import
// path: email checked first, then phone; only un-archived identifiers count
// (matches the `contact_identifiers_kind_value_active_unique` index that DB-blocks
// a duplicate). Email is lowercased + trimmed, phone trimmed — same normalization
// the actions apply before `swapPrimaryIdentifier`. Returns the matched contact +
// which identifier hit, or null.
export async function findExistingContactByIdentifier(
  input: { email?: string | null; phone?: string | null },
  exec: Executor = db,
): Promise<ContactMatch | null> {
  const email = input.email?.trim().toLowerCase() || null;
  const phone = input.phone?.trim() || null;

  for (const [kind, value] of [
    ['email', email],
    ['phone', phone],
  ] as const) {
    if (!value) continue;
    const [row] = await exec
      .select({
        contactId: contactIdentifiers.contactId,
        firstName: contacts.firstName,
        lastName: contacts.lastName,
      })
      .from(contactIdentifiers)
      .innerJoin(contacts, eq(contacts.id, contactIdentifiers.contactId))
      .where(
        and(
          eq(contactIdentifiers.kind, kind),
          eq(contactIdentifiers.value, value),
          isNull(contactIdentifiers.archivedAt),
        ),
      )
      .limit(1);
    if (row) {
      return {
        contactId: row.contactId,
        firstName: row.firstName,
        lastName: row.lastName,
        matchedKind: kind,
        matchedValue: value,
      };
    }
  }
  return null;
}

// Find an existing ACTIVE dealer with the same name + address, case- and
// whitespace-insensitive (`lower(trim(...))` both sides; null address compared as
// ''). Ports `import-from-sheets.ts:findOrCreateDealer` but excludes archived
// dealers — re-creating the name+address of a removed dealer shouldn't warn.
// Application-level only (intent non-goal: no DB uniqueness on name+address).
export async function findExistingDealerByNameAddress(
  name: string,
  address: string | null,
  exec: Executor = db,
): Promise<DealerMatch | null> {
  const nameLower = name.trim().toLowerCase();
  const addressLower = (address ?? '').trim().toLowerCase();

  const [row] = await exec
    .select({ dealerId: dealers.id, name: dealers.name, address: dealers.address })
    .from(dealers)
    .where(
      and(
        sql`lower(trim(${dealers.name})) = ${nameLower}`,
        sql`lower(trim(coalesce(${dealers.address}, ''))) = ${addressLower}`,
        isNull(dealers.archivedAt),
      ),
    )
    .limit(1);

  return row ? { dealerId: row.dealerId, name: row.name, address: row.address } : null;
}
