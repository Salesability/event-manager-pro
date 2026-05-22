import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  assertCan: vi.fn(),
  loadCampaignsByDealer: vi.fn(),
  loadCampaignsByCoach: vi.fn(),
  loadCampaignsByMonth: vi.fn(),
  loadFullProductionReport: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/auth/assert-can', () => ({ assertCan: mocks.assertCan }));
vi.mock('@/features/schedule/queries', () => ({
  loadCampaignsByDealer: mocks.loadCampaignsByDealer,
  loadCampaignsByCoach: mocks.loadCampaignsByCoach,
  loadCampaignsByMonth: mocks.loadCampaignsByMonth,
  loadFullProductionReport: mocks.loadFullProductionReport,
}));

import { GET } from './route';

function makeRequest(qs: Record<string, string> = {}): NextRequest {
  const url = new URL('https://example.test/reports/export');
  for (const [k, v] of Object.entries(qs)) url.searchParams.set(k, v);
  return new NextRequest(url);
}

async function csvBody(res: Response): Promise<string> {
  return await res.text();
}

describe('GET /reports/export', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // assertCan resolves with a User stub when the gate passes.
    mocks.assertCan.mockResolvedValue({ id: 'user-uuid' });
    mocks.loadCampaignsByDealer.mockResolvedValue([]);
    mocks.loadCampaignsByCoach.mockResolvedValue([]);
    mocks.loadCampaignsByMonth.mockResolvedValue([]);
    mocks.loadFullProductionReport.mockResolvedValue([]);
  });

  it('asserts the staff gate (admin OR coach) before any query runs', async () => {
    mocks.loadCampaignsByDealer.mockResolvedValue([
      {
        groupKey: 1,
        groupLabel: 'Capital Ford',
        count: 3,
        totalQty: 1500,
        totalSms: 0,
        totalLetters: 0,
      },
    ]);
    await GET(makeRequest({ tab: 'dealer' }));
    expect(mocks.assertCan).toHaveBeenCalledWith('reports:view');
    // Order invariant: gate runs before any loader. If a future refactor
    // reorders the await chain so a query fires before assertCan resolves,
    // this assertion via mock invocation order catches it.
    const gateOrder = mocks.assertCan.mock.invocationCallOrder[0];
    const loaderOrder = mocks.loadCampaignsByDealer.mock.invocationCallOrder[0];
    expect(gateOrder).toBeLessThan(loaderOrder);
  });

  it('rejects unauthorized requests without firing any loader (mirrors redirect() throw)', async () => {
    // Real `assertCan` calls `redirect()` on auth failure, which throws a
    // `NEXT_REDIRECT` error rather than returning. Simulate that here so
    // the test proves the GET handler short-circuits before touching any
    // query function.
    mocks.assertCan.mockRejectedValue(new Error('NEXT_REDIRECT'));
    await expect(GET(makeRequest({ tab: 'dealer' }))).rejects.toThrow('NEXT_REDIRECT');
    expect(mocks.loadCampaignsByDealer).not.toHaveBeenCalled();
    expect(mocks.loadCampaignsByCoach).not.toHaveBeenCalled();
    expect(mocks.loadCampaignsByMonth).not.toHaveBeenCalled();
    expect(mocks.loadFullProductionReport).not.toHaveBeenCalled();
  });

  it('tab=dealer emits the 5-col aggregate CSV with proper headers', async () => {
    mocks.loadCampaignsByDealer.mockResolvedValue([
      {
        groupKey: 1,
        groupLabel: 'Capital Ford',
        count: 3,
        totalQty: 1500,
        totalSms: 0,
        totalLetters: 0,
      },
      {
        groupKey: 2,
        groupLabel: 'Downtown Honda',
        count: 1,
        totalQty: 0,
        totalSms: 250,
        totalLetters: 100,
      },
    ]);
    const res = await GET(makeRequest({ tab: 'dealer' }));
    expect(res.headers.get('Content-Type')).toContain('text/csv');
    expect(res.headers.get('Content-Disposition')).toContain('reports-dealer-');
    const body = await csvBody(res);
    expect(body).toContain('"Dealer","Campaigns","Records","SMS/Email","Letters"');
    expect(body).toContain('"Capital Ford","3","1500","0","0"');
    expect(body).toContain('"Downtown Honda","1","0","250","100"');
  });

  it('tab=coach shows the Unassigned label for null groupKey', async () => {
    mocks.loadCampaignsByCoach.mockResolvedValue([
      {
        groupKey: null,
        groupLabel: 'Unassigned',
        count: 2,
        totalQty: 100,
        totalSms: 50,
        totalLetters: 0,
      },
      {
        groupKey: 7,
        groupLabel: 'Alex Coach',
        count: 5,
        totalQty: 4000,
        totalSms: 200,
        totalLetters: 50,
      },
    ]);
    const body = await csvBody(await GET(makeRequest({ tab: 'coach' })));
    expect(body).toContain('"Unassigned","2","100","50","0"');
    expect(body).toContain('"Alex Coach","5","4000","200","50"');
  });

  it('tab=month relabels YYYY-MM as long-form Month YYYY', async () => {
    mocks.loadCampaignsByMonth.mockResolvedValue([
      {
        groupKey: '2026-01',
        groupLabel: 'January 2026',
        count: 4,
        totalQty: 2500,
        totalSms: 100,
        totalLetters: 0,
      },
    ]);
    const body = await csvBody(await GET(makeRequest({ tab: 'month' })));
    expect(body).toContain('"January 2026","4","2500","100","0"');
  });

  it('tab=full emits the rich production-shape CSV', async () => {
    mocks.loadFullProductionReport.mockResolvedValue([
      {
        id: 1,
        publicId: 'evt-001',
        startDate: '2026-05-06',
        endDate: '2026-05-08',
        status: 'booked',
        dealerId: 1,
        dealerName: 'Capital Ford',
        dealerAddress: null,
        coachId: 7,
        coachName: 'Alex Coach',
        styleId: null,
        styleLabel: 'VIP Sales Event',
        audienceSourceId: null,
        audienceSourceLabel: 'Third Party List',
        qtyRecords: 1500,
        smsEmail: 1500,
        letters: 0,
        bdc: null,
        contact: 'Jane Buyer',
        phone: '555-0100',
        email: 'jane@example.test',
        notes: null,
        billing: {},
      },
    ]);
    const body = await csvBody(await GET(makeRequest({ tab: 'full' })));
    expect(body).toContain('"Date Range","Dealership","Contact"');
    expect(body).toContain('"2026-05-06 → 2026-05-08","Capital Ford"');
    expect(body).toContain('"Jane Buyer / 555-0100 / jane@example.test"');
    expect(body).toContain('"VIP Sales Event"');
  });

  it('falls back to tab=dealer when tab param is missing or unknown', async () => {
    mocks.loadCampaignsByDealer.mockResolvedValue([
      {
        groupKey: 1,
        groupLabel: 'X',
        count: 1,
        totalQty: 0,
        totalSms: 0,
        totalLetters: 0,
      },
    ]);
    // No tab param.
    let body = await csvBody(await GET(makeRequest()));
    expect(body).toContain('"Dealer","Campaigns"');

    // Unknown tab.
    mocks.loadCampaignsByDealer.mockClear();
    body = await csvBody(await GET(makeRequest({ tab: '../etc/passwd' })));
    expect(body).toContain('"Dealer","Campaigns"');
    expect(mocks.loadCampaignsByDealer).toHaveBeenCalled();
    // Confirm no other loader fired — defends the whitelist parser.
    expect(mocks.loadFullProductionReport).not.toHaveBeenCalled();
  });

  it('runs the CSV-injection mitigation through buildCsv (e.g. =SUM dealer name)', async () => {
    mocks.loadCampaignsByDealer.mockResolvedValue([
      {
        groupKey: 1,
        groupLabel: '=SUM(A1:A10)',
        count: 1,
        totalQty: 0,
        totalSms: 0,
        totalLetters: 0,
      },
    ]);
    const body = await csvBody(await GET(makeRequest({ tab: 'dealer' })));
    expect(body).toContain(`"'=SUM(A1:A10)"`);
  });
});
