import 'server-only';
import { timingSafeEqual } from 'node:crypto';

// QuickBooks Online (Intuit) OAuth 2.0 + Accounting-API HTTP client (chunk 0068).
// Pure HTTP — no DB. Token persistence + the refresh lifecycle live in
// `./connection.ts`. Endpoints/flow per
// docs/chunks/0060-quickbooks-integration/research.md; the customer-read query
// is lifted from `scripts/import-from-quickbooks.ts` (the one-time-seed script).

const SCOPE = 'com.intuit.quickbooks.accounting';
const AUTHORIZE_URL = 'https://appcenter.intuit.com/connect/oauth2';
const TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';
const REVOKE_URL = 'https://developer.api.intuit.com/v2/oauth2/tokens/revoke';
const MINOR_VERSION = '75'; // minor versions 1–74 retired 2025-08-01

// The httpOnly CSRF cookie name + callback path are shared by the connect
// action (sets cookie, builds authorize URL) and the callback route (reads
// cookie, exchanges code). Kept here so the `redirect_uri` is byte-identical on
// both legs — Intuit rejects the token exchange if it differs from authorize.
export const QBO_STATE_COOKIE = 'qbo_oauth_state';
export const QBO_CALLBACK_PATH = '/auth/quickbooks/callback';

export function quickbooksRedirectUri(origin: string): string {
  return `${origin.replace(/\/$/, '')}${QBO_CALLBACK_PATH}`;
}

export type QboEnv = 'sandbox' | 'production';

export type QboConfig = {
  clientId: string;
  clientSecret: string;
  env: QboEnv;
  apiBase: string;
};

// Thrown on a 401 from the Accounting API so callers can distinguish "token
// expired → refresh/reconnect" from a generic transport error.
export class QboAuthError extends Error {}

export function qboConfig(): QboConfig {
  const clientId = process.env.QBO_CLIENT_ID?.trim();
  const clientSecret = process.env.QBO_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    throw new Error('QBO_CLIENT_ID / QBO_CLIENT_SECRET are not set.');
  }
  // Default to sandbox — production is opt-in (matches the read-only-viewer
  // scope of 0068; prod keys/wiring are a later slice).
  const env: QboEnv =
    process.env.QBO_ENV?.trim().toLowerCase() === 'production' ? 'production' : 'sandbox';
  const apiBase =
    env === 'production'
      ? 'https://quickbooks.api.intuit.com'
      : 'https://sandbox-quickbooks.api.intuit.com';
  return { clientId, clientSecret, env, apiBase };
}

export type QboTokens = {
  accessToken: string;
  refreshToken: string;
  /** seconds until the access token expires (~3600) */
  expiresIn: number;
  /** seconds until the refresh token expires (~100 days); rotates on refresh */
  refreshTokenExpiresIn: number;
};

function basicAuth(cfg: QboConfig): string {
  return Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString('base64');
}

export function buildAuthorizeUrl(state: string, redirectUri: string): string {
  const cfg = qboConfig();
  const u = new URL(AUTHORIZE_URL);
  u.searchParams.set('client_id', cfg.clientId);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('scope', SCOPE);
  u.searchParams.set('redirect_uri', redirectUri);
  u.searchParams.set('state', state);
  return u.toString();
}

async function postToken(body: URLSearchParams): Promise<QboTokens> {
  const cfg = qboConfig();
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basicAuth(cfg)}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: body.toString(),
  });
  if (!res.ok) {
    throw new Error(`QBO token endpoint ${res.status}: ${await res.text()}`);
  }
  const json = (await res.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
    x_refresh_token_expires_in: number;
  };
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresIn: json.expires_in,
    refreshTokenExpiresIn: json.x_refresh_token_expires_in,
  };
}

export function exchangeCodeForTokens(code: string, redirectUri: string): Promise<QboTokens> {
  return postToken(
    new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
    }),
  );
}

// The returned refresh token is ROTATED — callers MUST persist whatever comes
// back, not the token they sent in.
export function refreshTokens(refreshToken: string): Promise<QboTokens> {
  return postToken(
    new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
  );
}

// Best-effort revoke — a failed revoke must not block a local disconnect.
export async function revokeToken(token: string): Promise<void> {
  const cfg = qboConfig();
  await fetch(REVOKE_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basicAuth(cfg)}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ token }),
  });
}

// Constant-time compare of the CSRF `state` query param against the httpOnly
// cookie value set at connect time.
export function verifyState(cookieValue: string | undefined, paramValue: string | undefined): boolean {
  if (!cookieValue || !paramValue) return false;
  const a = Buffer.from(cookieValue);
  const b = Buffer.from(paramValue);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

// ---------- Accounting API: read Customers ----------

export type QboAddr = {
  Line1?: string;
  Line2?: string;
  Line3?: string;
  City?: string;
  CountrySubDivisionCode?: string;
  PostalCode?: string;
  Country?: string;
};

export type QboCustomer = {
  Id: string;
  DisplayName?: string;
  CompanyName?: string;
  GivenName?: string;
  FamilyName?: string;
  Active?: boolean;
  Job?: boolean;
  ParentRef?: { value: string };
  BillAddr?: QboAddr;
  ShipAddr?: QboAddr;
  PrimaryEmailAddr?: { Address?: string };
  PrimaryPhone?: { FreeFormNumber?: string };
  Mobile?: { FreeFormNumber?: string };
};

// Read-only fetch of the connected company's Customers, paginated. Lifted from
// `scripts/import-from-quickbooks.ts:fetchAllCustomers`, parameterized on realm +
// access token (the script read them from env). No DB writes.
export async function fetchCustomers(
  realmId: string,
  accessToken: string,
  opts: { includeInactive?: boolean } = {},
): Promise<QboCustomer[]> {
  const cfg = qboConfig();
  const all: QboCustomer[] = [];
  const pageSize = 100; // QBO query API caps at 1000; 100 is the safe default
  let start = 1;

  for (;;) {
    const where = opts.includeInactive ? '' : 'WHERE Active = true ';
    const query = `SELECT * FROM Customer ${where}ORDER BY Id STARTPOSITION ${start} MAXRESULTS ${pageSize}`;
    const url = `${cfg.apiBase}/v3/company/${realmId}/query?query=${encodeURIComponent(
      query,
    )}&minorversion=${MINOR_VERSION}`;

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
    });

    if (res.status === 401) {
      throw new QboAuthError('QBO returned 401 — the access token is expired or invalid.');
    }
    if (!res.ok) {
      throw new Error(`QBO query ${res.status}: ${await res.text()}`);
    }

    const json = (await res.json()) as { QueryResponse?: { Customer?: QboCustomer[] } };
    const batch = json.QueryResponse?.Customer ?? [];
    all.push(...batch);
    if (batch.length < pageSize) break;
    start += pageSize;
  }

  return all;
}
