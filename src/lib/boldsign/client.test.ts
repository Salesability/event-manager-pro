import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  ctorCalls: 0,
  ctorBasePath: null as string | null,
  setApiKeyCalls: [] as string[],
  sendDocumentCalls: [] as unknown[],
  downloadDocumentCalls: [] as string[],
  sendDocumentResponse: { documentId: 'doc-abc' } as { documentId?: string | null },
  sendDocumentError: null as Error | null,
  downloadDocumentResponse: Buffer.from('signed-pdf-bytes') as Buffer | unknown,
  downloadDocumentError: null as Error | null,
}));

vi.mock('server-only', () => ({}));
vi.mock('boldsign', () => ({
  DocumentApi: class MockDocumentApi {
    basePath = '';
    constructor(basePath?: string) {
      mocks.ctorCalls += 1;
      mocks.ctorBasePath = basePath ?? null;
      this.basePath = basePath ?? '';
    }
    setApiKey(apiKey: string) {
      mocks.setApiKeyCalls.push(apiKey);
    }
    setDefaultAuthentication() {}
    async sendDocument(sendForSign: unknown) {
      mocks.sendDocumentCalls.push(sendForSign);
      if (mocks.sendDocumentError) throw mocks.sendDocumentError;
      return mocks.sendDocumentResponse;
    }
    async downloadDocument(documentId: string) {
      mocks.downloadDocumentCalls.push(documentId);
      if (mocks.downloadDocumentError) throw mocks.downloadDocumentError;
      return mocks.downloadDocumentResponse;
    }
  },
  SendForSign: class MockSendForSign {},
  DocumentSigner: class MockDocumentSigner {},
}));

import {
  __resetForTests,
  client,
  getSignedFileBytes,
  sendSignatureRequest,
} from './client';

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  mocks.ctorCalls = 0;
  mocks.ctorBasePath = null;
  mocks.setApiKeyCalls = [];
  mocks.sendDocumentCalls = [];
  mocks.downloadDocumentCalls = [];
  mocks.sendDocumentResponse = { documentId: 'doc-abc' };
  mocks.sendDocumentError = null;
  mocks.downloadDocumentResponse = Buffer.from('signed-pdf-bytes');
  mocks.downloadDocumentError = null;
  __resetForTests();
  delete process.env.BOLDSIGN_API_KEY;
  delete process.env.APP_ENV;
});

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL_ENV)) delete process.env[key];
  }
  Object.assign(process.env, ORIGINAL_ENV);
});

describe('boldsign client', () => {
  it('returns {error} when BOLDSIGN_API_KEY is unset', () => {
    const result = client();
    expect(result).toEqual({ error: 'BOLDSIGN_API_KEY is not set.' });
    expect(mocks.ctorCalls).toBe(0);
  });

  it('configures DocumentApi with the env API key + sandbox URL when APP_ENV is not production', () => {
    process.env.BOLDSIGN_API_KEY = 'bs_test_abc';
    const result = client();
    expect('ok' in result && result.ok).toBe(true);
    expect(mocks.ctorBasePath).toBe('https://api-sandbox.boldsign.com');
    expect(mocks.setApiKeyCalls).toEqual(['bs_test_abc']);
  });

  it('points at production URL when APP_ENV=production', () => {
    process.env.BOLDSIGN_API_KEY = 'bs_live_abc';
    process.env.APP_ENV = 'production';
    client();
    expect(mocks.ctorBasePath).toBe('https://api.boldsign.com');
  });

  it('caches the configured client across calls (singleton)', () => {
    process.env.BOLDSIGN_API_KEY = 'bs_test_abc';
    const first = client();
    const second = client();
    expect(mocks.ctorCalls).toBe(1);
    if ('ok' in first && 'ok' in second) {
      expect(first.documentApi).toBe(second.documentApi);
    }
  });
});

