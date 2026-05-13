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
vi.mock('@/lib/dropbox-sign/client', () => ({
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

function hmacOf(eventTime: string, eventType: string): string {
  return createHmac('sha256', SECRET)
    .update(eventTime + eventType)
    .digest('hex');
}

function payload(opts: {
  eventTime?: string;
  eventType: string;
  signatureRequestId?: string | null;
  badHash?: boolean;
}): string {
  const eventTime = opts.eventTime ?? '1779724800';
  const event_hash = opts.badHash
    ? 'deadbeef'.repeat(8)
    : hmacOf(eventTime, opts.eventType);
  const body: Record<string, unknown> = {
    event: {
      event_time: eventTime,
      event_type: opts.eventType,
      event_hash,
    },
  };
  if (opts.signatureRequestId !== null) {
    body.signature_request = {
      signature_request_id: opts.signatureRequestId ?? 'sig-req-abc',
    };
  }
  return JSON.stringify(body);
}

function makeRequest(jsonBody: string): NextRequest {
  return new NextRequest('https://example.test/api/dropbox-sign/webhook', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: jsonBody,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.DROPBOX_SIGN_WEBHOOK_SECRET = SECRET;
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

describe('POST /api/dropbox-sign/webhook', () => {
  it('returns 401 when the HMAC signature does not match', async () => {
    const body = payload({
      eventType: 'signature_request_all_signed',
      badHash: true,
    });
    const res = await POST(makeRequest(body));
    expect(res.status).toBe(401);
    expect(mocks.markMsaSigned).not.toHaveBeenCalled();
    expect(mocks.markMsaDeclined).not.toHaveBeenCalled();
    expect(mocks.getSignedFileBytes).not.toHaveBeenCalled();
    expect(mocks.putObject).not.toHaveBeenCalled();
  });

  it('returns 500 when DROPBOX_SIGN_WEBHOOK_SECRET is unset', async () => {
    delete process.env.DROPBOX_SIGN_WEBHOOK_SECRET;
    const body = payload({ eventType: 'signature_request_all_signed' });
    const res = await POST(makeRequest(body));
    expect(res.status).toBe(500);
  });

  it('returns 400 on malformed JSON', async () => {
    const res = await POST(makeRequest('not json'));
    expect(res.status).toBe(400);
  });

  it('signed event: looks up MSA, downloads signed PDF, uploads to GCS, flips row, returns 200 ack', async () => {
    mocks.dbResults.push([{ id: 1, status: 'pending' }]);
    const body = payload({ eventType: 'signature_request_all_signed' });
    const res = await POST(makeRequest(body));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('Hello API Event Received');

    expect(mocks.getSignedFileBytes).toHaveBeenCalledWith('sig-req-abc');
    expect(mocks.putObject).toHaveBeenCalledTimes(1);
    const uploadArg = mocks.putObject.mock.calls[0][0] as Record<string, unknown>;
    expect(uploadArg.bucket).toBe('test-bucket');
    expect(uploadArg.key).toBe('msa/1/signed.pdf');
    expect(uploadArg.contentType).toBe('application/pdf');
    expect(mocks.markMsaSigned).toHaveBeenCalledWith(
      'sig-req-abc',
      'msa/1/signed.pdf',
    );
  });

  it('signed event for an unknown document id returns 404 without side effects', async () => {
    mocks.dbResults.push([]); // MSA lookup empty
    const body = payload({ eventType: 'signature_request_all_signed' });
    const res = await POST(makeRequest(body));
    expect(res.status).toBe(404);
    expect(mocks.getSignedFileBytes).not.toHaveBeenCalled();
    expect(mocks.putObject).not.toHaveBeenCalled();
    expect(mocks.markMsaSigned).not.toHaveBeenCalled();
  });

  it('signed event for an already-active MSA short-circuits to 200 (replay) without re-uploading', async () => {
    mocks.dbResults.push([{ id: 1, status: 'active' }]);
    const body = payload({ eventType: 'signature_request_all_signed' });
    const res = await POST(makeRequest(body));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('Hello API Event Received');
    expect(mocks.getSignedFileBytes).not.toHaveBeenCalled();
    expect(mocks.putObject).not.toHaveBeenCalled();
    expect(mocks.markMsaSigned).not.toHaveBeenCalled();
  });

  it('declined event: calls markMsaDeclined and returns 200 ack', async () => {
    const body = payload({ eventType: 'signature_request_declined' });
    const res = await POST(makeRequest(body));
    expect(res.status).toBe(200);
    expect(mocks.markMsaDeclined).toHaveBeenCalledWith('sig-req-abc');
    expect(mocks.markMsaSigned).not.toHaveBeenCalled();
  });

  it('declined event for an unknown doc id returns 404', async () => {
    mocks.markMsaDeclined.mockResolvedValueOnce({
      error: 'MSA not found for the supplied document id.',
    });
    const body = payload({ eventType: 'signature_request_declined' });
    const res = await POST(makeRequest(body));
    expect(res.status).toBe(404);
  });

  it('unrelated event types return 200 ack without dispatching', async () => {
    const body = payload({ eventType: 'callback_test' });
    const res = await POST(makeRequest(body));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('Hello API Event Received');
    expect(mocks.markMsaSigned).not.toHaveBeenCalled();
    expect(mocks.markMsaDeclined).not.toHaveBeenCalled();
  });

  it('returns 400 when signature_request.signature_request_id is missing on a lifecycle event', async () => {
    const body = payload({
      eventType: 'signature_request_all_signed',
      signatureRequestId: null,
    });
    const res = await POST(makeRequest(body));
    expect(res.status).toBe(400);
  });

  it('returns 502 when Dropbox Sign file fetch fails on the signed path', async () => {
    mocks.dbResults.push([{ id: 1, status: 'pending' }]);
    mocks.getSignedFileBytes.mockResolvedValueOnce({ error: 'rate limit' });
    const body = payload({ eventType: 'signature_request_all_signed' });
    const res = await POST(makeRequest(body));
    expect(res.status).toBe(502);
    expect(mocks.putObject).not.toHaveBeenCalled();
    expect(mocks.markMsaSigned).not.toHaveBeenCalled();
  });
});
