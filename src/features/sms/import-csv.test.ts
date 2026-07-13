import { describe, expect, it } from 'vitest';
import { normalizePhoneE164, parseRecipientsCsv, splitCsvLine } from './import-csv';

describe('normalizePhoneE164', () => {
  it('normalises NANP formats to +1 E.164', () => {
    expect(normalizePhoneE164('9025551234')).toBe('+19025551234');
    expect(normalizePhoneE164('(902) 555-1234')).toBe('+19025551234');
    expect(normalizePhoneE164('1-902-555-1234')).toBe('+19025551234');
    expect(normalizePhoneE164('+1 902 555 1234')).toBe('+19025551234');
  });

  it('accepts international numbers with a leading +', () => {
    expect(normalizePhoneE164('+447911123456')).toBe('+447911123456');
  });

  it('rejects malformed numbers', () => {
    expect(normalizePhoneE164('')).toBeNull();
    expect(normalizePhoneE164('555-1234')).toBeNull(); // 7 digits, no country
    expect(normalizePhoneE164('29025551234')).toBeNull(); // 11 digits not starting 1
    expect(normalizePhoneE164('+0123456')).toBeNull(); // leading 0 after +
  });
});

describe('splitCsvLine', () => {
  it('splits plain and quoted fields, unescaping doubled quotes', () => {
    expect(splitCsvLine('a,b,c')).toEqual(['a', 'b', 'c']);
    expect(splitCsvLine('"Smith, Jr.",b')).toEqual(['Smith, Jr.', 'b']);
    expect(splitCsvLine('"say ""hi""",x')).toEqual(['say "hi"', 'x']);
    expect(splitCsvLine('a,,c')).toEqual(['a', '', 'c']);
  });
});

describe('parseRecipientsCsv', () => {
  const HEADER = 'phone,first_name,last_name,consent_basis,last_contact_at';

  it('parses a valid file, normalising phones', () => {
    const result = parseRecipientsCsv(
      [
        HEADER,
        '(902) 555-1234,Pat,Chen,implied_purchase,2026-01-15',
        '+19025557777,Sam,,express,',
      ].join('\n'),
    );
    expect(result).toEqual({
      ok: true,
      duplicatesDropped: 0,
      rows: [
        {
          phone: '+19025551234',
          firstName: 'Pat',
          lastName: 'Chen',
          consentBasis: 'implied_purchase',
          lastContactAt: '2026-01-15',
        },
        {
          phone: '+19025557777',
          firstName: 'Sam',
          lastName: null,
          consentBasis: 'express',
          lastContactAt: null,
        },
      ],
    });
  });

  it('is header-order-insensitive and case-insensitive', () => {
    const result = parseRecipientsCsv(
      ['CONSENT_BASIS,Phone', 'express,9025551234'].join('\n'),
    );
    expect(result).toMatchObject({
      ok: true,
      rows: [{ phone: '+19025551234', consentBasis: 'express' }],
    });
  });

  it('drops in-file duplicate phones (keep-first) and reports the count', () => {
    const result = parseRecipientsCsv(
      [HEADER, '9025551234,A,,express,', '(902)555-1234,B,,express,'].join('\n'),
    );
    expect(result).toMatchObject({ ok: true, duplicatesDropped: 1 });
    if ('ok' in result) {
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].firstName).toBe('A');
    }
  });

  it('rejects the whole file when any row is invalid (all-or-nothing)', () => {
    const result = parseRecipientsCsv(
      [HEADER, '9025551234,Pat,,express,', 'not-a-phone,Sam,,express,'].join('\n'),
    );
    expect(result).toMatchObject({
      error: expect.stringContaining('1 row(s) failed validation'),
    });
    if ('error' in result) {
      expect(result.rowErrors?.[0]).toContain('Row 3');
    }
  });

  it('rejects a bad consent_basis with a row-numbered error', () => {
    const result = parseRecipientsCsv(
      [HEADER, '9025551234,Pat,,verbal,'].join('\n'),
    );
    expect(result).toMatchObject({
      rowErrors: [expect.stringContaining('consent_basis must be')],
    });
  });

  it('rejects a malformed last_contact_at', () => {
    const result = parseRecipientsCsv(
      [HEADER, '9025551234,Pat,,express,01/15/2026'].join('\n'),
    );
    expect(result).toMatchObject({
      rowErrors: [expect.stringContaining('last_contact_at must be YYYY-MM-DD')],
    });
  });

  it('requires the phone and consent_basis columns', () => {
    const result = parseRecipientsCsv(['phone,first_name', '9025551234,Pat'].join('\n'));
    expect(result).toMatchObject({
      error: expect.stringContaining('consent_basis'),
    });
  });

  it('rejects a header-only or empty file', () => {
    expect(parseRecipientsCsv(HEADER)).toMatchObject({
      error: expect.stringContaining('header row and at least one recipient'),
    });
    expect(parseRecipientsCsv('')).toMatchObject({ error: expect.any(String) });
  });
});
