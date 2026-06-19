import { CA_PROVINCE_CODES, type CaProvinceCode } from '@/lib/ca-provinces';

// Pure mapper for the one-time Atlantic Canada BD-list import (chunk 0086). No DB
// or QBO imports — unit-tested in CI and consumed by the runner
// `scripts/import-atlantic-dealers.ts` (which adds the DB dedup + upsert around
// it). The decisions encoded here are pinned in `docs/chunks/0086-*/decision.md`.

// One raw row from `scripts/data/atlantic-dealers.json` (a faithful dump of the
// "Dealer Tracker" sheet; trimmed strings, BD-workflow columns not exported).
export type AtlanticRow = {
  manufacturer: string;
  dealership: string;
  city: string;
  province: string;
  group: string;
  phone: string;
  gm: string;
  contact1Email: string;
  sm: string;
  contact2Email: string;
  coopEligible: string;
  notes: string;
  verification: string;
};

export type AtlanticFile = {
  source: string;
  sheet: string;
  rowCount: number;
  dropList: { name: string; city: string; reason: string }[];
  rows: AtlanticRow[];
};

// Batch tag on `dealers.acquired_via` (D2) and the `source` stamped on inserted
// `dealer_contacts` / `contact_identifiers` rows (mirrors the legacy import's
// `source: 'sheets-import'`).
export const ATLANTIC_ACQUIRED_VIA = 'Atlantic Canada BD list';
export const ATLANTIC_IMPORT_SOURCE = 'atlantic-bd-import';

export type ContactTitle = 'General Manager' | 'Sales Manager';

export type MappedContact = {
  title: ContactTitle;
  firstName: string;
  lastName: string;
  /** Lowercased + trimmed email, or null for a name-only contact (D3). */
  email: string | null;
};

export type MappedDealer = {
  name: string;
  /** City only (D6) — province is its own column. */
  address: string | null;
  province: CaProvinceCode | null;
  phone: string | null;
  manufacturer: string | null;
  notes: string | null;
  acquiredVia: string;
  status: 'prospect';
  contacts: MappedContact[];
};

const trimOrNull = (s: string): string | null => s.trim() || null;
const lowerKey = (s: string): string => s.trim().toLowerCase();

// Dealer dedup / drop-list key: case- + whitespace-insensitive name + city (D4).
export function dropKey(name: string, city: string): string {
  return `${lowerKey(name)}|${lowerKey(city)}`;
}

export function buildDropSet(file: Pick<AtlanticFile, 'dropList'>): Set<string> {
  return new Set(file.dropList.map((d) => dropKey(d.name, d.city)));
}

// Mirrors `scripts/import-from-sheets.ts:splitName` — first token vs. the rest.
export function splitName(full: string): { firstName: string; lastName: string } {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return { firstName: parts[0] ?? '', lastName: '' };
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') };
}

// Readable notes block (D2): Group / Contact Verification / Co-op eligibility /
// original sheet notes — only the non-empty parts, newline-joined. Co-op is empty
// across the current list but handled for forward-safety.
export function buildNotesBlock(row: AtlanticRow): string | null {
  const parts: string[] = [];
  if (row.group.trim()) parts.push(`Group: ${row.group.trim()}`);
  if (row.verification.trim()) parts.push(`Verification: ${row.verification.trim()}`);
  if (row.coopEligible.trim()) parts.push(`Co-op eligible: ${row.coopEligible.trim()}`);
  if (row.notes.trim()) parts.push(row.notes.trim());
  return parts.length ? parts.join('\n') : null;
}

function provinceOrNull(p: string): CaProvinceCode | null {
  const up = p.trim().toUpperCase();
  return (CA_PROVINCE_CODES as readonly string[]).includes(up)
    ? (up as CaProvinceCode)
    : null;
}

function emailOrNull(e: string): string | null {
  const v = e.trim().toLowerCase();
  return v.includes('@') ? v : null;
}

// Up to two staff contacts per rooftop (GM + GSM/SM). An empty slot (no name AND
// no email) is dropped; a name-only slot yields a contact with `email: null`.
export function mapRowToContacts(row: AtlanticRow): MappedContact[] {
  const slots: ReadonlyArray<[string, ContactTitle, string]> = [
    [row.gm, 'General Manager', row.contact1Email],
    [row.sm, 'Sales Manager', row.contact2Email],
  ];
  const out: MappedContact[] = [];
  for (const [rawName, title, rawEmail] of slots) {
    const name = rawName.trim();
    const email = emailOrNull(rawEmail);
    if (!name && !email) continue;
    const { firstName, lastName } = splitName(name);
    out.push({ title, firstName, lastName, email });
  }
  return out;
}

export function mapRowToDealer(row: AtlanticRow): MappedDealer {
  return {
    name: row.dealership.trim(),
    address: trimOrNull(row.city),
    province: provinceOrNull(row.province),
    phone: trimOrNull(row.phone),
    manufacturer: trimOrNull(row.manufacturer),
    notes: buildNotesBlock(row),
    acquiredVia: ATLANTIC_ACQUIRED_VIA,
    status: 'prospect',
    contacts: mapRowToContacts(row),
  };
}
