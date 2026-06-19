import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  QboAuthError,
  QboDuplicateNameError,
  buildAuthorizeUrl,
  createCustomer,
  createEstimate,
  exchangeCodeForTokens,
  fetchCustomerById,
  fetchCustomers,
  findCustomerByDisplayName,
  fetchEstimateById,
  fetchItems,
  fetchTaxCodes,
  fetchTaxRates,
  qboConfig,
  quickbooksRedirectUri,
  refreshTokens,
  updateCustomer,
  updateEstimate,
  verifyState,
} from './client';

vi.mock('server-only', () => ({}));

const CLIENT_ID = 'test-client-id';
const CLIENT_SECRET = 'test-client-secret';
const EXPECTED_BASIC = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');

type FakeResponse = {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
  text: () => Promise<string>;
};
function fakeJson(body: unknown, status = 200): FakeResponse {
  return { ok: status >= 200 && status < 300, status, json: async () => body, text: async () => '' };
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  process.env.QBO_CLIENT_ID = CLIENT_ID;
  process.env.QBO_CLIENT_SECRET = CLIENT_SECRET;
  process.env.QBO_ENV = 'sandbox';
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.QBO_CLIENT_ID;
  delete process.env.QBO_CLIENT_SECRET;
  delete process.env.QBO_ENV;
});

const TOKEN_BODY = {
  access_token: 'access-1',
  refresh_token: 'refresh-rotated',
  expires_in: 3600,
  x_refresh_token_expires_in: 8640000,
};

describe('qboConfig', () => {
  it('defaults to the sandbox host; production is opt-in', () => {
    expect(qboConfig().apiBase).toBe('https://sandbox-quickbooks.api.intuit.com');
    process.env.QBO_ENV = 'production';
    expect(qboConfig().apiBase).toBe('https://quickbooks.api.intuit.com');
  });
  it('throws a clear error when credentials are unset', () => {
    delete process.env.QBO_CLIENT_ID;
    expect(() => qboConfig()).toThrow(/QBO_CLIENT_ID/);
  });
});

describe('buildAuthorizeUrl', () => {
  it('encodes client_id, scope, redirect_uri, state, response_type=code', () => {
    const redirectUri = quickbooksRedirectUri('http://localhost:3000');
    const url = new URL(buildAuthorizeUrl('state-xyz', redirectUri));
    expect(url.origin + url.pathname).toBe('https://appcenter.intuit.com/connect/oauth2');
    expect(url.searchParams.get('client_id')).toBe(CLIENT_ID);
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('scope')).toBe('com.intuit.quickbooks.accounting');
    expect(url.searchParams.get('redirect_uri')).toBe('http://localhost:3000/auth/quickbooks/callback');
    expect(url.searchParams.get('state')).toBe('state-xyz');
  });
});

describe('token exchange + refresh', () => {
  it('exchangeCodeForTokens posts Basic-auth + authorization_code body', async () => {
    fetchMock.mockResolvedValueOnce(fakeJson(TOKEN_BODY));
    const tokens = await exchangeCodeForTokens('the-code', 'http://localhost:3000/auth/quickbooks/callback');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [calledUrl, init] = fetchMock.mock.calls[0];
    expect(calledUrl).toBe('https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe(`Basic ${EXPECTED_BASIC}`);
    expect(init.headers['Content-Type']).toBe('application/x-www-form-urlencoded');
    const body = new URLSearchParams(init.body as string);
    expect(body.get('grant_type')).toBe('authorization_code');
    expect(body.get('code')).toBe('the-code');
    expect(body.get('redirect_uri')).toBe('http://localhost:3000/auth/quickbooks/callback');

    expect(tokens).toEqual({
      accessToken: 'access-1',
      refreshToken: 'refresh-rotated',
      expiresIn: 3600,
      refreshTokenExpiresIn: 8640000,
    });
  });

  it('refreshTokens posts grant_type=refresh_token and returns the rotated token', async () => {
    fetchMock.mockResolvedValueOnce(fakeJson(TOKEN_BODY));
    const tokens = await refreshTokens('old-refresh');
    const body = new URLSearchParams(fetchMock.mock.calls[0][1].body as string);
    expect(body.get('grant_type')).toBe('refresh_token');
    expect(body.get('refresh_token')).toBe('old-refresh');
    expect(tokens.refreshToken).toBe('refresh-rotated'); // rotated, not the sent one
  });

  it('throws on a non-OK token response', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 400, json: async () => ({}), text: async () => 'bad_request' });
    await expect(refreshTokens('x')).rejects.toThrow(/QBO token endpoint 400/);
  });
});

