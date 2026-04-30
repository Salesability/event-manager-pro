import { describe, expect, it } from 'vitest';
import {
  EMAIL_RE,
  field,
  parseCampaignInput,
  parseDate,
  parseId,
  parseOptionalId,
  parseOptionalInt,
  validateContactInputs,
} from './validators';

describe('EMAIL_RE', () => {
  it('accepts plausible addresses', () => {
    expect(EMAIL_RE.test('foo@bar.com')).toBe(true);
    expect(EMAIL_RE.test('first.last+tag@sub.example.co.uk')).toBe(true);
  });

  it('rejects strings that are missing @ or domain', () => {
    expect(EMAIL_RE.test('foo')).toBe(false);
    expect(EMAIL_RE.test('foo@bar')).toBe(false);
    expect(EMAIL_RE.test('@bar.com')).toBe(false);
    expect(EMAIL_RE.test('foo@.com')).toBe(false);
    expect(EMAIL_RE.test('foo @bar.com')).toBe(false);
  });
});

describe('field', () => {
  it('reads and trims a string entry', () => {
    const fd = new FormData();
    fd.set('name', '  Acme Motors  ');
    expect(field(fd, 'name')).toBe('Acme Motors');
  });

  it('returns "" for missing keys', () => {
    expect(field(new FormData(), 'missing')).toBe('');
  });

  it('coerces non-string entries to "" via String() of empty FormData get', () => {
    const fd = new FormData();
    fd.set('blank', '');
    expect(field(fd, 'blank')).toBe('');
  });
});

describe('parseId', () => {
  it('returns positive integers', () => {
    const fd = new FormData();
    fd.set('id', '42');
    expect(parseId(fd)).toBe(42);
  });

  it('respects a custom field name', () => {
    const fd = new FormData();
    fd.set('dealerId', '7');
    expect(parseId(fd, 'dealerId')).toBe(7);
  });

  it('rejects zero, negatives, decimals, NaN, missing, and non-numeric input', () => {
    const make = (v: string | null) => {
      const fd = new FormData();
      if (v != null) fd.set('id', v);
      return parseId(fd);
    };
    expect(make('0')).toBe(null);
    expect(make('-1')).toBe(null);
    expect(make('1.5')).toBe(null);
    expect(make('abc')).toBe(null);
    expect(make('')).toBe(null);
    expect(make(null)).toBe(null);
  });
});

describe('validateContactInputs', () => {
  const empty = {
    contactFirst: '',
    contactLast: '',
    contactEmail: '',
    contactPhone: '',
  };

  it('passes when all fields empty (no contact being created)', () => {
    expect(validateContactInputs(empty)).toBe(null);
  });

  it('passes when first + last + optional fields all valid', () => {
    expect(
      validateContactInputs({
        contactFirst: 'Alex',
        contactLast: 'Kim',
        contactEmail: 'alex@example.com',
        contactPhone: '555-1234',
      })
    ).toBe(null);
  });

  it('requires both names if any contact field is present', () => {
    expect(
      validateContactInputs({ ...empty, contactFirst: 'Alex' })
    ).toMatch(/first and last name/i);
    expect(
      validateContactInputs({ ...empty, contactLast: 'Kim' })
    ).toMatch(/first and last name/i);
    expect(
      validateContactInputs({ ...empty, contactEmail: 'a@b.co' })
    ).toMatch(/first and last name/i);
    expect(
      validateContactInputs({ ...empty, contactPhone: '555-1234' })
    ).toMatch(/first and last name/i);
  });

  it('flags an invalid email even when names are provided', () => {
    expect(
      validateContactInputs({
        contactFirst: 'Alex',
        contactLast: 'Kim',
        contactEmail: 'not-an-email',
        contactPhone: '',
      })
    ).toMatch(/email looks invalid/i);
  });

  it('allows empty email when names are provided', () => {
    expect(
      validateContactInputs({
        contactFirst: 'Alex',
        contactLast: 'Kim',
        contactEmail: '',
        contactPhone: '555-1234',
      })
    ).toBe(null);
  });
});

describe('parseDate', () => {
  const make = (v: string | null) => {
    const fd = new FormData();
    if (v != null) fd.set('d', v);
    return parseDate(fd, 'd');
  };

  it('accepts YYYY-MM-DD strings (HTML input[type=date] format)', () => {
    expect(make('2026-04-30')).toBe('2026-04-30');
    expect(make('2024-01-01')).toBe('2024-01-01');
  });

  it('rejects empty / missing / non-iso input', () => {
    expect(make(null)).toBe(null);
    expect(make('')).toBe(null);
    expect(make('2026/04/30')).toBe(null);
    expect(make('30-04-2026')).toBe(null);
    expect(make('2026-4-1')).toBe(null);
    expect(make('not-a-date')).toBe(null);
  });
});

