import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createHmac } from 'node:crypto';

const mocks = vi.hoisted(() => ({
  markMsaSigned: vi.fn(),
  markMsaDeclined: vi.fn(),
  getSignedFileBytes: vi.fn(),
  putObject: vi.fn(),
  dbResults: [] as unknown[][],
}));

vi.mock('server-only', () => ({}));
vi.mock('@/features/msa/lifecycle', () => ({
  markMsaSigned: mocks.markMsaSigned,
  markMsaDeclined: mocks.markMsaDeclined,
}));
vi.mock('@/lib/boldsign/client', () => ({
  getSignedFileBytes: mocks.getSignedFileBytes,
}));
vi.mock('@/lib/storage/gcs', () => ({ putObject: mocks.putObject }));
vi.mock('@/lib/db', () => {
  const next = () => Promise.resolve(mocks.dbResults.shift() ?? []);
  return {
    db: {
      select: () => ({
        from: () => ({
          where: () => ({ limit: () => next() }),
        }),
      }),
    },
  };
});

import { POST } from './route';

const SECRET = 'test-webhook-secret';
const NOW_SECONDS = Math.floor(Date.now() / 1000);

function hmacOf(timestamp: string, body: string, secret = SECRET): string {
  return createHmac('sha256', secret)
    .update(`${timestamp}.${body}`)
    .digest('hex');
}

function payload(opts: {
  eventType: string;
  documentId?: string | null;
}): string {
  const body: Record<string, unknown> = {
    event: {
      id: 'evt-abc',
      eventType: opts.eventType,
      created: NOW_SECONDS,
      environment: 'Sandbox',
    },
  };
  if (opts.documentId !== null) {
    body.data = { documentId: opts.documentId ?? 'doc-abc' };
  }
  return JSON.stringify(body);
}

