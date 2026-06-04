// One-time import of QuickBooks Online **Customers** → `dealers` (+ their staff
// contact), modeled on `scripts/import-from-sheets.ts`. Read-only against QBO.
//
// QBO vocabulary bridge: a QBO `Customer` is a company-you-invoice = our
// `dealers` row. The person on that customer record is our point of contact
// *at* the dealership → `dealer_contacts(role='staff')` (NOT `role='customer'`,
// which is reserved for the dealership's own car-buyers). See
// docs/chunks/0060-quickbooks-integration/{intent,research,plan}.md.
//
// This script does NOT perform the OAuth dance. Mint a short-lived access token
// + realmId from the Intuit OAuth 2.0 Playground (production keys) — the access
// token lasts ~1h, which is plenty for a one-time run — then:
//
//   # DRY RUN (default — prints what it would do, writes nothing):
//   QBO_ACCESS_TOKEN=… QBO_REALM_ID=… DATABASE_URL=<prod-session-pooler-5432> \
//     pnpm dlx tsx scripts/import-from-quickbooks.ts
//
//   # LIVE (actually writes):
//   IMPORT_WRITE=1 QBO_ACCESS_TOKEN=… QBO_REALM_ID=… DATABASE_URL=… \
//     pnpm dlx tsx scripts/import-from-quickbooks.ts
//
// Env:
//   QBO_ACCESS_TOKEN   (required) bearer token from the OAuth Playground
//   QBO_REALM_ID       (required) the connected company id (Playground shows it)
//   DATABASE_URL       (required) target DB — for prod use the session pooler (5432)
//   QBO_ENV            production | sandbox   (default: production)
//   QBO_MINOR_VERSION  default: 75   (minor versions 1–74 retired 2025-08-01)
//   IMPORT_WRITE       '1' to write; anything else = dry run
//   QBO_INCLUDE_INACTIVE '1' to include inactive QBO customers (default: active only)

import { randomBytes } from 'node:crypto';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from '../src/lib/db/schema';
import {
  contactIdentifiers,
  contacts,
  dealerContacts,
  dealers,
} from '../src/lib/db/schema';

const generatePublicId = () => randomBytes(9).toString('base64url');
const SOURCE = 'quickbooks-import';

// ---------- config ----------

const ACCESS_TOKEN = process.env.QBO_ACCESS_TOKEN;
const REALM_ID = process.env.QBO_REALM_ID;
const DATABASE_URL = process.env.DATABASE_URL;
const QBO_ENV = (process.env.QBO_ENV ?? 'production').trim().toLowerCase();
const MINOR_VERSION = (process.env.QBO_MINOR_VERSION ?? '75').trim();
const WRITE = process.env.IMPORT_WRITE === '1';
const INCLUDE_INACTIVE = process.env.QBO_INCLUDE_INACTIVE === '1';

if (!ACCESS_TOKEN || !REALM_ID || !DATABASE_URL) {
  console.error('Missing env: QBO_ACCESS_TOKEN, QBO_REALM_ID, DATABASE_URL');
  process.exit(1);
}

const QBO_BASE =
  QBO_ENV === 'sandbox'
    ? 'https://sandbox-quickbooks.api.intuit.com'
    : 'https://quickbooks.api.intuit.com';

const client = postgres(DATABASE_URL, { prepare: false });
const db = drizzle(client, { schema });

// ---------- QBO fetch ----------

type QboAddr = {
  Line1?: string;
  Line2?: string;
  Line3?: string;
  City?: string;
  CountrySubDivisionCode?: string;
  PostalCode?: string;
  Country?: string;
};

type QboCustomer = {
  Id: string;
  DisplayName?: string;
  CompanyName?: string;
  GivenName?: string;
  FamilyName?: string;
  Active?: boolean;
  Job?: boolean; // true when this is a sub-customer / job
  ParentRef?: { value: string };
  BillAddr?: QboAddr;
  ShipAddr?: QboAddr;
  PrimaryEmailAddr?: { Address?: string };
  PrimaryPhone?: { FreeFormNumber?: string };
  Mobile?: { FreeFormNumber?: string };
};