describe('fetchCustomers', () => {
  const customer = (id: number) => ({ Id: String(id), DisplayName: `C${id}` });

  it('paginates against the sandbox host with a Bearer token until a short page', async () => {
    const page1 = Array.from({ length: 100 }, (_, i) => customer(i + 1));
    const page2 = [customer(101), customer(102)];
    fetchMock
      .mockResolvedValueOnce(fakeJson({ QueryResponse: { Customer: page1 } }))
      .mockResolvedValueOnce(fakeJson({ QueryResponse: { Customer: page2 } }));

    const customers = await fetchCustomers('realm-123', 'access-1');
    expect(customers).toHaveLength(102);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const [url1, init1] = fetchMock.mock.calls[0];
    expect(url1).toContain('https://sandbox-quickbooks.api.intuit.com/v3/company/realm-123/query');
    expect(url1).toContain('STARTPOSITION%201');
    expect(init1.headers.Authorization).toBe('Bearer access-1');
    expect(fetchMock.mock.calls[1][0]).toContain('STARTPOSITION%20101');
  });

  it('defaults to active-only and stops on a single short page', async () => {
    fetchMock.mockResolvedValueOnce(fakeJson({ QueryResponse: { Customer: [customer(1)] } }));
    const customers = await fetchCustomers('realm-123', 'access-1');
    expect(customers).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toContain('WHERE%20Active%20%3D%20true');
  });

  it('raises QboAuthError on a 401', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({}), text: async () => '' });
    await expect(fetchCustomers('realm-123', 'expired')).rejects.toBeInstanceOf(QboAuthError);
  });
});

describe('findCustomerByDisplayName (0085)', () => {
  it('queries active Customers filtered by exact DisplayName and returns the single match', async () => {
    fetchMock.mockResolvedValueOnce(
      fakeJson({ QueryResponse: { Customer: [{ Id: '42', DisplayName: 'Acme Motors' }] } }),
    );
    const match = await findCustomerByDisplayName('Acme Motors', 'realm-123', 'access-1');
    expect(match).toEqual({ Id: '42', DisplayName: 'Acme Motors' });
    const query = decodeURIComponent(fetchMock.mock.calls[0][0] as string);
    expect(query).toContain("WHERE Active = true AND DisplayName = 'Acme Motors'");
    expect(query).toContain('MAXRESULTS 1');
  });

  it("backslash-escapes an embedded single quote (O'Brien)", async () => {
    fetchMock.mockResolvedValueOnce(fakeJson({ QueryResponse: { Customer: [] } }));
    await findCustomerByDisplayName("O'Brien Auto", 'realm-123', 'access-1');
    const query = decodeURIComponent(fetchMock.mock.calls[0][0] as string);
    expect(query).toContain("DisplayName = 'O\\'Brien Auto'");
  });

  it('returns null when no Customer matches', async () => {
    fetchMock.mockResolvedValueOnce(fakeJson({ QueryResponse: {} }));
    expect(await findCustomerByDisplayName('Nobody', 'realm-123', 'access-1')).toBeNull();
  });

  it('raises QboAuthError on a 401', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({}), text: async () => '' });
    await expect(
      findCustomerByDisplayName('Acme', 'realm-123', 'expired'),
    ).rejects.toBeInstanceOf(QboAuthError);
  });
});