describe('sendSignatureRequest', () => {
  const sample = {
    subject: 'MSA',
    message: 'Please sign',
    signer: { emailAddress: 'a@b.co', name: 'Alice' },
    files: [{ filename: 'msa.pdf', body: Buffer.from('pdf') }],
  };

  it('returns {error} when API key is unset', async () => {
    const result = await sendSignatureRequest(sample);
    expect(result).toEqual({ error: 'BOLDSIGN_API_KEY is not set.' });
  });

  it('returns ok with documentId on success', async () => {
    process.env.BOLDSIGN_API_KEY = 'bs_test_abc';
    const result = await sendSignatureRequest(sample);
    expect(result).toEqual({ ok: true, documentId: 'doc-abc' });
    expect(mocks.sendDocumentCalls).toHaveLength(1);
  });

  it('returns {error} when sendDocument throws', async () => {
    process.env.BOLDSIGN_API_KEY = 'bs_test_abc';
    mocks.sendDocumentError = new Error('Network down');
    const result = await sendSignatureRequest(sample);
    expect(result).toEqual({ error: 'Network down' });
  });

  it('returns {error} when sendDocument returns no documentId', async () => {
    process.env.BOLDSIGN_API_KEY = 'bs_test_abc';
    mocks.sendDocumentResponse = {};
    const result = await sendSignatureRequest(sample);
    expect(result).toEqual({ error: 'BoldSign returned no documentId.' });
  });

  it('marks isSandbox=true when APP_ENV is not production', async () => {
    process.env.BOLDSIGN_API_KEY = 'bs_test_abc';
    await sendSignatureRequest(sample);
    const sent = mocks.sendDocumentCalls[0] as { isSandbox?: boolean };
    expect(sent.isSandbox).toBe(true);
  });

  it('marks isSandbox=false when APP_ENV=production', async () => {
    process.env.BOLDSIGN_API_KEY = 'bs_live_abc';
    process.env.APP_ENV = 'production';
    await sendSignatureRequest(sample);
    const sent = mocks.sendDocumentCalls[0] as { isSandbox?: boolean };
    expect(sent.isSandbox).toBe(false);
  });

  it('forwards metadata when supplied', async () => {
    process.env.BOLDSIGN_API_KEY = 'bs_test_abc';
    await sendSignatureRequest({ ...sample, metadata: { msaId: '42' } });
    const sent = mocks.sendDocumentCalls[0] as {
      metaData?: Record<string, string>;
    };
    expect(sent.metaData).toEqual({ msaId: '42' });
  });
});

describe('getSignedFileBytes', () => {
  it('returns {error} when API key is unset', async () => {
    const result = await getSignedFileBytes('doc-abc');
    expect(result).toEqual({ error: 'BOLDSIGN_API_KEY is not set.' });
  });

  it('returns the signed PDF buffer', async () => {
    process.env.BOLDSIGN_API_KEY = 'bs_test_abc';
    const result = await getSignedFileBytes('doc-abc');
    expect('ok' in result && result.ok).toBe(true);
    if ('ok' in result) {
      expect(result.body.toString()).toBe('signed-pdf-bytes');
    }
    expect(mocks.downloadDocumentCalls).toEqual(['doc-abc']);
  });

  it('returns {error} on non-Buffer payload', async () => {
    process.env.BOLDSIGN_API_KEY = 'bs_test_abc';
    mocks.downloadDocumentResponse = { not: 'a buffer' };
    const result = await getSignedFileBytes('doc-abc');
    expect(result).toEqual({
      error: 'BoldSign returned unexpected file payload shape.',
    });
  });

  it('returns {error} when downloadDocument throws', async () => {
    process.env.BOLDSIGN_API_KEY = 'bs_test_abc';
    mocks.downloadDocumentError = new Error('Document not found');
    const result = await getSignedFileBytes('doc-abc');
    expect(result).toEqual({ error: 'Document not found' });
  });
});
