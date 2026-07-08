import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { Campaign } from '@/features/schedule/queries';

// Mock the DB loader so the route test never touches Postgres. (`mock`-prefixed so
// vitest allows referencing it inside the hoisted factory.)
const mockLoadCampaigns = vi.fn();
const mockLoadDealerPrimaryContacts = vi.fn();
vi.mock('@/features/schedule/queries', () => ({
  loadCampaigns: () => mockLoadCampaigns(),
  loadDealerPrimaryContacts: (ids: number[]) => mockLoadDealerPrimaryContacts(ids),
}));

import { GET } from './route';

const TOKEN = 'test-secret-token-123';

function mk(overrides: Partial<Campaign> = {}): Campaign {
  return {
    id: 1,
    publicId: 'CMP-1',
    startDate: '2099-07-10',
    endDate: '2099-07-12',
    status: 'booked',
    dealerId: 10,
    dealerName: 'Future Dealer',
    dealerAddress: '1 Main St',
    coachId: 5,
    coachName: 'Jane Coach',
    styleId: 2,
    styleLabel: 'VIP Sales Event',
    audienceSourceId: 3,
    audienceSourceLabel: 'SENTINEL_SOURCE',
    qtyRecords: 500,
    smsEmail: 200,
    letters: 100,
    bdc: 50,
    contact: 'SENTINEL_CONTACT',
    phone: 'SENTINEL_PHONE',
    email: 'SENTINEL_EMAIL',
    notes: 'SENTINEL_NOTES',
    msaWaived: false,
    gcalSyncStatus: 'synced',
    gcalEventId: 'evt_1',
    ...overrides,
  };
}

function req(qs: string) {
  return new NextRequest(`http://localhost/api/production-feed${qs}`);
}

beforeEach(() => {
  mockLoadCampaigns.mockReset();
  mockLoadDealerPrimaryContacts.mockReset();
  mockLoadDealerPrimaryContacts.mockResolvedValue(new Map());
  process.env.PRODUCTION_FEED_TOKEN = TOKEN;
});

afterEach(() => {
  delete process.env.PRODUCTION_FEED_TOKEN;
});

describe('GET /api/production-feed (0097)', () => {
  it('401s with no token, without reading the DB', async () => {
    const res = await GET(req(''));
    expect(res.status).toBe(401);
    expect(mockLoadCampaigns).not.toHaveBeenCalled();
  });

  it('401s with a wrong token', async () => {
    const res = await GET(req('?token=nope'));
    expect(res.status).toBe(401);
    expect(mockLoadCampaigns).not.toHaveBeenCalled();
  });

  it('500s (fail-closed) when the token env is unset', async () => {
    delete process.env.PRODUCTION_FEED_TOKEN;
    const res = await GET(req('?token=anything'));
    expect(res.status).toBe(500);
    expect(mockLoadCampaigns).not.toHaveBeenCalled();
  });

  it('200s with a valid token: CSV of only booked+upcoming rows, with dealer contact + notes, no booking PII', async () => {
    mockLoadCampaigns.mockResolvedValue([
      mk({ dealerName: 'Booked Future', status: 'booked', endDate: '2099-12-31' }),
      mk({ dealerName: 'Completed Future', status: 'completed', endDate: '2099-12-31' }),
      mk({ dealerName: 'Draft Future', status: 'draft', endDate: '2099-12-31' }),
      mk({ dealerName: 'Cancelled Future', status: 'cancelled', endDate: '2099-12-31' }),
      mk({ dealerName: 'Booked Past', status: 'booked', startDate: '2000-01-01', endDate: '2000-01-02' }),
    ]);
    // Dealer primary contact (0098) for the fixture's dealerId 10.
    mockLoadDealerPrimaryContacts.mockResolvedValue(
      new Map([[10, { name: 'DEALER_NAME', phone: 'DEALER_PHONE', email: 'DEALER_EMAIL' }]]),
    );

    const res = await GET(req(`?token=${TOKEN}`));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/csv');

    const body = await res.text();
    const lines = body.split('\r\n');
    // Header + exactly the two included rows.
    expect(lines[0]).toContain('Start Date');
    expect(lines[0]).toContain('BDC');
    expect(lines[0]).toContain('Contact');
    expect(lines[0]).toContain('Notes');
    expect(lines).toHaveLength(3);
    expect(body).toContain('Booked Future');
    expect(body).toContain('Completed Future');
    expect(body).not.toContain('Draft Future');
    expect(body).not.toContain('Cancelled Future');
    expect(body).not.toContain('Booked Past');

    // Surfaced (0098): the dealer primary contact + the campaign notes.
    expect(body).toContain('DEALER_NAME');
    expect(body).toContain('DEALER_PHONE');
    expect(body).toContain('DEALER_EMAIL');
    expect(body).toContain('SENTINEL_NOTES');
    // Still redacted: the campaign's OWN booking contact + the audience source.
    for (const s of ['SENTINEL_CONTACT', 'SENTINEL_PHONE', 'SENTINEL_EMAIL', 'SENTINEL_SOURCE']) {
      expect(body).not.toContain(s);
    }
  });
});
