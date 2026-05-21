// One-time import of legacy Google Sheets data into the new Drizzle/Supabase schema.
// See docs/chunks/2026-04-30-sheets-import/{notes,plan}.md.
//
// Run: set -a && source .env.local && set +a && pnpm dlx tsx scripts/import-from-sheets.ts

import { randomBytes } from 'node:crypto';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from '../src/lib/db/schema';
import {
  campaignStyles,
  campaigns,
  contactIdentifiers,
  contacts,
  dealerContacts,
  dealers,
  audienceSources,
  teamMemberRoles,
} from '../src/lib/db/schema';

const generatePublicId = () => randomBytes(9).toString('base64url');

function splitName(full: string): { firstName: string; lastName: string } {
  const parts = full.trim().split(/\s+/);
  if (parts.length <= 1) return { firstName: parts[0] ?? '', lastName: '' };
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') };
}

const SPREADSHEET_ID = process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
const API_KEY = process.env.GOOGLE_SHEETS_API_KEY;
const DATABASE_URL = process.env.DATABASE_URL;

if (!SPREADSHEET_ID || !API_KEY || !DATABASE_URL) {
  console.error('Missing env: GOOGLE_SHEETS_SPREADSHEET_ID, GOOGLE_SHEETS_API_KEY, DATABASE_URL');
  process.exit(1);
}

const client = postgres(DATABASE_URL, { prepare: false });
const db = drizzle(client, { schema });

