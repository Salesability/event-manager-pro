import 'server-only';
import { type NextRequest } from 'next/server';
import { requireRole } from '@/lib/auth/require-role';
import { loadCampaigns, type Campaign } from '@/features/schedule/queries';
import { buildCsv, csvResponse } from '@/lib/csv';
import { filterCampaigns, todayIso } from '../filter';

const HEADERS = [
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
  // Route Handlers don't run through `(app)/layout.tsx`, so the page-level
  // gate has to be re-asserted explicitly here. The page itself is admin-only
  // (0028 Phase 1) — a coach who can't see Production has no business
  // exporting it, so the gate matches.
  await requireRole('admin');

  const sp = request.nextUrl.searchParams;
  const q = sp.get('q') ?? '';
  const status = sp.get('status') ?? '';
  const showCancelled = sp.get('cancelled') === '1';

  const today = todayIso();
  const rows = filterCampaigns(await loadCampaigns(), { q, status, showCancelled });

  const csv = buildCsv(
    HEADERS,
    rows.map((c) => [
      `${c.startDate} → ${c.endDate}`,
      c.dealerName,
      formatContact(c),
      c.styleLabel ?? '',
      c.salesLeadSourceLabel ?? '',
      c.qtyRecords != null ? String(c.qtyRecords) : '',
      c.smsEmail != null ? String(c.smsEmail) : '',
      c.letters != null ? String(c.letters) : '',
      c.bdc != null ? String(c.bdc) : '',
      c.coachName ?? '',
      c.notes ?? '',
      statusLabel(c, today),
    ]),
  );

  return csvResponse(`production-${today}.csv`, csv);
}

function formatContact(c: Campaign) {
  return [c.contact, c.phone, c.email].filter(Boolean).join(' / ');
}

function statusLabel(c: Campaign, today: string) {
  if (c.status === 'cancelled') return 'Cancelled';
  if (c.status === 'completed') return 'Completed';
  if (c.startDate <= today && c.endDate >= today) return 'Live';
  if (c.endDate < today) return 'Past';
  return 'Upcoming';
}
