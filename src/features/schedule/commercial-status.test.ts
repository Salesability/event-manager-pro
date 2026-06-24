import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { isExposed, quoteDisplayStatus } from './commercial-status';

describe('isExposed', () => {
  // Protected = accepted quote AND active MSA. Everything else is exposed.
  it('is NOT exposed only when quote=accepted and MSA=active', () => {
    expect(isExposed('accepted', 'active')).toBe(false);
  });

  it('is exposed when the quote is accepted but the MSA is not active', () => {
    expect(isExposed('accepted', 'pending')).toBe(true);
    expect(isExposed('accepted', null)).toBe(true);
  });

  it('is exposed when the MSA is active but the quote is not accepted', () => {
    expect(isExposed('draft', 'active')).toBe(true);
    expect(isExposed('sent', 'active')).toBe(true);
    expect(isExposed('expired', 'active')).toBe(true);
    expect(isExposed('declined', 'active')).toBe(true);
    expect(isExposed(null, 'active')).toBe(true);
  });

  it('is exposed when both are missing (a bare booked date)', () => {
    expect(isExposed(null, null)).toBe(true);
  });
});

describe('quoteDisplayStatus', () => {
  const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);

  it('passes through non-sent statuses unchanged', () => {
    expect(quoteDisplayStatus({ status: 'draft', sentAt: null, quoteValidDays: 30 })).toBe('draft');
    expect(quoteDisplayStatus({ status: 'accepted', sentAt: daysAgo(99), quoteValidDays: 30 })).toBe(
      'accepted',
    );
    expect(quoteDisplayStatus({ status: 'declined', sentAt: daysAgo(99), quoteValidDays: 30 })).toBe(
      'declined',
    );
  });

  it('keeps a sent quote inside its validity window as sent', () => {
    expect(quoteDisplayStatus({ status: 'sent', sentAt: daysAgo(10), quoteValidDays: 30 })).toBe(
      'sent',
    );
  });

  it('derives expired when a sent quote is past sentAt + quoteValidDays', () => {
    expect(quoteDisplayStatus({ status: 'sent', sentAt: daysAgo(31), quoteValidDays: 30 })).toBe(
      'expired',
    );
  });

  it('never expires a sent quote with no sentAt', () => {
    expect(quoteDisplayStatus({ status: 'sent', sentAt: null, quoteValidDays: 30 })).toBe('sent');
  });
});
