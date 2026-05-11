import 'server-only';
import { type NextRequest } from 'next/server';
import { assertCan } from '@/lib/auth/assert-can';
import {
  loadCampaignsByCoach,
  loadCampaignsByDealer,
  loadCampaignsByMonth,
  loadFullProductionReport,
  type Campaign,
} from '@/features/schedule/queries';
import { buildCsv, csvResponse } from '@/lib/csv';
import { formatYearMonth } from '@/lib/dates';

// Active-tab keys mirror `ReportsTabs.ReportTabKey`. Aggregate tabs share a
// 5-column shape (group label + count + 3 totals); the full tab matches the
// rich shape `/production/export` already emits, since the use case for the
// CSV (downstream BI / spreadsheet) wants more columns than the on-screen
// table shows.
const TAB_KEYS = ['dealer', 'coach', 'month', 'full'] as const;
type TabKey = (typeof TAB_KEYS)[number];

const AGGREGATE_HEADERS: Record<Exclude<TabKey, 'full'>, string[]> = {
  dealer: ['Dealer', 'Campaigns', 'Records', 'SMS/Email', 'Letters'],
  coach: ['Coach', 'Campaigns', 'Records', 'SMS/Email', 'Letters'],
  month: ['Month', 'Campaigns', 'Records', 'SMS/Email', 'Letters'],
};

const FULL_HEADERS = [
  'Date Range',
  'Dealership',
  'Contact',
  'Format',
  'Data Source',
  'Qty Records',
  'SMS/Email',
  'Letters',
  'BDC',
  'Coach',
  'Notes',
  'Status',
];

export async function GET(request: NextRequest) {
  // Route Handlers don't run through `(app)/layout.tsx`. Match the page's
  // gate (admin OR coach) so a contact-only auth user can't exfil the
  // aggregations bypassing the UI.
  await assertCan('reports:view'); // expected: server-only

  const tab = parseTab(request.nextUrl.searchParams.get('tab'));
  const today = new Date().toISOString().slice(0, 10);
  const filename = `reports-${tab}-${today}.csv`;

  const csv = await buildTabCsv(tab);
  return csvResponse(filename, csv);
}

function parseTab(raw: string | null): TabKey {
  if (raw && (TAB_KEYS as readonly string[]).includes(raw)) return raw as TabKey;
  return 'dealer';
}

async function buildTabCsv(tab: TabKey): Promise<string> {
  if (tab === 'full') {
    const rows = await loadFullProductionReport();
    return buildCsv(FULL_HEADERS, rows.map(toFullRow));
  }
  if (tab === 'dealer') {
    const rows = await loadCampaignsByDealer();
    return buildCsv(AGGREGATE_HEADERS.dealer, rows.map(toAggregateRow));
  }
  if (tab === 'coach') {
    const rows = await loadCampaignsByCoach();
    return buildCsv(AGGREGATE_HEADERS.coach, rows.map(toAggregateRow));
  }
  // tab === 'month' — relabel the YYYY-MM key to the long-form month name
  // for spreadsheet readability (matches the on-screen table).
  const rows = await loadCampaignsByMonth();
  return buildCsv(
    AGGREGATE_HEADERS.month,
    rows.map((r) => [
      formatYearMonth(r.groupKey),
      String(r.count),
      String(r.totalQty),
      String(r.totalSms),
      String(r.totalLetters),
    ]),
  );
}

function toAggregateRow(r: {
  groupLabel: string;
  count: number;
  totalQty: number;
  totalSms: number;
  totalLetters: number;
}): string[] {
  return [
    r.groupLabel,
    String(r.count),
    String(r.totalQty),
    String(r.totalSms),
    String(r.totalLetters),
  ];
}

function toFullRow(c: Campaign): string[] {
  return [
    `${c.startDate} → ${c.endDate}`,
    c.dealerName,
    [c.contact, c.phone, c.email].filter(Boolean).join(' / '),
    c.styleLabel ?? '',
    c.audienceSourceLabel ?? '',
    c.qtyRecords != null ? String(c.qtyRecords) : '',
    c.smsEmail != null ? String(c.smsEmail) : '',
    c.letters != null ? String(c.letters) : '',
    c.bdc != null ? String(c.bdc) : '',
    c.coachName ?? '',
    c.notes ?? '',
    statusLabel(c),
  ];
}

function statusLabel(c: Campaign): string {
  const today = new Date().toISOString().slice(0, 10);
  if (c.status === 'cancelled') return 'Cancelled';
  if (c.status === 'completed') return 'Completed';
  if (c.startDate <= today && c.endDate >= today) return 'Live';
  if (c.endDate < today) return 'Past';
  return 'Upcoming';
}