async function fetchAllCustomers(): Promise<QboCustomer[]> {
  const all: QboCustomer[] = [];
  const pageSize = 100; // QBO query API caps at 1000; 100 is the safe default
  let start = 1;

  for (;;) {
    // ORDER BY Id keeps offset pagination stable across pages. (Customers are
    // not mutating mid-run for a one-time seed, so Id order is sufficient.)
    const where = INCLUDE_INACTIVE ? '' : 'WHERE Active = true ';
    const query = `SELECT * FROM Customer ${where}ORDER BY Id STARTPOSITION ${start} MAXRESULTS ${pageSize}`;
    const url = `${QBO_BASE}/v3/company/${REALM_ID}/query?query=${encodeURIComponent(
      query,
    )}&minorversion=${MINOR_VERSION}`;

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${ACCESS_TOKEN}`, Accept: 'application/json' },
    });

    if (res.status === 401) {
      throw new Error(
        '401 from QBO — the access token is expired or invalid. Tokens last ~1h; ' +
          're-mint a fresh one from the OAuth 2.0 Playground and re-run.',
      );
    }
    if (!res.ok) {
      throw new Error(`QBO query ${res.status} ${res.statusText}: ${await res.text()}`);
    }

    const json = (await res.json()) as { QueryResponse?: { Customer?: QboCustomer[] } };
    const batch = json.QueryResponse?.Customer ?? [];
    all.push(...batch);
    if (batch.length < pageSize) break;
    start += pageSize;
  }

  return all;
}

// ---------- mapping ----------

type DealerImport = {
  qboId: string;
  name: string;
  address: string | null;
  firstName: string | null;
  lastName: string | null;
  email: string | null; // normalized lowercase (matches the dedup index)
  phone: string | null; // trimmed as-entered (app does not E.164-normalize)
  isJob: boolean;
};

function formatAddress(a?: QboAddr): string | null {
  if (!a) return null;
  const cityLine = [a.City, a.CountrySubDivisionCode, a.PostalCode]
    .map((s) => (s ?? '').trim())
    .filter(Boolean)
    .join(' ');
  const parts = [a.Line1, a.Line2, a.Line3, cityLine, a.Country]
    .map((s) => (s ?? '').trim())
    .filter(Boolean);
  const joined = parts.join(', ');
  return joined || null;
}

function mapCustomer(c: QboCustomer): DealerImport {
  const name = (c.CompanyName?.trim() || c.DisplayName?.trim() || '').trim();
  const email = c.PrimaryEmailAddr?.Address?.trim().toLowerCase() || null;
  const phone = (c.PrimaryPhone?.FreeFormNumber || c.Mobile?.FreeFormNumber || '').trim() || null;
  const firstName = c.GivenName?.trim() || null;
  const lastName = c.FamilyName?.trim() || null;
  return {
    qboId: c.Id,
    name,
    address: formatAddress(c.BillAddr) ?? formatAddress(c.ShipAddr),
    firstName,
    lastName,
    email,
    phone,
    isJob: c.Job === true || !!c.ParentRef,
  };
}

// ---------- writers (match-or-create, idempotent) ----------

async function findOrCreateDealer(
  d: DealerImport,
): Promise<{ dealerId: number; created: boolean }> {
  const nameLower = d.name.toLowerCase();
  const addressLower = (d.address ?? '').toLowerCase();

  const existing = await db
    .select({ id: dealers.id })
    .from(dealers)
    .where(
      sql`lower(${dealers.name}) = ${nameLower} AND lower(coalesce(${dealers.address}, '')) = ${addressLower}`,
    )
    .limit(1);

  if (existing.length > 0) return { dealerId: existing[0].id, created: false };

  const [row] = await db
    .insert(dealers)
    .values({
      publicId: generatePublicId(),
      name: d.name,
      address: d.address,
      status: 'active', // existing paying customers
      acquiredVia: 'QuickBooks import',
    })
    .returning({ id: dealers.id });
  return { dealerId: row.id, created: true };
}

async function findContactByIdentifier(
  kind: 'email' | 'phone',
  value: string,
): Promise<number | null> {
  const found = await db
    .select({ contactId: contactIdentifiers.contactId })
    .from(contactIdentifiers)
    .where(
      and(
        eq(contactIdentifiers.kind, kind),
        eq(contactIdentifiers.value, value),
        isNull(contactIdentifiers.archivedAt),
      ),
    )
    .limit(1);
  return found.length > 0 ? found[0].contactId : null;
}

// Returns the contact id linked to the dealer as staff, or null when there's no
// person to link (company-only QBO record with no GivenName/FamilyName).
async function findOrCreateStaffContact(
  d: DealerImport,
  dealerId: number,
): Promise<number | null> {
  // No named person → no staff contact. (We don't fabricate a person from the
  // company name; the dealer row stands on its own.)
  if (!d.firstName && !d.lastName) return null;

  if (d.email) {
    const hit = await findContactByIdentifier('email', d.email);
    if (hit != null) return hit;
  }
  if (d.phone) {
    const hit = await findContactByIdentifier('phone', d.phone);
    if (hit != null) return hit;
  }

  // Name-only fallback: a QBO customer carries at most one contact person, so
  // if this dealer already has a staff link reuse it rather than duplicate.
  const existingStaff = await db
    .select({ contactId: dealerContacts.contactId })
    .from(dealerContacts)
    .where(and(eq(dealerContacts.dealerId, dealerId), eq(dealerContacts.role, 'staff')))
    .limit(1);
  if (existingStaff.length > 0) return existingStaff[0].contactId;

  const [row] = await db
    .insert(contacts)
    .values({ firstName: d.firstName ?? '', lastName: d.lastName ?? '' })
    .returning({ id: contacts.id });
  const contactId = row.id;

  if (d.email) {
    await db.insert(contactIdentifiers).values({
      contactId,
      kind: 'email',
      value: d.email,
      isPrimary: true,
      source: SOURCE,
    });
  }
  if (d.phone) {
    await db.insert(contactIdentifiers).values({
      contactId,
      kind: 'phone',
      value: d.phone,
      isPrimary: true,
      source: SOURCE,
    });
  }

  return contactId;
}

// ---------- main ----------

async function main() {
  console.log(
    `QuickBooks import — env=${QBO_ENV} realm=${REALM_ID} ` +
      `mode=${WRITE ? 'LIVE WRITE' : 'DRY RUN'} ` +
      `(${INCLUDE_INACTIVE ? 'incl. inactive' : 'active only'})`,
  );

  const customers = await fetchAllCustomers();
  console.log(`Fetched ${customers.length} QBO customers.`);

  const mapped = customers.map(mapCustomer).filter((d) => d.name);
  const jobs = mapped.filter((d) => d.isJob);
  const dealersToImport = mapped.filter((d) => !d.isJob); // skip sub-customers/jobs for v1
  const nameless = mapped.length - mapped.filter((d) => d.name).length;
  if (nameless > 0) console.log(`  (${nameless} customers had no usable name — skipped)`);
  if (jobs.length > 0) {
    console.log(`  Skipping ${jobs.length} sub-customers / jobs (v1 flattens these out):`);
    for (const j of jobs) console.log(`    - ${j.name} (QBO Id ${j.qboId})`);
  }

  let dealersInserted = 0;
  let dealersReused = 0;
  let staffLinked = 0;
  let dealersWithoutContact = 0;
  let droppedChannels = 0; // company email/phone we couldn't attach (no person)

  for (const d of dealersToImport) {
    if (!WRITE) {
      const contactStr =
        d.firstName || d.lastName
          ? `${[d.firstName, d.lastName].filter(Boolean).join(' ')}` +
            `${d.email ? ` <${d.email}>` : ''}${d.phone ? ` ${d.phone}` : ''}`
          : d.email || d.phone
            ? `(no person; would DROP ${[d.email, d.phone].filter(Boolean).join(' / ')})`
            : '(no contact)';
      console.log(
        `  DEALER  ${d.name}${d.address ? ` — ${d.address}` : ''}\n` +
          `          staff: ${contactStr}  [QBO Id ${d.qboId}]`,
      );
      if (!d.firstName && !d.lastName && (d.email || d.phone)) droppedChannels++;
      continue;
    }

    const { dealerId, created } = await findOrCreateDealer(d);
    if (created) dealersInserted++;
    else dealersReused++;

    const contactId = await findOrCreateStaffContact(d, dealerId);
    if (contactId == null) {
      dealersWithoutContact++;
      if (d.email || d.phone) droppedChannels++;
      continue;
    }

    await db
      .insert(dealerContacts)
      .values({
        dealerId,
        contactId,
        role: 'staff',
        source: SOURCE,
      })
      .onConflictDoNothing();
    staffLinked++;
  }

  console.log('');
  if (WRITE) {
    console.log(
      `Done (LIVE). dealers: ${dealersInserted} inserted, ${dealersReused} reused; ` +
        `staff links: ${staffLinked}; dealers w/o contact: ${dealersWithoutContact}; ` +
        `dropped channels (no person): ${droppedChannels}.`,
    );
  } else {
    console.log(
      `Done (DRY RUN). ${dealersToImport.length} dealers would be imported; ` +
        `${droppedChannels} have a company email/phone but no person (would be dropped). ` +
        `Re-run with IMPORT_WRITE=1 to write.`,
    );
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await client.end();
  });
