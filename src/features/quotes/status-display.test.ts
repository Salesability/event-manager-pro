import { describe, expect, it } from 'vitest';
import { DEFAULT_QUOTE_INPUTS } from '@/lib/quotes/pricing';
import type { Quote } from './queries';
import { STATUS_PILL_CLS, displayStatusKey } from './status-display';

function makeQuote(overrides: Partial<Quote>): Quote {
  return {
    id: 1,
    dealerId: 1,
    dealerName: 'Test Dealer',
    dealerArchivedAt: null,
    status: 'draft',
    subtotal: '0.00',
    tax: '0.00',
    total: '0.00',
    taxPct: '15.00',
    inputs: DEFAULT_QUOTE_INPUTS,
    lineItems: [],
    audienceSourceId: null,
    audienceSourceLabel: null,
    sentAt: null,
    sentToEmail: null,
    sentToFirstName: null,
    acceptedAt: null,
    declinedAt: null,
    pdfStorageKey: null,
    quoteValidDays: 30,
    isExpired: false,
    createdAt: new Date(),
    createdById: null,
    ...overrides,
  };
}

describe('displayStatusKey', () => {
  it('returns the underlying status when not expired', () => {
    expect(displayStatusKey(makeQuote({ status: 'draft', isExpired: false }))).toBe('draft');
    expect(displayStatusKey(makeQuote({ status: 'sent', isExpired: false }))).toBe('sent');
    expect(displayStatusKey(makeQuote({ status: 'accepted', isExpired: false }))).toBe('accepted');
    expect(displayStatusKey(makeQuote({ status: 'declined', isExpired: false }))).toBe('declined');
  });

  it('returns "expired" when isExpired is true (overrides sent)', () => {
    expect(displayStatusKey(makeQuote({ status: 'sent', isExpired: true }))).toBe('expired');
  });
});

describe('STATUS_PILL_CLS', () => {
  it('carries a tailwind class for every display key', () => {
    for (const key of ['draft', 'sent', 'accepted', 'declined', 'expired'] as const) {
      expect(typeof STATUS_PILL_CLS[key]).toBe('string');
      expect(STATUS_PILL_CLS[key].length).toBeGreaterThan(0);
    }
  });
});
