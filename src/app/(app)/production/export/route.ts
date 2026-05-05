import 'server-only';
import { type NextRequest } from 'next/server';
import { requireStaffAccess } from '@/lib/auth/require-staff-access';
import { loadCampaigns, type Campaign } from '@/features/schedule/queries';
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
  // Route Handlers don't run through `(app)/layout.tsx`, so the staff-app
  // gate has to be re-asserted explicitly here. Without this, a contact-only
  // auth user blocked from `/production` could still GET `/production/export`
  // and exfil the campaign CSV.
  await requireStaffAccess();

  const sp = request.nextUrl.searchParams;
  const q = sp.get('q') ?? '';
  const status = sp.get('status') ?? '';
  const showCancelled = sp.get('cancelled') === '1';

  const today = todayIso();
  const rows = filterCampaigns(await loadCampaigns(), { q, status, showCancelled });

  const lines = [
    HEADERS.map(csvCell).join(','),
    ...rows.map((c) =>
      [
        `${c.startDate} → ${c.endDate}`,
        c.dealerName,
        formatContact(c),
        c.styleLabel ?? '',
        c.salesLeadSourceLabel ?? '',
        c.qtyRecords ?? '',
        c.smsEmail ?? '',
        c.letters ?? '',
        c.bdc ?? '',
        c.coachName ?? '',
        c.notes ?? '',
        statusLabel(c, today),
      ]
        .map((v) => csvCell(String(v)))
        .join(','),
    ),
  ];

  // Prepend a UTF-8 BOM so Excel auto-detects the encoding when the file
  // is opened directly (without it, accented characters render as mojibake).
  const csv = '\uFEFF' + lines.join('\r\n');

  return new Response(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="production-${today}.csv"`,
      'Cache-Control': 'no-store',
    },
  });
}

function csvCell(v: string) {
  return `"${v.replace(/"/g, '""')}"`;
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
