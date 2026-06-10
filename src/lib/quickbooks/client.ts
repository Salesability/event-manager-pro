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

// Non-throwing presence check — for UI that wants to hint "credentials not set"
// before the admin clicks Connect (which would otherwise throw in qboConfig).
export function qboConfigured(): boolean {
  return Boolean(process.env.QBO_CLIENT_ID?.trim() && process.env.QBO_CLIENT_SECRET?.trim());
}

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
  // Optimistic-lock version (chunk 0070). Present on every read; QBO rotates it
  // on every write, and an update MUST echo back the current value or it 400s.
  SyncToken?: string;
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

// Write payload for create/update (chunk 0070). Decoupled from `QboCustomer`
// (the read shape, where `Id` is always present): a create omits both `Id` and
// `SyncToken`; an update requires them. `sparse: true` tells QBO to merge the
// posted fields rather than blank out everything omitted.
export type QboCustomerInput = {
  DisplayName?: string;
  CompanyName?: string;
  BillAddr?: QboAddr;
  PrimaryEmailAddr?: { Address?: string };
  PrimaryPhone?: { FreeFormNumber?: string };
  Id?: string;
  SyncToken?: string;
  sparse?: boolean;
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

// ---------- Accounting API: read/write a single Customer (chunk 0070) ----------

// Thrown when a Customer create collides with an existing QBO `DisplayName`
// (Intuit error 6240) so callers can surface "already exists in QuickBooks —
// link instead" rather than a generic transport error.
export class QboDuplicateNameError extends Error {}

function customerUrl(cfg: QboConfig, realmId: string, suffix = ''): string {
  return `${cfg.apiBase}/v3/company/${realmId}/customer${suffix}?minorversion=${MINOR_VERSION}`;
}

// Shared response handling for the single-Customer read/write endpoints:
// 401 → QboAuthError (expired token), Intuit 6240 → QboDuplicateNameError
// (duplicate name), any other non-OK → throw with the body. The success body is
// `{ Customer: {...} }` (not the `QueryResponse` envelope the query API uses).
async function readCustomerResponse(res: Response): Promise<QboCustomer> {
  if (res.status === 401) {
    throw new QboAuthError('QBO returned 401 — the access token is expired or invalid.');
  }
  if (!res.ok) {
    const text = await res.text();
    let duplicate = false;
    try {
      const body = JSON.parse(text) as { Fault?: { Error?: { code?: string }[] } };
      duplicate = body.Fault?.Error?.some((e) => e.code === '6240') ?? false;
    } catch {
      duplicate = /\b6240\b/.test(text);
    }
    if (duplicate) {
      throw new QboDuplicateNameError(
        'QBO rejected the customer: a customer with this display name already exists (6240).',
      );
    }
    throw new Error(`QBO customer ${res.status}: ${text}`);
  }
  const json = (await res.json()) as { Customer?: QboCustomer };
  if (!json.Customer) {
    throw new Error('QBO customer response missing the Customer body.');
  }
  return json.Customer;
}

// Read one Customer by Id — used right before an update to grab the current
// `SyncToken` (read-before-write: QBO rotates it on every edit, including those
// made directly in the QBO UI, so a stored token would go stale).
export async function fetchCustomerById(
  realmId: string,
  accessToken: string,
  id: string,
): Promise<QboCustomer> {
  const cfg = qboConfig();
  const res = await fetch(customerUrl(cfg, realmId, `/${encodeURIComponent(id)}`), {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
  });
  return readCustomerResponse(res);
}

// Create a new Customer. Returns the created entity (carrying its new `Id`),
// which the caller backfills onto `dealers.quickbooks_id`.
export async function createCustomer(
  realmId: string,
  accessToken: string,
  payload: QboCustomerInput,
): Promise<QboCustomer> {
  const cfg = qboConfig();
  const res = await fetch(customerUrl(cfg, realmId), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(payload),
  });
  return readCustomerResponse(res);
}