describe('single-Customer read/write (0070)', () => {
  it('fetchCustomerById GETs /customer/{id} with a Bearer token and returns the SyncToken', async () => {
    fetchMock.mockResolvedValueOnce(
      fakeJson({ Customer: { Id: '42', SyncToken: '7', DisplayName: 'Acme' } }),
    );
    const customer = await fetchCustomerById('realm-123', 'access-1', '42');

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain('https://sandbox-quickbooks.api.intuit.com/v3/company/realm-123/customer/42');
    expect(url).toContain('minorversion=');
    expect(init.headers.Authorization).toBe('Bearer access-1');
    expect(init.method ?? 'GET').toBe('GET');
    expect(customer.SyncToken).toBe('7');
  });

  it('createCustomer POSTs JSON (no Id) and returns the created Customer', async () => {
    fetchMock.mockResolvedValueOnce(
      fakeJson({ Customer: { Id: '999', SyncToken: '0', DisplayName: 'New Co' } }),
    );
    const created = await createCustomer('realm-123', 'access-1', { DisplayName: 'New Co' });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain('/v3/company/realm-123/customer');
    expect(init.method).toBe('POST');
    expect(init.headers['Content-Type']).toBe('application/json');
    const body = JSON.parse(init.body as string);
    expect(body.DisplayName).toBe('New Co');
    expect(body.Id).toBeUndefined();
    expect(created.Id).toBe('999');
  });

  it('updateCustomer POSTs a sparse update carrying Id + SyncToken', async () => {
    fetchMock.mockResolvedValueOnce(
      fakeJson({ Customer: { Id: '42', SyncToken: '8', DisplayName: 'Acme Renamed' } }),
    );
    const updated = await updateCustomer('realm-123', 'access-1', {
      Id: '42',
      SyncToken: '7',
      DisplayName: 'Acme Renamed',
    });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.sparse).toBe(true);
    expect(body.Id).toBe('42');
    expect(body.SyncToken).toBe('7');
    expect(updated.SyncToken).toBe('8'); // rotated by QBO on write
  });

  it('createCustomer raises QboDuplicateNameError on Intuit error 6240', async () => {
    const fault = JSON.stringify({ Fault: { Error: [{ code: '6240', Message: 'Duplicate Name' }] } });
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => JSON.parse(fault),
      text: async () => fault,
    });
    await expect(
      createCustomer('realm-123', 'access-1', { DisplayName: 'Dup Co' }),
    ).rejects.toBeInstanceOf(QboDuplicateNameError);
  });

  it('raises QboAuthError on a 401 from the customer endpoint', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({}), text: async () => '' });
    await expect(fetchCustomerById('realm-123', 'expired', '42')).rejects.toBeInstanceOf(QboAuthError);
  });
});

describe('fetchItems (0071)', () => {
  const item = (id: number) => ({ Id: String(id), Name: `Item ${id}`, Type: 'Service' });

  it('paginates against FROM Item with a Bearer token until a short page', async () => {
    const page1 = Array.from({ length: 100 }, (_, i) => item(i + 1));
    const page2 = [item(101)];
    fetchMock
      .mockResolvedValueOnce(fakeJson({ QueryResponse: { Item: page1 } }))
      .mockResolvedValueOnce(fakeJson({ QueryResponse: { Item: page2 } }));

    const items = await fetchItems('realm-123', 'access-1');
    expect(items).toHaveLength(101);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [url1, init1] = fetchMock.mock.calls[0];
    expect(url1).toContain('https://sandbox-quickbooks.api.intuit.com/v3/company/realm-123/query');
    expect(decodeURIComponent(url1)).toContain('FROM Item');
    expect(init1.headers.Authorization).toBe('Bearer access-1');
  });

  it('defaults to active-only', async () => {
    fetchMock.mockResolvedValueOnce(fakeJson({ QueryResponse: { Item: [item(1)] } }));
    await fetchItems('realm-123', 'access-1');
    expect(decodeURIComponent(fetchMock.mock.calls[0][0])).toContain('WHERE Active = true');
  });

  it('raises QboAuthError on a 401', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({}), text: async () => '' });
    await expect(fetchItems('realm-123', 'expired')).rejects.toBeInstanceOf(QboAuthError);
  });
});

