import 'server-only';
import { type NextRequest } from 'next/server';
import { assertCan } from '@/lib/auth/assert-can';
import { loadCampaigns, type Campaign } from '@/features/schedule/queries';
import { buildCsv, csvResponse } from '@/lib/csv';
import { todayIso, isProductionRange, rangeWindowEndIso } from '../filter';

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
  // gate has to be re-asserted explicitly here. Capability-keyed (0029 Phase
  // 2) so the matrix lives in capabilities.ts — admin is the only role with
  // `production:export`.
  await assertCan('production:export'); // expected: server-only

  const sp = request.nextUrl.searchParams;
  const q = sp.get('q') ?? '';
  const status = sp.get('status') ?? '';
  const showCancelled = sp.get('cancelled') === '1';

  const today = todayIso();
  const all = await loadCampaigns();
  // Inline the same predicate the client-side `<ProductionAdmin>`
  // applies (search needle across dealer/coach/style/notes/contact +
  // upcoming/past/range time-window + show-cancelled toggle). Server-side
  // copy is intentional — the previous shared helper crossed the
  // client/server boundary, and the new TanStack pipeline doesn't
  // export a server-runnable function. Only the date-window math is
  // shared (`rangeWindowEndIso`), so the range can't drift from the table.
  const needle = q.trim().toLowerCase();
  const rangeWindowEnd = isProductionRange(status) ? rangeWindowEndIso(today, status) : null;
  const rows = all.filter((c) => {
    if (!showCancelled && c.status === 'cancelled') return false;
    if (status === 'upcoming' && !(c.endDate >= today)) return false;
    if (status === 'past' && !(c.endDate < today)) return false;
    if (rangeWindowEnd !== null && !(c.endDate >= today && c.startDate <= rangeWindowEnd)) {
      return false;
    }
    if (needle) {
      const hit =
        c.dealerName.toLowerCase().includes(needle) ||
        (c.coachName?.toLowerCase().includes(needle) ?? false) ||
        (c.styleLabel?.toLowerCase().includes(needle) ?? false) ||
        (c.notes?.toLowerCase().includes(needle) ?? false) ||
        (c.contact?.toLowerCase().includes(needle) ?? false);
      if (!hit) return false;
    }
    return true;
  });

  const csv = buildCsv(
    HEADERS,
    rows.map((c) => [
      `${c.startDate} → ${c.endDate}`,
      c.dealerName,
      formatContact(c),
      c.styleLabel ?? '',
      c.audienceSourceLabel ?? '',
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
