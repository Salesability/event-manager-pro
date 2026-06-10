import { describe, expect, it } from 'vitest';
import { DEFAULT_QUOTE_INPUTS } from '@/lib/quotes/pricing';
import type { Quote } from './queries';
import { displayStatusKey } from './status-display';

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
    taxOverride: null,
    province: null,
    inputs: DEFAULT_QUOTE_INPUTS,
    pickedLines: [],
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
    quickbooksEstimateId: null,
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