function makeRequest(
  jsonBody: string,
  opts: { signatureHeader?: string | null; timestampSeconds?: number } = {},
): NextRequest {
  const t = String(opts.timestampSeconds ?? NOW_SECONDS);
  const header =
    opts.signatureHeader !== undefined
      ? opts.signatureHeader
      : `t=${t}, s0=${hmacOf(t, jsonBody)}`;
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (header) headers['x-boldsign-signature'] = header;
  return new NextRequest('https://example.test/api/boldsign/webhook', {
    method: 'POST',
    headers,
    body: jsonBody,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.BOLDSIGN_WEBHOOK_SECRET = SECRET;
  process.env.GCS_BUCKET = 'test-bucket';
  mocks.dbResults = [];
  mocks.markMsaSigned.mockResolvedValue({
    ok: true,
    transitioned: true,
    msaId: 1,
    dealerId: 7,
  });
  mocks.markMsaDeclined.mockResolvedValue({
    ok: true,
    transitioned: true,
    msaId: 1,
    dealerId: 7,
  });
  mocks.getSignedFileBytes.mockResolvedValue({
    ok: true,
    body: Buffer.from('%PDF-signed-stub'),
  });
  mocks.putObject.mockResolvedValue({ ok: true, key: 'msa/1/signed.pdf' });
});

describe('POST /api/boldsign/webhook', () => {
  it('returns 401 when the HMAC signature does not match', async () => {
    const body = payload({ eventType: 'Signed' });
    const req = makeRequest(body, {
      signatureHeader: `t=${NOW_SECONDS}, s0=${'deadbeef'.repeat(8)}`,
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
    expect(mocks.markMsaSigned).not.toHaveBeenCalled();
    expect(mocks.markMsaDeclined).not.toHaveBeenCalled();
    expect(mocks.getSignedFileBytes).not.toHaveBeenCalled();
    expect(mocks.putObject).not.toHaveBeenCalled();
  });

  it('returns 500 when BOLDSIGN_WEBHOOK_SECRET is unset', async () => {
    delete process.env.BOLDSIGN_WEBHOOK_SECRET;
    const body = payload({ eventType: 'Signed' });
    const res = await POST(makeRequest(body));
    expect(res.status).toBe(500);
  });

  it('returns 401 when X-BoldSign-Signature header is missing', async () => {
    const body = payload({ eventType: 'Signed' });
    const res = await POST(makeRequest(body, { signatureHeader: null }));
    expect(res.status).toBe(401);
  });

  it('returns 400 on malformed JSON', async () => {
    const t = String(NOW_SECONDS);
    const raw = 'not json';
    const header = `t=${t}, s0=${hmacOf(t, raw)}`;
    const req = new NextRequest('https://example.test/api/boldsign/webhook', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-boldsign-signature': header,
      },
      body: raw,
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('Signed event: looks up MSA, downloads signed PDF, uploads to GCS, flips row, returns 200', async () => {
    mocks.dbResults.push([{ id: 1, status: 'pending' }]);
    const body = payload({ eventType: 'Signed' });
    const res = await POST(makeRequest(body));
    expect(res.status).toBe(200);

    expect(mocks.getSignedFileBytes).toHaveBeenCalledWith('doc-abc');
    expect(mocks.putObject).toHaveBeenCalledTimes(1);
    const uploadArg = mocks.putObject.mock.calls[0][0] as Record<string, unknown>;
    expect(uploadArg.bucket).toBe('test-bucket');
    expect(uploadArg.key).toBe('msa/1/signed.pdf');
    expect(uploadArg.contentType).toBe('application/pdf');
    expect(mocks.markMsaSigned).toHaveBeenCalledWith(
      'doc-abc',
      'msa/1/signed.pdf',
    );
  });

  it('Signed event for an unknown document id returns 404 without side effects', async () => {
    mocks.dbResults.push([]);
    const body = payload({ eventType: 'Signed' });
    const res = await POST(makeRequest(body));
    expect(res.status).toBe(404);
    expect(mocks.getSignedFileBytes).not.toHaveBeenCalled();
    expect(mocks.putObject).not.toHaveBeenCalled();
    expect(mocks.markMsaSigned).not.toHaveBeenCalled();
  });

  it('test envelope (metaData.test) acks 200 without an MSA lookup (0067)', async () => {
    // No dbResults pushed: if the guard failed and we reached handleSigned,
    // the lookup would return [] → 404. Asserting 200 + no side effects proves
    // the metaData.test short-circuit fired (a signed test envelope has no row).
    const body = JSON.stringify({
      event: { id: 'evt-test', eventType: 'Signed', created: NOW_SECONDS, environment: 'Sandbox' },
      data: { documentId: 'doc-test', metaData: { test: 'true' } },
    });
    const res = await POST(makeRequest(body));
    expect(res.status).toBe(200);
    expect(mocks.getSignedFileBytes).not.toHaveBeenCalled();
    expect(mocks.putObject).not.toHaveBeenCalled();
    expect(mocks.markMsaSigned).not.toHaveBeenCalled();
  });

  it('Signed event for an already-active MSA short-circuits to 200 (replay) without re-uploading', async () => {
    mocks.dbResults.push([{ id: 1, status: 'active' }]);
    const body = payload({ eventType: 'Signed' });
    const res = await POST(makeRequest(body));
    expect(res.status).toBe(200);
    expect(mocks.getSignedFileBytes).not.toHaveBeenCalled();
    expect(mocks.putObject).not.toHaveBeenCalled();
    expect(mocks.markMsaSigned).not.toHaveBeenCalled();
  });

  it('Declined event: calls markMsaDeclined and returns 200', async () => {
    const body = payload({ eventType: 'Declined' });
    const res = await POST(makeRequest(body));
    expect(res.status).toBe(200);
    expect(mocks.markMsaDeclined).toHaveBeenCalledWith('doc-abc');
    expect(mocks.markMsaSigned).not.toHaveBeenCalled();
  });

  it('Declined event for an unknown doc id returns 404', async () => {
    mocks.markMsaDeclined.mockResolvedValueOnce({
      error: 'MSA not found for the supplied document id.',
    });
    const body = payload({ eventType: 'Declined' });
    const res = await POST(makeRequest(body));
    expect(res.status).toBe(404);
  });

  it('Unrelated event types return 200 without dispatching', async () => {
    const body = payload({ eventType: 'SenderIdentityUpdated' });
    const res = await POST(makeRequest(body));
    expect(res.status).toBe(200);
    expect(mocks.markMsaSigned).not.toHaveBeenCalled();
    expect(mocks.markMsaDeclined).not.toHaveBeenCalled();
  });

  it('returns 400 when data.documentId is missing on a lifecycle event', async () => {
    const body = payload({ eventType: 'Signed', documentId: null });
    const res = await POST(makeRequest(body));
    expect(res.status).toBe(400);
  });

  it('returns 502 when BoldSign file fetch fails on the Signed path', async () => {
    mocks.dbResults.push([{ id: 1, status: 'pending' }]);
    mocks.getSignedFileBytes.mockResolvedValueOnce({ error: 'rate limit' });
    const body = payload({ eventType: 'Signed' });
    const res = await POST(makeRequest(body));
    expect(res.status).toBe(502);
    expect(mocks.putObject).not.toHaveBeenCalled();
    expect(mocks.markMsaSigned).not.toHaveBeenCalled();
  });
});
