import { type NextRequest } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { loadCampaigns, loadDealerPrimaryContacts } from '@/features/schedule/queries';
import {
  FEED_HEADERS,
  selectFeedCampaigns,
  mapCampaignToFeedRow,
} from '@/features/schedule/production-feed';
import { csvCell } from '@/lib/csv';

// authz: public — this feed is fetched by Google's `IMPORTDATA` server (no
// auth.users session), so the path is on `PUBLIC_PATHS` in
// `src/lib/supabase/middleware.ts` to bypass the session redirect. The gate is a
// bearer token (`?token=`) constant-time-compared against `PRODUCTION_FEED_TOKEN`,
// checked BEFORE any DB read — the rare external-caller case that warrants a route
// handler (CLAUDE.md → "Route handlers are for external callers only").
//
// The response is a delivery-focused CSV (see `production-feed.ts` for the
// redacted column/row model) that an owner-owned Google Sheet pulls via
// `=IMPORTDATA("…/api/production-feed?token=…")`. Read-only, one-way (0097).

export const dynamic = 'force-dynamic';

/** Local server-date as `YYYY-MM-DD` (mirrors `production/filter.ts` `todayIso`). */
function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Constant-time token compare (mirrors `boldsign/webhook-verify` — a plain `===`
 *  is a timing oracle). Length-guard first since `timingSafeEqual` throws on a
 *  length mismatch. */
function tokenMatches(provided: string, expected: string): boolean {
  if (provided.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(provided, 'utf8'), Buffer.from(expected, 'utf8'));
}

// authz: public — Google's IMPORTDATA fetch has no auth.users session; the gate
// is the bearer token constant-time-compared below, before any DB read.
export async function GET(request: NextRequest) {
  const expected = process.env.PRODUCTION_FEED_TOKEN;
  if (!expected) {
    // Fail-closed: an unset/empty token must never authorize an empty `?token=`.
    return new Response('Production feed is not configured.', { status: 500 });
  }

  const provided = request.nextUrl.searchParams.get('token') ?? '';
  if (!tokenMatches(provided, expected)) {
    return new Response('Unauthorized', { status: 401 });
  }

  const all = await loadCampaigns();
  const rows = selectFeedCampaigns(all, todayIso());
  // Dealer primary contact (0098) for just the surviving rows' dealers.
  const contacts = await loadDealerPrimaryContacts(rows.map((c) => c.dealerId));

  const lines = [FEED_HEADERS.map(csvCell).join(',')];
  for (const c of rows) {
    lines.push(mapCampaignToFeedRow(c, contacts.get(c.dealerId)).map(csvCell).join(','));
  }
  const body = lines.join('\r\n');

  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}
