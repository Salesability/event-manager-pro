import { z } from 'zod';

// Parsing + validation for the per-campaign dealer-list CSV (0103 D2). Pure —
// no DB, no env — so the header/row/phone rules are unit-testable. The action
// (`importSmsRecipients`) treats the file as all-or-nothing: any invalid row
// rejects the import with per-row errors, so a half-imported list can never
// silently under-count the pre-send review.
//
// Expected header (order-insensitive, case-insensitive):
//   phone, first_name, last_name, consent_basis, last_contact_at
// `last_name` and `last_contact_at` may be blank; `consent_basis` must be one
// of express | implied_purchase | implied_inquiry (D3).

export type ParsedRecipientRow = {
  phone: string; // normalised E.164
  firstName: string | null;
  lastName: string | null;
  consentBasis: 'express' | 'implied_purchase' | 'implied_inquiry';
  lastContactAt: string | null; // YYYY-MM-DD
};

export type ImportParseResult =
  | { ok: true; rows: ParsedRecipientRow[]; duplicatesDropped: number }
  | { error: string; rowErrors?: string[] };

const REQUIRED_COLUMNS = ['phone', 'consent_basis'] as const;
const KNOWN_COLUMNS = [
  'phone',
  'first_name',
  'last_name',
  'consent_basis',
  'last_contact_at',
] as const;

// Minimal RFC-4180 field splitter: quoted fields may contain commas, quotes
// escape as "". Handles \r\n and \n. No embedded-newline support inside
// quotes — dealer lists are one-recipient-per-line exports; a stray embedded
// newline surfaces as a row error rather than a mis-parse.
export function splitCsvLine(line: string): string[] {
  const fields: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      fields.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  fields.push(cur);
  return fields.map((f) => f.trim());
}

// North-America-default E.164 normalisation: strips formatting, accepts
// `9025551234`, `19025551234`, `+19025551234`, `(902) 555-1234`, etc. A
// leading `+` accepts any valid international number as-is; bare digits are
// assumed NANP (+1). Returns null when the digits can't form a valid number.
export function normalizePhoneE164(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const hasPlus = trimmed.startsWith('+');
  const digits = trimmed.replace(/[^0-9]/g, '');
  if (hasPlus) {
    return /^[1-9][0-9]{6,14}$/.test(digits) ? `+${digits}` : null;
  }
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return null;
}

const rowSchema = z.object({
  phone: z.string().min(1, 'phone is required'),
  first_name: z.string().optional().default(''),
  last_name: z.string().optional().default(''),
  consent_basis: z.enum(['express', 'implied_purchase', 'implied_inquiry'], {
    error: 'consent_basis must be express, implied_purchase, or implied_inquiry',
  }),
  last_contact_at: z
    .string()
    .optional()
    .default('')
    .refine((v) => v === '' || /^\d{4}-\d{2}-\d{2}$/.test(v), {
      message: 'last_contact_at must be YYYY-MM-DD or blank',
    }),
});

function utcDateString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function isRealCalendarDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

export function parseRecipientsCsv(text: string, today = new Date()): ImportParseResult {
  const todayUtc = utcDateString(today);
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.replace(/^﻿/, ''))
    .filter((l) => l.trim() !== '');
  if (lines.length < 2) {
    return { error: 'CSV needs a header row and at least one recipient row.' };
  }

  const header = splitCsvLine(lines[0]).map((h) => h.toLowerCase());
  for (const col of REQUIRED_COLUMNS) {
    if (!header.includes(col)) {
      return {
        error: `CSV is missing the required "${col}" column. Expected columns: ${KNOWN_COLUMNS.join(', ')}.`,
      };
    }
  }

  const rows: ParsedRecipientRow[] = [];
  const rowErrors: string[] = [];
  const seen = new Set<string>();
  let duplicatesDropped = 0;

  for (let i = 1; i < lines.length; i++) {
    const fields = splitCsvLine(lines[i]);
    const record: Record<string, string> = {};
    header.forEach((col, idx) => {
      record[col] = fields[idx] ?? '';
    });

    const parsed = rowSchema.safeParse(record);
    if (!parsed.success) {
      rowErrors.push(`Row ${i + 1}: ${parsed.error.issues[0]?.message ?? 'invalid row'}`);
      continue;
    }

    const phone = normalizePhoneE164(parsed.data.phone);
    if (!phone) {
      rowErrors.push(`Row ${i + 1}: "${parsed.data.phone}" is not a valid phone number`);
      continue;
    }
    if (parsed.data.last_contact_at) {
      if (
        !isRealCalendarDate(parsed.data.last_contact_at) ||
        parsed.data.last_contact_at > todayUtc
      ) {
        rowErrors.push(`Row ${i + 1}: last_contact_at must be a real date on or before today`);
        continue;
      }
    }
    if (seen.has(phone)) {
      duplicatesDropped++;
      continue;
    }
    seen.add(phone);

    rows.push({
      phone,
      firstName: parsed.data.first_name.trim() || null,
      lastName: parsed.data.last_name.trim() || null,
      consentBasis: parsed.data.consent_basis,
      lastContactAt: parsed.data.last_contact_at || null,
    });
  }

  if (rowErrors.length) {
    return {
      error: `${rowErrors.length} row(s) failed validation — nothing was imported.`,
      rowErrors: rowErrors.slice(0, 10),
    };
  }
  if (!rows.length) {
    return { error: 'CSV contained no importable recipient rows.' };
  }
  return { ok: true, rows, duplicatesDropped };
}
