import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  // Queue of arrays returned by successive db.select(...) chains. Each
  // aggregation loader issues exactly one query, so one entry = one loader call.
  selectResults: [] as unknown[][],
}));

vi.mock('server-only', () => ({}));

vi.mock('@/lib/db', () => ({
  db: {
    select: () => ({
      from: () => {
        const result = () => Promise.resolve(mocks.selectResults.shift() ?? []);
        const terminal = {
          orderBy: () => result(),
          then: (onFulfilled: (v: unknown[]) => unknown) => result().then(onFulfilled),
        };
        const groupable = { groupBy: () => terminal };
        return {
          // `.from(...).groupBy(...).orderBy(...)` (loadCampaignsByDealer hits
          // this shape after the innerJoin step below).
          groupBy: groupable.groupBy,
          orderBy: terminal.orderBy,
          innerJoin: () => groupable,
          leftJoin: () => groupable,
        };
      },
    }),
  },
}));

import {
  loadCampaignsByCoach,
  loadCampaignsByDealer,
  loadCampaignsByMonth,
} from './queries';

describe('loadCampaignsByDealer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.selectResults = [];
  });

  it('coalesces nullable totals to 0 and projects to the aggregate row shape', async () => {
    mocks.selectResults = [
      [
        {
          dealerId: 1,
          dealerName: 'Capital Ford',
          count: 3,
          totalQty: 1500,
          totalSms: 0,
          totalLetters: 0,
        },
        {
          dealerId: 2,
          dealerName: 'Downtown Honda',
          count: 1,
          totalQty: 0,
          totalSms: 250,
          totalLetters: 100,
        },
      ],
    ];
    const result = await loadCampaignsByDealer();
    expect(result).toEqual([
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
  });

  it('returns an empty list when there are no campaigns', async () => {
    mocks.selectResults = [[]];
    expect(await loadCampaignsByDealer()).toEqual([]);
  });
});

describe('loadCampaignsByCoach', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.selectResults = [];
  });

  it('labels the null-coach row as "Unassigned" and trims partial names', async () => {
    mocks.selectResults = [
      [
        {
          coachId: null,
          firstName: null,
          lastName: null,
          count: 2,
          totalQty: 100,
          totalSms: 50,
          totalLetters: 0,
        },
        {
          coachId: 7,
          firstName: 'Alex',
          lastName: 'Coach',
          count: 5,
          totalQty: 4000,
          totalSms: 200,
          totalLetters: 50,
        },
        {
          coachId: 8,
          firstName: null,
          lastName: 'OnlyLast',
          count: 1,
          totalQty: 0,
          totalSms: 0,
          totalLetters: 0,
        },
      ],
    ];
    const result = await loadCampaignsByCoach();
    expect(result.map((r) => ({ key: r.groupKey, label: r.groupLabel }))).toEqual([
      { key: null, label: 'Unassigned' },
      { key: 7, label: 'Alex Coach' },
      { key: 8, label: 'OnlyLast' },
    ]);
  });
});

describe('loadCampaignsByMonth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.selectResults = [];
  });

  it('formats YYYY-MM keys to "Month YYYY" labels', async () => {
    mocks.selectResults = [
      [
        {
          monthKey: '2026-01',
          count: 4,
          totalQty: 2500,
          totalSms: 100,
          totalLetters: 0,
        },
        {
          monthKey: '2026-12',
          count: 2,
          totalQty: 1200,
          totalSms: 50,
          totalLetters: 25,
        },
      ],
    ];
    const result = await loadCampaignsByMonth();
    expect(result).toEqual([
      {
        groupKey: '2026-01',
        groupLabel: 'January 2026',
        count: 4,
        totalQty: 2500,
        totalSms: 100,
        totalLetters: 0,
      },
      {
        groupKey: '2026-12',
        groupLabel: 'December 2026',
        count: 2,
        totalQty: 1200,
        totalSms: 50,
        totalLetters: 25,
      },
    ]);
  });

  it('falls through to the raw key when the value isn\'t a YYYY-MM string', async () => {
    mocks.selectResults = [
      [
        {
          monthKey: 'not-a-date',
          count: 1,
          totalQty: 0,
          totalSms: 0,
          totalLetters: 0,
        },
      ],
    ];
    const [row] = await loadCampaignsByMonth();
    expect(row.groupLabel).toBe('not-a-date');
  });
});