describe('parseOptionalId', () => {
  const make = (v: string | null) => {
    const fd = new FormData();
    if (v != null) fd.set('x', v);
    return parseOptionalId(fd, 'x');
  };

  it('returns positive integers', () => {
    expect(make('1')).toBe(1);
    expect(make('99')).toBe(99);
  });

  it('returns null for empty / missing (so the FK column stays null)', () => {
    expect(make(null)).toBe(null);
    expect(make('')).toBe(null);
  });

  it('returns null for zero, negatives, decimals, garbage', () => {
    expect(make('0')).toBe(null);
    expect(make('-3')).toBe(null);
    expect(make('1.5')).toBe(null);
    expect(make('abc')).toBe(null);
  });
});

describe('parseOptionalInt', () => {
  const make = (v: string | null) => {
    const fd = new FormData();
    if (v != null) fd.set('x', v);
    return parseOptionalInt(fd, 'x');
  };

  it('accepts any integer (including 0 and negatives)', () => {
    expect(make('0')).toBe(0);
    expect(make('42')).toBe(42);
    expect(make('-5')).toBe(-5);
  });

  it('returns null for empty / missing', () => {
    expect(make(null)).toBe(null);
    expect(make('')).toBe(null);
  });

  it('rejects decimals and non-numeric input', () => {
    expect(make('1.5')).toBe(null);
    expect(make('abc')).toBe(null);
  });
});

describe('parseCampaignInput', () => {
  function makeForm(overrides: Record<string, string> = {}) {
    const fd = new FormData();
    fd.set('startDate', '2026-05-01');
    fd.set('endDate', '2026-05-03');
    fd.set('dealerId', '7');
    Object.entries(overrides).forEach(([k, v]) => {
      if (v === '__delete__') fd.delete(k);
      else fd.set(k, v);
    });
    return fd;
  }

  it('returns the parsed shape on a minimal valid form', () => {
    const result = parseCampaignInput(makeForm());
    expect(result).toEqual({
      startDate: '2026-05-01',
      endDate: '2026-05-03',
      dealerId: 7,
      coachId: null,
      styleId: null,
      salesLeadSourceId: null,
      qtyRecords: null,
      smsEmail: null,
      letters: null,
      bdc: null,
      contact: null,
      phone: null,
      email: null,
      notes: null,
    });
  });

  it('parses optional FK and integer fields when present', () => {
    const result = parseCampaignInput(
      makeForm({
        coachId: '12',
        styleId: '3',
        salesLeadSourceId: '5',
        qtyRecords: '500',
        smsEmail: '0',
        letters: '120',
        bdc: '15',
        contact: 'Jane Smith',
        phone: '555-0100',
        email: 'JANE@example.com',
        notes: 'priority',
      }),
    );
    expect(result).toMatchObject({
      coachId: 12,
      styleId: 3,
      salesLeadSourceId: 5,
      qtyRecords: 500,
      smsEmail: 0,
      letters: 120,
      bdc: 15,
      contact: 'Jane Smith',
      phone: '555-0100',
      email: 'jane@example.com',
      notes: 'priority',
    });
  });

  it('rejects missing or malformed dates', () => {
    expect(parseCampaignInput(makeForm({ startDate: '' }))).toEqual({
      error: 'Start and end date are required (YYYY-MM-DD).',
    });
    expect(parseCampaignInput(makeForm({ startDate: '2026/05/01' }))).toEqual({
      error: 'Start and end date are required (YYYY-MM-DD).',
    });
  });

  it('rejects when endDate is before startDate', () => {
    expect(
      parseCampaignInput(makeForm({ startDate: '2026-05-10', endDate: '2026-05-09' })),
    ).toEqual({ error: 'End date must be on or after start date.' });
  });

  it('accepts a single-day campaign (start == end)', () => {
    const r = parseCampaignInput(makeForm({ endDate: '2026-05-01' }));
    expect(r).toMatchObject({ startDate: '2026-05-01', endDate: '2026-05-01' });
  });

  it('rejects when dealerId is missing or invalid', () => {
    expect(parseCampaignInput(makeForm({ dealerId: '' }))).toEqual({
      error: 'Dealer is required.',
    });
    expect(parseCampaignInput(makeForm({ dealerId: '0' }))).toEqual({
      error: 'Dealer is required.',
    });
    expect(parseCampaignInput(makeForm({ dealerId: 'abc' }))).toEqual({
      error: 'Dealer is required.',
    });
  });

  it('rejects an invalid email', () => {
    expect(parseCampaignInput(makeForm({ email: 'not-an-email' }))).toEqual({
      error: 'Contact email looks invalid.',
    });
  });
});
