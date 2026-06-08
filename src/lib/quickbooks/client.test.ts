import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  QboAuthError,
  buildAuthorizeUrl,
  exchangeCodeForTokens,
  fetchCustomers,
  qboConfig,
  quickbooksRedirectUri,
  refreshTokens,
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

describe('verifyState', () => {
  it('matches equal values, rejects mismatches/empties', () => {
    expect(verifyState('abc', 'abc')).toBe(true);
    expect(verifyState('abc', 'abd')).toBe(false);
    expect(verifyState('abc', 'abcd')).toBe(false); // length differs
    expect(verifyState(undefined, 'abc')).toBe(false);
    expect(verifyState('abc', undefined)).toBe(false);
  });
});