describe('single-Estimate read/write (0073)', () => {
  const line = {
    DetailType: 'SalesItemLineDetail',
    Amount: 100,
    SalesItemLineDetail: { ItemRef: { value: '5' }, Qty: 1, UnitPrice: 100 },
  };

  it('fetchEstimateById GETs /estimate/{id} and returns the SyncToken', async () => {
    fetchMock.mockResolvedValueOnce(
      fakeJson({ Estimate: { Id: '7', SyncToken: '3', CustomerRef: { value: '42' }, Line: [line] } }),
    );
    const est = await fetchEstimateById('realm-123', 'access-1', '7');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain('https://sandbox-quickbooks.api.intuit.com/v3/company/realm-123/estimate/7');
    expect(init.headers.Authorization).toBe('Bearer access-1');
    expect(est.SyncToken).toBe('3');
  });

  it('createEstimate POSTs JSON (no Id) and returns the created Estimate', async () => {
    fetchMock.mockResolvedValueOnce(
      fakeJson({ Estimate: { Id: '999', SyncToken: '0', CustomerRef: { value: '42' }, Line: [line] } }),
    );
    const created = await createEstimate('realm-123', 'access-1', {
      CustomerRef: { value: '42' },
      Line: [line],
      GlobalTaxCalculation: 'TaxExcluded',
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain('/v3/company/realm-123/estimate');
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body as string);
    expect(body.CustomerRef.value).toBe('42');
    expect(body.Id).toBeUndefined();
    expect(created.Id).toBe('999');
  });

  it('updateEstimate POSTs a sparse update carrying Id + SyncToken', async () => {
    fetchMock.mockResolvedValueOnce(
      fakeJson({ Estimate: { Id: '7', SyncToken: '4', CustomerRef: { value: '42' }, Line: [line] } }),
    );
    const updated = await updateEstimate('realm-123', 'access-1', {
      Id: '7',
      SyncToken: '3',
      CustomerRef: { value: '42' },
      Line: [line],
    });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.sparse).toBe(true);
    expect(body.Id).toBe('7');
    expect(body.SyncToken).toBe('3');
    expect(updated.SyncToken).toBe('4');
  });

  it('raises QboAuthError on a 401 from the estimate endpoint', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({}), text: async () => '' });
    await expect(fetchEstimateById('realm-123', 'expired', '7')).rejects.toBeInstanceOf(QboAuthError);
  });
});

describe('tax-entity reads (0074)', () => {
  it('fetchTaxCodes queries TaxCode and returns the list', async () => {
    fetchMock.mockResolvedValueOnce(
      fakeJson({ QueryResponse: { TaxCode: [{ Id: '5', Name: 'HST ON', Taxable: true }] } }),
    );
    const codes = await fetchTaxCodes('realm-123', 'access-1');
    const [url, init] = fetchMock.mock.calls[0];
    expect(decodeURIComponent(url)).toContain('SELECT * FROM TaxCode');
    expect(url).toContain('/v3/company/realm-123/query');
    expect(init.headers.Authorization).toBe('Bearer access-1');
    expect(codes).toHaveLength(1);
    expect(codes[0]).toMatchObject({ Id: '5', Name: 'HST ON' });
  });

  it('fetchTaxRates queries TaxRate and returns the list', async () => {
    fetchMock.mockResolvedValueOnce(
      fakeJson({ QueryResponse: { TaxRate: [{ Id: '12', Name: 'HST ON', RateValue: 13 }] } }),
    );
    const rates = await fetchTaxRates('realm-123', 'access-1');
    const [url] = fetchMock.mock.calls[0];
    expect(decodeURIComponent(url)).toContain('SELECT * FROM TaxRate');
    expect(rates[0]).toMatchObject({ Id: '12', RateValue: 13 });
  });

  it('raises QboAuthError on a 401 from the tax-code query', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({}), text: async () => '' });
    await expect(fetchTaxCodes('realm-123', 'expired')).rejects.toBeInstanceOf(QboAuthError);
  });
});

describe('verifyState', () => {
  it('matches equal values, rejects mismatches/empties', () => {
    expect(verifyState('abc', 'abc')).toBe(true);
    expect(verifyState('abc', 'abd')).toBe(false);
    expect(verifyState('abc', 'abcd')).toBe(false); // length differs
    expect(verifyState(undefined, 'abc')).toBe(false);
    expect(verifyState('abc', undefined)).toBe(false);
  });
});
