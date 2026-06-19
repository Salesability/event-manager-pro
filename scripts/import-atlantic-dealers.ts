// One-time, idempotent import of the cleaned Atlantic Canada dealer BD list
// (chunk 0086) into `dealers` + `contacts` + `dealer_contacts` as **prospect**
// dealers. Reads the committed `scripts/data/atlantic-dealers.json`, applies the
// in-sheet drop-list + name+city dedup (skip-existing-dealer) + email contact
// dedup (a person on many rooftops = one contact, many links), and is safe to
// re-run (a full re-run inserts 0 rows). NO QB writes — prospects don't push
// (0084); the prod-QBO overlap is reported separately by
// `scripts/atlantic-overlap-probe.mjs` (decision.md D7). Mirrors the shape of
// `scripts/import-from-sheets.ts`.
//
// Run (sandbox, dry-run):
//   set -a && source .env.local && set +a && pnpm dlx tsx scripts/import-atlantic-dealers.ts --dry-run
// Run (sandbox, write):
//   set -a && source .env.local && set +a && pnpm dlx tsx scripts/import-atlantic-dealers.ts
// Run (prod): apply migration 0041 first, then via with-prod-db.sh (Phase 6).
//
// The dedup queries below are inlined copies of `src/features/dealers/dedup.ts`
// (0085) — those helpers import `@/lib/db` (an un-closable eager pool) and pull
// in the `server-only` QBO client, neither of which suits a standalone tsx
// runner; the semantics here are identical.

import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from '../src/lib/db/schema';
import { contactIdentifiers, contacts, dealerContacts, dealers } from '../src/lib/db/schema';
import {
  type AtlanticFile,
  ATLANTIC_IMPORT_SOURCE,
  buildDropSet,
  dropKey,
  mapRowToDealer,
} from '../src/features/dealers/atlantic-import';

const DRY_RUN = process.argv.includes('--dry-run');
if (!process.env.DATABASE_URL) {
  console.error('Missing DATABASE_URL (source .env.local, or run via with-prod-db.sh).');
  process.exit(1);
}
const DATABASE_URL: string = process.env.DATABASE_URL;

const generatePublicId = () => randomBytes(9).toString('base64url');
const client = postgres(DATABASE_URL, { prepare: false, max: 1 });
const db = drizzle(client, { schema });

// --- dedup (mirrors src/features/dealers/dedup.ts, 0085) ---
async function findExistingDealerId(name: string, address: string | null): Promise<number | null> {
  const nameLower = name.trim().toLowerCase();
  const addressLower = (address ?? '').trim().toLowerCase();
  const [row] = await db
    .select({ id: dealers.id })
    .from(dealers)
    .where(
      and(
        sql`lower(trim(${dealers.name})) = ${nameLower}`,
        sql`lower(trim(coalesce(${dealers.address}, ''))) = ${addressLower}`,
        isNull(dealers.archivedAt),
      ),
    )
    .limit(1);
  return row?.id ?? null;
}

async function findExistingContactIdByEmail(email: string): Promise<number | null> {
  const [row] = await db
    .select({ contactId: contactIdentifiers.contactId })
    .from(contactIdentifiers)
    .where(
      and(
        eq(contactIdentifiers.kind, 'email'),
        eq(contactIdentifiers.value, email),
        isNull(contactIdentifiers.archivedAt),
      ),
    )
    .limit(1);
  return row?.contactId ?? null;
}

// Name-only contacts can't dedup by email, and aren't shared across rooftops, so
// reuse is keyed per (dealer, role='staff', title) — keeps a re-run idempotent.
async function findStaffContactIdByTitle(dealerId: number, title: string): Promise<number | null> {
  const [row] = await db
    .select({ contactId: dealerContacts.contactId })
    .from(dealerContacts)
    .where(
      and(
        eq(dealerContacts.dealerId, dealerId),
        eq(dealerContacts.role, 'staff'),
        eq(dealerContacts.title, title),
        isNull(dealerContacts.archivedAt),
      ),
    )
    .limit(1);
  return row?.contactId ?? null;
}

const stats = {
  rows: 0,
  skipFlagged: 0,
  dealersInserted: 0,
  dealersExisting: 0,
  dealersDupInRun: 0,
  contactsInserted: 0,
  contactsReusedExisting: 0,
  contactsReusedInRun: 0,
  contactsReusedByTitle: 0,
  linksInserted: 0,
  linksExisting: 0,
};