// Sparse-update an existing Customer. Requires `Id` + a fresh `SyncToken`;
// `sparse: true` merges the posted fields instead of clearing omitted ones.
export async function updateCustomer(
  realmId: string,
  accessToken: string,
  payload: QboCustomerInput & { Id: string; SyncToken: string },
): Promise<QboCustomer> {
  const cfg = qboConfig();
  const res = await fetch(customerUrl(cfg, realmId), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ ...payload, sparse: true }),
  });
  return readCustomerResponse(res);
}

// ---------- Accounting API: read Items (chunk 0071) ----------

export type QboItem = {
  Id: string;
  SyncToken?: string;
  Name?: string;
  Sku?: string;
  Description?: string;
  /** Sales/Service unit price (numeric in the QBO JSON). */
  UnitPrice?: number;
  Active?: boolean;
  /** 'Service' | 'NonInventory' | 'Inventory' | 'Category' | … */
  Type?: string;
  SubItem?: boolean;
  ParentRef?: { value: string };
};

// Read-only fetch of the connected company's Items, paginated. Same shape as
// `fetchCustomers` — QBO is the item master (0071); the app mirrors this list
// into `service_items` via `item-sync.ts`. No DB writes here.
export async function fetchItems(
  realmId: string,
  accessToken: string,
  opts: { includeInactive?: boolean } = {},
): Promise<QboItem[]> {
  const cfg = qboConfig();
  const all: QboItem[] = [];
  const pageSize = 100;
  let start = 1;

  for (;;) {
    const where = opts.includeInactive ? '' : 'WHERE Active = true ';
    const query = `SELECT * FROM Item ${where}ORDER BY Id STARTPOSITION ${start} MAXRESULTS ${pageSize}`;
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

    const json = (await res.json()) as { QueryResponse?: { Item?: QboItem[] } };
    const batch = json.QueryResponse?.Item ?? [];
    all.push(...batch);
    if (batch.length < pageSize) break;
    start += pageSize;
  }

  return all;
}

// ---------- Accounting API: read/write a single Estimate (chunk 0073) ----------

export type QboEstimateLine = {
  Id?: string;
  DetailType: string; // 'SalesItemLineDetail'
  Amount: number;
  Description?: string;
  SalesItemLineDetail?: {
    ItemRef: { value: string; name?: string };
    Qty?: number;
    UnitPrice?: number;
  };
};

export type QboEstimate = {
  Id: string;
  SyncToken?: string;
  CustomerRef: { value: string; name?: string };
  Line: QboEstimateLine[];
  TxnTaxDetail?: { TotalTax?: number };
  GlobalTaxCalculation?: string;
  TotalAmt?: number;
};

// Write payload for create/update (chunk 0073). A create omits `Id`/`SyncToken`;
// an update requires them. `sparse: true` merges posted fields.
export type QboEstimateInput = {
  CustomerRef: { value: string };
  Line: QboEstimateLine[];
  TxnTaxDetail?: { TotalTax?: number };
  GlobalTaxCalculation?: string; // 'TaxExcluded' — we push our own computed tax
  Id?: string;
  SyncToken?: string;
  sparse?: boolean;
};

function estimateUrl(cfg: QboConfig, realmId: string, suffix = ''): string {
  return `${cfg.apiBase}/v3/company/${realmId}/estimate${suffix}?minorversion=${MINOR_VERSION}`;
}

// Same shape as `readCustomerResponse` minus the 6240 case (estimates have no
// DisplayName-uniqueness constraint): 401 → QboAuthError, other non-OK → throw,
// success body is `{ Estimate: {...} }`.
async function readEstimateResponse(res: Response): Promise<QboEstimate> {
  if (res.status === 401) {
    throw new QboAuthError('QBO returned 401 — the access token is expired or invalid.');
  }
  if (!res.ok) {
    throw new Error(`QBO estimate ${res.status}: ${await res.text()}`);
  }
  const json = (await res.json()) as { Estimate?: QboEstimate };
  if (!json.Estimate) {
    throw new Error('QBO estimate response missing the Estimate body.');
  }
  return json.Estimate;
}

