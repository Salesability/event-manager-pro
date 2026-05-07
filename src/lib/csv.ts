// Shared CSV serialization helpers. Centralised so the production and
// reports export routes can't drift on encoding posture or CSV-injection
// mitigation — the parked Codex Medium from 0013 Phase 5.6 (production
// export) is fixed here once for both consumers.

// Excel and Google Sheets interpret leading `= + - @` as formula syntax —
// a malicious dealer name like `=HYPERLINK(...)` would exfil the row when
// the CSV is opened. They also TRIM leading whitespace before parsing, so
// `\n=cmd|...`, ` =...`, or NBSP/BOM-prefixed payloads all slip past a
// naive `^=` check. JS `\s` matches the modern Unicode whitespace set
// (incl. NBSP ` ` and ZWNBSP/BOM `﻿`), so a single `\s*` covers
// every leading-whitespace bypass.
const FORMULA_PREFIX = /^\s*[=+\-@]/;

// Wraps a value in CSV quote/escape and prepends a single-quote when the
// raw value (after any leading whitespace) starts with a formula introducer.
// The leading apostrophe is the canonical Excel-side escape; it survives the
// round-trip as a visible cell value rather than as a live formula.
export function csvCell(v: string): string {
  const safe = FORMULA_PREFIX.test(v) ? `'${v}` : v;
  return `"${safe.replace(/"/g, '""')}"`;
}

// Compose a CSV body from a header row + data rows. UTF-8 BOM is the first
// character so Excel auto-detects the encoding when the file is opened
// directly (without it, accented dealer names render as mojibake).
export function buildCsv(header: string[], rows: string[][]): string {
  const lines = [
    header.map(csvCell).join(','),
    ...rows.map((row) => row.map(csvCell).join(',')),
  ];
  return '﻿' + lines.join('\r\n');
}

export function csvResponse(filename: string, body: string): Response {
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
}
