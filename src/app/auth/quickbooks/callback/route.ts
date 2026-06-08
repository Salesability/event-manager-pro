import { NextResponse, type NextRequest } from 'next/server';
import { isAdmin } from '@/lib/auth/require-admin';
import {
  QBO_STATE_COOKIE,
  exchangeCodeForTokens,
  quickbooksRedirectUri,
  verifyState,
} from '@/lib/quickbooks/client';
import { saveConnection } from '@/lib/quickbooks/connection';
import { getUser } from '@/lib/supabase/session';

// Intuit OAuth 2.0 callback (chunk 0068). External caller → route handler, NOT a
// Server Action. Mirrors `src/app/auth/callback/route.ts` (origin resolution +
// code exchange + redirect). The `realmId` arrives ONLY as a query param here —
// it is not in the token — so it's captured and persisted to scope later API
// calls (research.md §realmId gotcha).

// Cloud Run forwards to the container on 0.0.0.0:3000, so request.nextUrl points
// at that internal address — resolve the real public origin from SITE_URL, then
// x-forwarded-* headers, then the request origin (local dev). Mirrors
// `resolveOrigin` in src/app/auth/callback/route.ts.
function resolveOrigin(request: NextRequest): string {
  const explicit = process.env.SITE_URL?.trim();
  if (explicit) return explicit.replace(/\/$/, '');
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host');
  if (host) {
    const proto =
      request.headers.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https');
    return `${proto}://${host}`;
  }
  return request.nextUrl.origin;
}

function landing(origin: string, params: Record<string, string>): NextResponse {
  const url = new URL('/admin/quickbooks', origin);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = NextResponse.redirect(url);
  // The state cookie is single-use — clear it on every outcome.
  res.cookies.delete(QBO_STATE_COOKIE);
  return res;
}

// authz: public — runs before any app gate. Guarded by (1) the httpOnly CSRF
// `state` cookie set by the admin-gated connect action, and (2) an isAdmin()
// re-check below (the callback lives under /auth, outside the /admin/* gate).
export async function GET(request: NextRequest) {
  const origin = resolveOrigin(request);
  const url = request.nextUrl;
  const code = url.searchParams.get('code');
  const realmId = url.searchParams.get('realmId');
  const state = url.searchParams.get('state');

  const cookieState = request.cookies.get(QBO_STATE_COOKIE)?.value;
  if (!verifyState(cookieState, state ?? undefined)) {
    return landing(origin, { error: 'Invalid or expired connection state — please try connecting again.' });
  }
  if (!code || !realmId) {
    return landing(origin, { error: 'QuickBooks did not return an authorization code.' });
  }

  // Defense-in-depth: only an admin may complete the connection.
  const user = await getUser();
  if (!isAdmin(user)) {
    return landing(origin, { error: 'Admin access is required to connect QuickBooks.' });
  }

  try {
    const tokens = await exchangeCodeForTokens(code, quickbooksRedirectUri(origin));
    await saveConnection({ realmId, tokens, connectedById: user?.id ?? null });
  } catch (err) {
    return landing(origin, {
      error: err instanceof Error ? err.message : 'QuickBooks token exchange failed.',
    });
  }

  return landing(origin, { connected: '1' });
}