// Read one Estimate by Id — used right before an update to grab the current
// `SyncToken` (read-before-write; QBO rotates it on every edit).
export async function fetchEstimateById(
  realmId: string,
  accessToken: string,
  id: string,
): Promise<QboEstimate> {
  const cfg = qboConfig();
  const res = await fetch(estimateUrl(cfg, realmId, `/${encodeURIComponent(id)}`), {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
  });
  return readEstimateResponse(res);
}

// Create a new Estimate. Returns the created entity (carrying its new `Id`),
// which the caller backfills onto `quotes.quickbooks_estimate_id`.
export async function createEstimate(
  realmId: string,
  accessToken: string,
  payload: QboEstimateInput,
): Promise<QboEstimate> {
  const cfg = qboConfig();
  const res = await fetch(estimateUrl(cfg, realmId), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(payload),
  });
  return readEstimateResponse(res);
}

// Sparse-update an existing Estimate. Requires `Id` + a fresh `SyncToken`.
export async function updateEstimate(
  realmId: string,
  accessToken: string,
  payload: QboEstimateInput & { Id: string; SyncToken: string },
): Promise<QboEstimate> {
  const cfg = qboConfig();
  const res = await fetch(estimateUrl(cfg, realmId), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ ...payload, sparse: true }),
  });
  return readEstimateResponse(res);
}

// ---------- Accounting API: read TaxCode / TaxRate (chunk 0074) ----------

export type QboTaxRateDetail = {
  TaxRateRef?: { value: string; name?: string };
  TaxTypeApplicable?: string;
  TaxOrder?: number;
};

export type QboTaxCode = {
  Id: string;
  Name?: string;
  Description?: string;
  Active?: boolean;
  Taxable?: boolean;
  TaxGroup?: boolean;
  /** Sales-side rate refs; the rate value comes from the referenced `TaxRate`. */
  SalesTaxRateList?: { TaxRateDetail?: QboTaxRateDetail[] };
};

export type QboTaxRate = {
  Id: string;
  Name?: string;
  Active?: boolean;
  /** Percent (e.g. 13 for HST ON); absent on adjustment rates. */
  RateValue?: number;
};

// Read-only paginated fetch of the connected company's TaxCodes — the unit the
// Estimate push references via `TxnTaxDetail.TxnTaxCodeRef` (0074). Same shape as
// `fetchItems`. The rate of a code comes from its `SalesTaxRateList` → the
// `TaxRate` it points at (see `fetchTaxRates`). No DB writes here.
export async function fetchTaxCodes(realmId: string, accessToken: string): Promise<QboTaxCode[]> {
  const cfg = qboConfig();
  const all: QboTaxCode[] = [];
  const pageSize = 100;
  let start = 1;

  for (;;) {
    const query = `SELECT * FROM TaxCode ORDER BY Id STARTPOSITION ${start} MAXRESULTS ${pageSize}`;
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

    const json = (await res.json()) as { QueryResponse?: { TaxCode?: QboTaxCode[] } };
    const batch = json.QueryResponse?.TaxCode ?? [];
    all.push(...batch);
    if (batch.length < pageSize) break;
    start += pageSize;
  }

  return all;
}

// Read-only paginated fetch of the connected company's TaxRates — the percent
// (`RateValue`) behind each TaxCode's `TaxRateRef` (0074). Same shape as
// `fetchTaxCodes`.
export async function fetchTaxRates(realmId: string, accessToken: string): Promise<QboTaxRate[]> {
  const cfg = qboConfig();
  const all: QboTaxRate[] = [];
  const pageSize = 100;
  let start = 1;

  for (;;) {
    const query = `SELECT * FROM TaxRate ORDER BY Id STARTPOSITION ${start} MAXRESULTS ${pageSize}`;
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

    const json = (await res.json()) as { QueryResponse?: { TaxRate?: QboTaxRate[] } };
    const batch = json.QueryResponse?.TaxRate ?? [];
    all.push(...batch);
    if (batch.length < pageSize) break;
    start += pageSize;
  }

  return all;
}
