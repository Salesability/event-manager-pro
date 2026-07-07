import { describe, it, expect } from 'vitest';
import type { Campaign } from './queries';
import { FEED_HEADERS, selectFeedCampaigns, mapCampaignToFeedRow } from './production-feed';

const TODAY = '2026-07-06';

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

describe('mapCampaignToFeedRow (0097)', () => {
  it('emits exactly FEED_HEADERS-length cells in order', () => {
    const row = mapCampaignToFeedRow(mk());
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
    ]);
  });

  it('renders null volumes / location / coach as empty cells', () => {
    const row = mapCampaignToFeedRow(
      mk({ dealerAddress: null, coachName: null, qtyRecords: null, smsEmail: null, letters: null, bdc: null }),
    );
    // Location, Coach, and the 4 volume columns
    expect(row[3]).toBe('');
    expect(row[5]).toBe('');
    expect(row.slice(6)).toEqual(['', '', '', '']);
  });

  it('never leaks notes, contact, phone, email, or audience source', () => {
    const row = mapCampaignToFeedRow(
      mk({
        notes: 'SENTINEL_NOTES',
        contact: 'SENTINEL_CONTACT',
        phone: 'SENTINEL_PHONE',
        email: 'SENTINEL_EMAIL',
        audienceSourceLabel: 'SENTINEL_SOURCE',
      }),
    );
    const joined = row.join('');
    for (const s of ['SENTINEL_NOTES', 'SENTINEL_CONTACT', 'SENTINEL_PHONE', 'SENTINEL_EMAIL', 'SENTINEL_SOURCE']) {
      expect(joined).not.toContain(s);
    }
  });
});