async function main(): Promise<void> {
  const file = JSON.parse(
    readFileSync(new URL('./data/atlantic-dealers.json', import.meta.url), 'utf8'),
  ) as AtlanticFile;
  const dropSet = buildDropSet(file);
  const seenDealer = new Map<string, number>(); // name+city → dealerId (in-run)
  const seenEmail = new Set<string>(); // dry-run cross-row reuse simulation

  console.log(`\n=== Atlantic BD import ${DRY_RUN ? '(DRY RUN — no writes)' : '(WRITING)'} ===`);
  console.log(`source: ${file.source}  rows: ${file.rows.length}  dropList: ${file.dropList.length}`);
  console.log(`target: ${printf(DATABASE_URL)}\n`);

  for (const row of file.rows) {
    stats.rows++;
    const mapped = mapRowToDealer(row);
    const key = dropKey(mapped.name, row.city);

    if (dropSet.has(key)) {
      stats.skipFlagged++;
      console.log(`[skip-flagged]   ${mapped.name} (${row.city}, ${row.province})`);
      continue;
    }

    // --- dealer find-or-create ---
    let dealerId = seenDealer.get(key) ?? null;
    let dealerDisp: string;
    if (dealerId != null) {
      stats.dealersDupInRun++;
      dealerDisp = 'skip-dup-in-run';
    } else {
      dealerId = await findExistingDealerId(mapped.name, mapped.address);
      if (dealerId != null) {
        stats.dealersExisting++;
        dealerDisp = 'skip-existing';
      } else if (DRY_RUN) {
        dealerId = -stats.rows; // placeholder id for dry-run reporting
        stats.dealersInserted++;
        dealerDisp = 'insert';
      } else {
        const [r] = await db
          .insert(dealers)
          .values({
            publicId: generatePublicId(),
            name: mapped.name,
            address: mapped.address,
            province: mapped.province,
            status: mapped.status,
            phone: mapped.phone,
            manufacturer: mapped.manufacturer,
            notes: mapped.notes,
            acquiredVia: mapped.acquiredVia,
          })
          .returning({ id: dealers.id });
        dealerId = r.id;
        stats.dealersInserted++;
        dealerDisp = 'insert';
      }
      seenDealer.set(key, dealerId);
    }

    // --- contacts (always reconciled, so a re-run is a no-op) ---
    const contactDisps: string[] = [];
    for (const c of mapped.contacts) {
      const tag = c.title === 'General Manager' ? 'GM' : 'SM';
      let contactId: number | null = null;
      let cDisp: string;

      if (c.email) {
        if (DRY_RUN) {
          if (seenEmail.has(c.email)) {
            stats.contactsReusedInRun++;
            cDisp = 'reuse(in-run)';
          } else {
            seenEmail.add(c.email);
            const existing = await findExistingContactIdByEmail(c.email);
            if (existing != null) {
              stats.contactsReusedExisting++;
              cDisp = 'reuse(db)';
            } else {
              stats.contactsInserted++;
              cDisp = 'insert';
            }
          }
        } else {
          contactId = await findExistingContactIdByEmail(c.email);
          if (contactId != null) {
            stats.contactsReusedExisting++;
            cDisp = 'reuse(db)';
          } else {
            contactId = await insertContactWithEmail(c.firstName, c.lastName, c.email);
            stats.contactsInserted++;
            cDisp = 'insert';
          }
        }
      } else {
        // name-only contact
        if (DRY_RUN) {
          stats.contactsInserted++;
          cDisp = 'insert(name-only)';
        } else {
          contactId = await findStaffContactIdByTitle(dealerId, c.title);
          if (contactId != null) {
            stats.contactsReusedByTitle++;
            cDisp = 'reuse(title)';
          } else {
            const [cr] = await db
              .insert(contacts)
              .values({ firstName: c.firstName, lastName: c.lastName })
              .returning({ id: contacts.id });
            contactId = cr.id;
            stats.contactsInserted++;
            cDisp = 'insert(name-only)';
          }
        }
      }

      // --- link dealer_contacts (idempotent) ---
      if (!DRY_RUN && contactId != null) {
        const lr = await db
          .insert(dealerContacts)
          .values({ dealerId, contactId, role: 'staff', title: c.title, source: ATLANTIC_IMPORT_SOURCE })
          .onConflictDoNothing()
          .returning({ id: dealerContacts.id });
        if (lr.length) stats.linksInserted++;
        else stats.linksExisting++;
      }
      contactDisps.push(`${tag}:${cDisp}`);
    }

    console.log(
      `[${dealerDisp.padEnd(15)}] ${mapped.name} (${row.city}, ${row.province})` +
        ` · ${mapped.manufacturer ?? '—'}` +
        (contactDisps.length ? `  ·  ${contactDisps.join(', ')}` : '  ·  (no contacts)'),
    );
  }

  printSummary();
}

// Insert a contact + its primary email identifier atomically (0085 orphan-row
// guarantee — if the process dies mid-insert, a contact can't exist without its
// email identifier, so a re-run finds it by email instead of duplicating it).
async function insertContactWithEmail(
  firstName: string,
  lastName: string,
  email: string,
): Promise<number> {
  return db.transaction(async (tx) => {
    const [cr] = await tx
      .insert(contacts)
      .values({ firstName, lastName })
      .returning({ id: contacts.id });
    await tx.insert(contactIdentifiers).values({
      contactId: cr.id,
      kind: 'email',
      value: email,
      isPrimary: true,
      source: ATLANTIC_IMPORT_SOURCE,
    });
    return cr.id;
  });
}

function printSummary(): void {
  console.log(`\n=== SUMMARY ${DRY_RUN ? '(DRY RUN)' : '(WRITTEN)'} ===`);
  console.log(`rows processed           : ${stats.rows}`);
  console.log(`  skip-flagged           : ${stats.skipFlagged}`);
  console.log(`dealers inserted         : ${stats.dealersInserted}`);
  console.log(`  skip-existing (DB)     : ${stats.dealersExisting}`);
  console.log(`  skip-dup-in-run        : ${stats.dealersDupInRun}`);
  console.log(`contacts inserted        : ${stats.contactsInserted}`);
  console.log(`  reuse existing (DB)    : ${stats.contactsReusedExisting}`);
  console.log(`  reuse in-run (email)   : ${stats.contactsReusedInRun}`);
  console.log(`  reuse by title (n-only): ${stats.contactsReusedByTitle}`);
  if (!DRY_RUN) {
    console.log(`dealer_contacts links    : ${stats.linksInserted} inserted, ${stats.linksExisting} already-linked`);
  }
  const distinctDealers = stats.dealersInserted + stats.dealersExisting;
  console.log(`→ distinct dealers handled: ${distinctDealers} (expected 274 on a clean DB)`);
}

// host:port only — never leak the password.
function printf(url: string): string {
  return url.replace(/.*@([^/?]+).*/, '$1');
}

main()
  .then(() => client.end())
  .catch(async (e) => {
    console.error(e);
    await client.end();
    process.exit(1);
  });