async function fetchTab(name: string): Promise<string[][]> {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${encodeURIComponent(name)}?key=${API_KEY}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Sheets fetch ${name}: ${res.status} ${res.statusText}`);
  const json = (await res.json()) as { values?: string[][] };
  return json.values ?? [];
}

type CoachRow = {
  legacyId: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
};

function parseCoachRows(rows: string[][]): CoachRow[] {
  return rows
    .map((r) => ({
      legacyId: (r[0] ?? '').trim(),
      firstName: (r[1] ?? '').trim(),
      lastName: (r[2] ?? '').trim(),
      email: ((r[3] ?? '').trim() || null) as string | null,
      phone: ((r[4] ?? '').trim() || null) as string | null,
    }))
    .filter((c) => c.legacyId && c.firstName && c.lastName);
}

function dedupCoaches(parsed: CoachRow[]) {
  const canonical: CoachRow[] = [];
  const legacyToCanonicalIndex = new Map<string, number>();
  const emailIndex = new Map<string, number>();

  for (const row of parsed) {
    const emailKey = row.email?.toLowerCase() ?? null;
    if (emailKey && emailIndex.has(emailKey)) {
      legacyToCanonicalIndex.set(row.legacyId, emailIndex.get(emailKey)!);
      continue;
    }
    const i = canonical.length;
    canonical.push({ ...row, email: emailKey });
    legacyToCanonicalIndex.set(row.legacyId, i);
    if (emailKey) emailIndex.set(emailKey, i);
  }

  return { canonical, legacyToCanonicalIndex };
}

async function findExistingCoachContactId(c: CoachRow): Promise<number | null> {
  if (c.email) {
    const found = await db
      .select({ contactId: contactIdentifiers.contactId })
      .from(contactIdentifiers)
      .where(
        and(
          eq(contactIdentifiers.kind, 'email'),
          eq(contactIdentifiers.value, c.email),
          isNull(contactIdentifiers.archivedAt)
        )
      )
      .limit(1);
    if (found.length > 0) return found[0].contactId;
    return null;
  }

  // Emailless coach: dedup on (first_name, last_name) joined with a coach role
  const found = await db
    .select({ contactId: contacts.id })
    .from(contacts)
    .innerJoin(teamMemberRoles, eq(teamMemberRoles.contactId, contacts.id))
    .where(
      and(
        eq(contacts.firstName, c.firstName),
        eq(contacts.lastName, c.lastName),
        eq(teamMemberRoles.role, 'coach')
      )
    )
    .limit(1);
  return found.length > 0 ? found[0].contactId : null;
}

async function importCoaches(): Promise<Map<string, number>> {
  console.log('— Coaches → contacts + team_member_roles —');
  const rows = await fetchTab('Coaches');
  const parsed = parseCoachRows(rows);
  const { canonical, legacyToCanonicalIndex } = dedupCoaches(parsed);
  console.log(`  ${rows.length} sheet rows → ${canonical.length} unique coaches (after email dedup)`);

  let inserted = 0;
  let reused = 0;
  const canonicalContactIds: number[] = [];

  for (const c of canonical) {
    let contactId = await findExistingCoachContactId(c);

    if (contactId == null) {
      const [row] = await db
        .insert(contacts)
        .values({ firstName: c.firstName, lastName: c.lastName })
        .returning({ id: contacts.id });
      contactId = row.id;
      inserted++;

      if (c.email) {
        await db.insert(contactIdentifiers).values({
          contactId,
          kind: 'email',
          value: c.email,
          isPrimary: true,
          source: 'sheets-import',
        });
      }
      if (c.phone) {
        await db.insert(contactIdentifiers).values({
          contactId,
          kind: 'phone',
          value: c.phone,
          isPrimary: true,
          source: 'sheets-import',
        });
      }
    } else {
      reused++;
    }

    canonicalContactIds.push(contactId);

    await db
      .insert(teamMemberRoles)
      .values({ contactId, role: 'coach' })
      .onConflictDoNothing();
  }

  console.log(`  inserted ${inserted} new contacts; reused ${reused} existing`);

  const legacyToContactId = new Map<string, number>();
  for (const [legacyId, idx] of legacyToCanonicalIndex.entries()) {
    legacyToContactId.set(legacyId, canonicalContactIds[idx]);
  }

  console.log('  legacy ID → contact ID map:');
  for (const [k, v] of legacyToContactId.entries()) {
    console.log(`    ${k} → ${v}`);
  }

  return legacyToContactId;
}

type ClientRow = {
  legacyId: string;
  companyName: string;
  contactName: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
};

function parseClientRows(rows: string[][]): ClientRow[] {
  return rows
    .map((r) => ({
      legacyId: (r[0] ?? '').trim(),
      companyName: (r[1] ?? '').trim(),
      contactName: ((r[2] ?? '').trim() || null) as string | null,
      phone: ((r[3] ?? '').trim() || null) as string | null,
      email: ((r[4] ?? '').trim() || null) as string | null,
      address: ((r[5] ?? '').trim() || null) as string | null,
    }))
    .filter((r) => r.legacyId && r.companyName);
}

async function findOrCreateDealer(c: ClientRow): Promise<{ dealerId: number; created: boolean }> {
  const nameLower = c.companyName.toLowerCase();
  const addressLower = (c.address ?? '').toLowerCase();

  const existing = await db
    .select({ id: dealers.id })
    .from(dealers)
    .where(
      sql`lower(${dealers.name}) = ${nameLower} AND lower(coalesce(${dealers.address}, '')) = ${addressLower}`
    )
    .limit(1);

  if (existing.length > 0) return { dealerId: existing[0].id, created: false };

  const [row] = await db
    .insert(dealers)
    .values({
      publicId: generatePublicId(),
      name: c.companyName,
      address: c.address,
    })
    .returning({ id: dealers.id });
  return { dealerId: row.id, created: true };
}

async function findOrCreateContactForClient(
  c: ClientRow,
  dealerId: number
): Promise<number | null> {
  if (!c.contactName) return null;

  const emailLower = c.email?.toLowerCase() ?? null;
  const phoneTrim = c.phone?.trim() ?? null;

  if (emailLower) {
    const found = await db
      .select({ contactId: contactIdentifiers.contactId })
      .from(contactIdentifiers)
      .where(
        and(
          eq(contactIdentifiers.kind, 'email'),
          eq(contactIdentifiers.value, emailLower),
          isNull(contactIdentifiers.archivedAt)
        )
      )
      .limit(1);
    if (found.length > 0) return found[0].contactId;
  }

  if (phoneTrim) {
    const found = await db
      .select({ contactId: contactIdentifiers.contactId })
      .from(contactIdentifiers)
      .where(
        and(
          eq(contactIdentifiers.kind, 'phone'),
          eq(contactIdentifiers.value, phoneTrim),
          isNull(contactIdentifiers.archivedAt)
        )
      )
      .limit(1);
    if (found.length > 0) return found[0].contactId;
  }

  // Name-only fallback: legacy Clients data is one customer per dealer, so if
  // this dealer already has a customer link we reuse that contact rather than
  // create a duplicate.
  const existing = await db
    .select({ contactId: dealerContacts.contactId })
    .from(dealerContacts)
    .where(and(eq(dealerContacts.dealerId, dealerId), eq(dealerContacts.role, 'customer')))
    .limit(1);
  if (existing.length > 0) return existing[0].contactId;

  const { firstName, lastName } = splitName(c.contactName);
  const [row] = await db
    .insert(contacts)
    .values({ firstName, lastName })
    .returning({ id: contacts.id });
  const contactId = row.id;

  if (emailLower) {
    await db.insert(contactIdentifiers).values({
      contactId,
      kind: 'email',
      value: emailLower,
      isPrimary: true,
      source: 'sheets-import',
    });
  }
  if (phoneTrim) {
    await db.insert(contactIdentifiers).values({
      contactId,
      kind: 'phone',
      value: phoneTrim,
      isPrimary: true,
      source: 'sheets-import',
    });
  }

  return contactId;
}

async function importClients(): Promise<Map<string, number>> {
  console.log('— Clients → dealers + contacts + dealer_contacts —');
  const rows = await fetchTab('Clients');
  const parsed = parseClientRows(rows);
  console.log(`  ${rows.length} sheet rows → ${parsed.length} usable`);

  const legacyToDealerId = new Map<string, number>();
  let dealersInserted = 0;
  let dealersReused = 0;
  let contactsLinked = 0;
  let dealersWithoutContact = 0;

  for (const c of parsed) {
    const { dealerId, created } = await findOrCreateDealer(c);
    legacyToDealerId.set(c.legacyId, dealerId);
    if (created) dealersInserted++;
    else dealersReused++;

    const contactId = await findOrCreateContactForClient(c, dealerId);
    if (contactId == null) {
      dealersWithoutContact++;
      continue;
    }

    await db
      .insert(dealerContacts)
      .values({
        dealerId,
        contactId,
        role: 'customer',
        source: 'sheets-import',
      })
      .onConflictDoNothing();
    contactsLinked++;
  }

  console.log(
    `  dealers: ${dealersInserted} inserted, ${dealersReused} reused; ` +
      `dealer_contacts linked: ${contactsLinked}; dealers w/o contact: ${dealersWithoutContact}`
  );

  return legacyToDealerId;
}

type EventRow = {
  legacyId: string;
  startDate: string;
  endDate: string;
  legacyClientId: string;
  legacyCoachId: string;
  format: string | null;
  dataSource: string | null;
  qtyRecords: number | null;
  smsEmail: number | null;
  letters: number | null;
  bdc: number | null;
  contact: string | null;
  phone: string | null;
  email: string | null;
  notes: string | null;
  createdAt: string | null;
  fee: string | null;
  depositPct: string | null;
  taxPct: string | null;
  quoteValidDays: number | null;
  travel: string | null;
  quoteNotes: string | null;
};

function parseEventRow(r: string[]): EventRow {
  // Schema-era handling: 12-col rows are ancient — only indices 0-5 + the
  // timestamp at index 11 are stable; columns 6-10 had different meanings
  // pre-rewrite, so import them as null.
  const isAncient = r.length < 16;

  const text = (s: string | undefined) => {
    const t = (s ?? '').trim();
    return t || null;
  };
  const num = (s: string | undefined) => {
    const t = (s ?? '').trim();
    if (!t) return null;
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
  };
  const numStr = (s: string | undefined) => {
    const t = (s ?? '').trim();
    if (!t) return null;
    const n = Number(t);
    return Number.isFinite(n) ? t : null;
  };

  return {
    legacyId: (r[0] ?? '').trim(),
    startDate: (r[1] ?? '').trim(),
    endDate: (r[2] ?? '').trim(),
    legacyClientId: (r[3] ?? '').trim(),
    legacyCoachId: (r[4] ?? '').trim(),
    format: text(r[5]),
    dataSource: isAncient ? null : text(r[6]),
    qtyRecords: isAncient ? null : num(r[7]),
    smsEmail: isAncient ? null : num(r[8]),
    letters: isAncient ? null : num(r[9]),
    bdc: isAncient ? null : num(r[10]),
    contact: isAncient ? null : text(r[11]),
    phone: isAncient ? null : text(r[12]),
    email: isAncient ? null : text(r[13]),
    notes: isAncient ? null : text(r[14]),
    createdAt: isAncient ? text(r[11]) : text(r[15]),
    fee: numStr(r[16]),
    depositPct: numStr(r[17]),
    taxPct: numStr(r[18]),
    quoteValidDays: num(r[19]),
    travel: numStr(r[20]),
    quoteNotes: text(r[21]),
  };
}

async function importCampaigns(
  legacyToContactId: Map<string, number>,
  legacyToDealerId: Map<string, number>
) {
  console.log('— Events → campaigns —');
  const rows = await fetchTab('Events');

  const styleRows = await db
    .select({ id: campaignStyles.id, label: campaignStyles.label })
    .from(campaignStyles);
  const styleByLabel = new Map(styleRows.map((s) => [s.label, s.id]));

  const sourceRows = await db
    .select({ id: audienceSources.id, label: audienceSources.label })
    .from(audienceSources);
  const sourceByLabel = new Map(sourceRows.map((s) => [s.label, s.id]));

  let inserted = 0;
  let skipped = 0;
  const warnings: string[] = [];

  for (const r of rows) {
    const ev = parseEventRow(r);
    if (!ev.legacyId) {
      skipped++;
      continue;
    }

    const dealerId = legacyToDealerId.get(ev.legacyClientId);
    const coachId = legacyToContactId.get(ev.legacyCoachId);
    if (!dealerId) {
      warnings.push(`${ev.legacyId}: missing dealer for ${ev.legacyClientId}`);
      skipped++;
      continue;
    }

    const styleId = ev.format ? styleByLabel.get(ev.format) ?? null : null;
    const audienceSourceId = ev.dataSource
      ? sourceByLabel.get(ev.dataSource) ?? null
      : null;

    if (ev.format && !styleId)
      warnings.push(`${ev.legacyId}: unseen style ${JSON.stringify(ev.format)}`);
    if (ev.dataSource && !audienceSourceId)
      warnings.push(`${ev.legacyId}: unseen lead source ${JSON.stringify(ev.dataSource)}`);

    const values = {
      publicId: ev.legacyId,
      dealerId,
      coachId: coachId ?? null,
      styleId,
      audienceSourceId,
      startDate: ev.startDate,
      endDate: ev.endDate,
      qtyRecords: ev.qtyRecords,
      smsEmail: ev.smsEmail,
      letters: ev.letters,
      bdc: ev.bdc,
      contact: ev.contact,
      phone: ev.phone,
      email: ev.email,
      notes: ev.notes,
      quoteNotes: ev.quoteNotes,
      createdAt: ev.createdAt ? new Date(ev.createdAt) : undefined,
    } satisfies typeof campaigns.$inferInsert;

    const result = await db
      .insert(campaigns)
      .values(values)
      .onConflictDoNothing({ target: campaigns.publicId })
      .returning({ id: campaigns.id });

    if (result.length > 0) inserted++;
  }

  console.log(`  ${rows.length} sheet rows → inserted: ${inserted}, skipped: ${skipped}`);
  if (warnings.length) {
    console.log('  warnings:');
    for (const w of warnings) console.log(`    ${w}`);
  }
}

async function main() {
  try {
    const coachMap = await importCoaches();
    const dealerMap = await importClients();
    await importCampaigns(coachMap, dealerMap);
    console.log(
      `\nDone. ${coachMap.size} legacy coach IDs and ${dealerMap.size} legacy client IDs mapped.`
    );
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
