import { describe, expect, it } from 'vitest';
import { EMAIL_RE, field, parseId, validateContactInputs } from './validators';

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
