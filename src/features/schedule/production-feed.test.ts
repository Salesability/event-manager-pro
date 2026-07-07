import { describe, it, expect } from 'vitest';
import type { Campaign } from './queries';
import {
  FEED_HEADERS,
  selectFeedCampaigns,
  mapCampaignToFeedRow,
  type FeedDealerContact,
} from './production-feed';

const TODAY = '2026-07-06';

const DEALER_CONTACT: FeedDealerContact = {
  name: 'Dana Dealer',
  phone: '902-555-0199',
  email: 'dana@rooftop.example',
};

function mk(overrides: Partial<Campaign> = {}): Campaign {
  return {
    id: 1,
    publicId: 'CMP-1',
    startDate: '2026-07-10',
    endDate: '2026-07-12',
    status: 'booked',
    dealerId: 10,
    dealerName: 'Summerside Hyundai',
    dealerAddress: '123 Water St, Summerside PE',
    coachId: 5,
    coachName: 'Jane Coach',
    styleId: 2,
    styleLabel: 'VIP Sales Event',
    audienceSourceId: 3,
    audienceSourceLabel: 'Owner base',
    qtyRecords: 500,
    smsEmail: 200,
    letters: 100,
    bdc: 50,
    contact: 'Bob Buyer',
    phone: '902-555-0100',
    email: 'bob@dealer.example',
    notes: 'internal-only note',
    gcalSyncStatus: 'synced',
    gcalEventId: 'evt_1',
    ...overrides,
  };
}

describe('selectFeedCampaigns (0097)', () => {
  it('includes a booked campaign whose run is not fully past', () => {
    const rows = selectFeedCampaigns([mk({ status: 'booked', endDate: '2026-07-12' })], TODAY);
    expect(rows).toHaveLength(1);
  });

  it('includes a completed campaign still on/after today', () => {
    const rows = selectFeedCampaigns([mk({ status: 'completed', endDate: TODAY })], TODAY);
    expect(rows).toHaveLength(1);
  });

  it('excludes draft and cancelled campaigns', () => {
    const rows = selectFeedCampaigns(
      [mk({ status: 'draft' }), mk({ status: 'cancelled' })],
      TODAY,
    );
    expect(rows).toHaveLength(0);
  });

  it('excludes a fully-past campaign even when booked', () => {
    const rows = selectFeedCampaigns(
      [mk({ status: 'booked', startDate: '2026-06-01', endDate: '2026-06-10' })],
      TODAY,
    );
    expect(rows).toHaveLength(0);
  });
});

describe('mapCampaignToFeedRow (0097 + 0098 contact/notes)', () => {
  it('emits exactly FEED_HEADERS-length cells in order', () => {
    const row = mapCampaignToFeedRow(mk(), DEALER_CONTACT);
    expect(row).toHaveLength(FEED_HEADERS.length);
    expect(row).toEqual([
      '2026-07-10',
      '2026-07-12',
      'Summerside Hyundai',
      '123 Water St, Summerside PE',
      'VIP Sales Event',
      'Jane Coach',
      '500',
      '200',
      '100',
      '50',
      'Dana Dealer',
      '902-555-0199',
      'dana@rooftop.example',
      'internal-only note',
    ]);
  });

  it('renders null volumes / location / coach, an absent dealer contact, and null notes as empty cells', () => {
    const row = mapCampaignToFeedRow(
      mk({ dealerAddress: null, coachName: null, qtyRecords: null, smsEmail: null, letters: null, bdc: null, notes: null }),
      undefined,
    );
    // Location, Coach
    expect(row[3]).toBe('');
    expect(row[5]).toBe('');
    // 4 volumes + 3 contact cells + notes — all blank
    expect(row.slice(6)).toEqual(['', '', '', '', '', '', '', '']);
  });

  it('surfaces the dealer primary contact + notes, but never the campaign booking contact or audience source', () => {
    const row = mapCampaignToFeedRow(
      mk({
        notes: 'SENTINEL_NOTES',
        contact: 'SENTINEL_CONTACT',
        phone: 'SENTINEL_PHONE',
        email: 'SENTINEL_EMAIL',
        audienceSourceLabel: 'SENTINEL_SOURCE',
      }),
      { name: 'DEALER_NAME', phone: 'DEALER_PHONE', email: 'DEALER_EMAIL' },
    );
    const joined = row.join('');
    // Surfaced (0098): dealer primary contact + the campaign notes.
    expect(joined).toContain('DEALER_NAME');
    expect(joined).toContain('DEALER_PHONE');
    expect(joined).toContain('DEALER_EMAIL');
    expect(joined).toContain('SENTINEL_NOTES');
    // Still redacted: the campaign's OWN booking contact + the audience source.
    for (const s of ['SENTINEL_CONTACT', 'SENTINEL_PHONE', 'SENTINEL_EMAIL', 'SENTINEL_SOURCE']) {
      expect(joined).not.toContain(s);
    }
  });
});
