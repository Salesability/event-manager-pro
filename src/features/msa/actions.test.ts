import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  assertCan: vi.fn(),
  getUser: vi.fn(),
  loadCurrentMembership: vi.fn(),
  recordAudit: vi.fn(),
  renderMsaPdf: vi.fn(),
  renderQuotePdf: vi.fn(),
  putObject: vi.fn(),
  resolveQuoteRecipient: vi.fn(),
  sendSignatureRequest: vi.fn(),
  currentMsaTemplateVersion: vi.fn(),
  // Queue consumed by both `.returning()` calls and `.then()` / `.limit()`
  // terminals on the predicate-blind db mock. Mirrors the quotes actions
  // test wiring (see quotes/actions.test.ts).
  dbResults: [] as unknown[][],
  inserts: [] as Array<{ table: string; values: unknown }>,
  updates: [] as Array<{ table: string; patch: unknown }>,
}));

vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({
  redirect: (path: string) => {
    const err = new Error(`NEXT_REDIRECT;replace;${path};307;`);
    (err as Error & { digest: string }).digest = `NEXT_REDIRECT;replace;${path};307;`;
    throw err;
  },
}));
vi.mock('@/lib/auth/assert-can', () => ({ assertCan: mocks.assertCan }));
vi.mock('@/lib/supabase/session', () => ({ getUser: mocks.getUser }));
vi.mock('@/lib/auth/load-team-membership', async (importOriginal) => {
  const real =
    await importOriginal<typeof import('@/lib/auth/load-team-membership')>();
  return {
    ...real,
    loadCurrentMembership: mocks.loadCurrentMembership,
  };
});
vi.mock('@/features/audit/actions', () => ({ recordAudit: mocks.recordAudit }));
vi.mock('@/lib/pdf/render-msa', () => ({ renderMsaPdf: mocks.renderMsaPdf }));
vi.mock('@/lib/pdf/render-quote', () => ({ renderQuotePdf: mocks.renderQuotePdf }));
vi.mock('@/lib/storage/gcs', () => ({ putObject: mocks.putObject }));
vi.mock('@/features/quotes/recipient', () => ({
  resolveQuoteRecipient: mocks.resolveQuoteRecipient,
}));
vi.mock('@/lib/dropbox-sign/client', () => ({
  sendSignatureRequest: mocks.sendSignatureRequest,
}));
vi.mock('@/lib/dropbox-sign/templates', () => ({
  currentMsaTemplateVersion: mocks.currentMsaTemplateVersion,
}));

vi.mock('@/lib/db', () => {
  function tableName(t: unknown): string {
    if (typeof t === 'object' && t != null) {
      const sym = Object.getOwnPropertySymbols(t).find(
        (s) => s.description === 'drizzle:Name',
      );
      if (sym) return String((t as Record<symbol, unknown>)[sym]);
    }
    return 'unknown';
  }
  const txStub = {
    insert: (table: unknown) => ({
      values: (values: unknown) => {
        mocks.inserts.push({ table: tableName(table), values });
        return {
          returning: async () => mocks.dbResults.shift() ?? [{ id: 999 }],
        };
      },
    }),
    update: (table: unknown) => ({
      set: (patch: unknown) => {
        mocks.updates.push({ table: tableName(table), patch });
        return {
          where: () => {
            const next = () => Promise.resolve(mocks.dbResults.shift() ?? []);
            return {
              returning: () => next(),
              then: (onFulfilled: (v: unknown[]) => unknown) =>
                next().then(onFulfilled),
            };
          },
        };
      },
    }),
    select: () => ({
      from: () => {
        const next = () => Promise.resolve(mocks.dbResults.shift() ?? []);
        const terminal: {
          limit: () => Promise<unknown[]>;
          orderBy: () => Promise<unknown[]>;
          for: () => typeof terminal;
          then: (onFulfilled: (v: unknown[]) => unknown) => Promise<unknown>;
        } = {
          limit: () => next(),
          orderBy: () => next(),
          for: () => terminal,
          then: (onFulfilled: (v: unknown[]) => unknown) =>
            next().then(onFulfilled),
        };
        return { where: () => terminal };
      },
    }),
  };
  return {
    db: {
      ...txStub,
      transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(txStub),
    },
  };
});

import { createMsaDraft, sendMsaEnvelope } from './actions';

async function call<T>(
  p: Promise<{ data?: T; serverError?: string; validationErrors?: unknown } | undefined | null>,
): Promise<T> {
  const r = await p;
  if (!r) throw new Error('action returned null/undefined');
  if (r.serverError) throw new Error(`unexpected serverError: ${r.serverError}`);
  if (r.validationErrors) {
    throw new Error(`unexpected validationErrors: ${JSON.stringify(r.validationErrors)}`);
  }
  if (r.data === undefined) throw new Error('action returned undefined data');
  return r.data;
}

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.append(k, v);
  return f;
}

const MSA_PENDING = {
  id: 1,
  dealerId: 7,
  status: 'pending' as const,
  templateVersion: '2026-05-12',
  dropboxSignDocumentId: null as string | null,
};

const DEALER_ROW = {
  id: 7,
  name: 'Acme Auto Group',
  address: '456 Dealership Boulevard\nMississauga, ON  L5B 3C2',
};

const DRAFT_QUOTE_ROW = {
  id: 42,
  dealerId: 7,
  status: 'draft' as const,
  quoteValidDays: 30,
  lineItems: [
    {
      code: 'base-event',
      label: 'Base Event (includes 500 records)',
      unit: 'flat',
      unitPrice: 6900,
      qty: 1,
      lineTotal: 6900,
    },
  ],
  subtotal: '6900.00',
  tax: '0.00',
  total: '6900.00',
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.assertCan.mockResolvedValue({
    id: 'coach-uuid',
    app_metadata: { role: 'admin' },
  });
  mocks.getUser.mockResolvedValue({
    id: 'coach-uuid',
    email: 'coach@test.local',
    app_metadata: { role: 'admin' },
  });
  mocks.loadCurrentMembership.mockResolvedValue(null);
  mocks.currentMsaTemplateVersion.mockReturnValue('2026-05-12');
  mocks.renderMsaPdf.mockResolvedValue({
    ok: true,
    body: Buffer.from('%PDF-msa-stub'),
  });
  mocks.renderQuotePdf.mockResolvedValue({
    ok: true,
    body: Buffer.from('%PDF-quote-stub'),
  });
  mocks.putObject.mockResolvedValue({ ok: true, key: 'msa/1/draft.pdf' });
  mocks.resolveQuoteRecipient.mockResolvedValue({
    ok: true,
    recipient: { email: 'buyer@dealer.test', firstName: 'Pat' },
  });
  mocks.sendSignatureRequest.mockResolvedValue({
    ok: true,
    signatureRequestId: 'sig-req-abc',
  });
  mocks.dbResults = [];
  mocks.inserts = [];
  mocks.updates = [];
  process.env.GCS_BUCKET = 'test-bucket';
});

describe('createMsaDraft', () => {
  it('inserts a pending MSA row for an active dealer with no existing MSA', async () => {
    // dealer FOR UPDATE → ok; existing-MSA lookup → empty; insert → id 1.
    mocks.dbResults.push([{ id: 7 }], [], [{ id: 1 }]);

    const result = await call(createMsaDraft(fd({ dealerId: '7' })));

    expect(result).toEqual({ ok: true, msaId: 1 });
    expect(mocks.inserts).toHaveLength(1);
    expect(mocks.inserts[0].table).toBe('master_service_agreements');
    const values = mocks.inserts[0].values as Record<string, unknown>;
    expect(values.dealerId).toBe(7);
    expect(values.templateVersion).toBe('2026-05-12');
    expect(values.createdById).toBe('coach-uuid');
    expect(mocks.recordAudit).toHaveBeenCalledWith({
      action: 'msa.created',
      targetTable: 'master_service_agreements',
      targetId: 1,
      payload: { dealerId: 7, templateVersion: '2026-05-12' },
    });
  });

  it('rejects when MSA_TEMPLATE_VERSION env is unset', async () => {
    mocks.currentMsaTemplateVersion.mockReturnValue({
      error: 'MSA_TEMPLATE_VERSION is not set.',
    });
    const result = await call(createMsaDraft(fd({ dealerId: '7' })));
    expect(result).toEqual({ error: 'MSA_TEMPLATE_VERSION is not set.' });
    expect(mocks.inserts).toHaveLength(0);
  });

  it('rejects when dealer is missing or archived', async () => {
    mocks.dbResults.push([]); // dealer lookup empty
    const result = await call(createMsaDraft(fd({ dealerId: '99' })));
    expect(result).toEqual({ error: 'Dealer not found or archived.' });
    expect(mocks.inserts).toHaveLength(0);
    expect(mocks.recordAudit).not.toHaveBeenCalled();
  });

  it('refuses when dealer already has a pending or active MSA', async () => {
    mocks.dbResults.push([{ id: 7 }], [{ id: 1 }]); // dealer + existing MSA
    const result = await call(createMsaDraft(fd({ dealerId: '7' })));
    expect(result).toEqual({
      error: 'Dealer already has a pending or active MSA.',
    });
    expect(mocks.inserts).toHaveLength(0);
    expect(mocks.recordAudit).not.toHaveBeenCalled();
  });

  it('rejects when dealerId is missing', async () => {
    const result = await call(createMsaDraft(fd({})));
    expect(result).toEqual({ error: 'Dealer is required.' });
    expect(mocks.inserts).toHaveLength(0);
  });
});

describe('sendMsaEnvelope', () => {
  it('happy path: renders MSA + Quote PDFs, uploads draft, posts envelope, persists doc id, emits audit', async () => {
    // MSA pre-load → dealer → quote → guarded UPDATE returns 1 row.
    mocks.dbResults.push(
      [MSA_PENDING],
      [DEALER_ROW],
      [DRAFT_QUOTE_ROW],
      [{ id: 1 }],
    );

    const result = await call(
      sendMsaEnvelope(fd({ msaId: '1', firstQuoteId: '42' })),
    );

    expect(result).toEqual({ ok: true });
    expect(mocks.renderMsaPdf).toHaveBeenCalledTimes(1);
    const msaData = mocks.renderMsaPdf.mock.calls[0][0] as Record<string, unknown>;
    expect(msaData.msaNumber).toBe('1');
    expect(msaData.clientName).toBe('Acme Auto Group');
    expect(msaData.signerEmail).toBe('buyer@dealer.test');
    expect(msaData.terminationNoticeDays).toBe(30);
    expect(msaData.templateVersion).toBe('2026-05-12');

    expect(mocks.renderQuotePdf).toHaveBeenCalledTimes(1);
    expect(mocks.putObject).toHaveBeenCalledTimes(1);
    const uploadArg = mocks.putObject.mock.calls[0][0] as Record<string, unknown>;
    expect(uploadArg.bucket).toBe('test-bucket');
    expect(uploadArg.key).toBe('msa/1/draft.pdf');

    expect(mocks.sendSignatureRequest).toHaveBeenCalledTimes(1);
    const envelopeArg = mocks.sendSignatureRequest.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    const files = envelopeArg.files as Array<{ filename: string }>;
    expect(files).toHaveLength(2);
    expect(files[0].filename).toBe('msa-1.pdf');
    expect(files[1].filename).toBe('quote-42.pdf');
    expect((envelopeArg.signer as { emailAddress: string }).emailAddress).toBe(
      'buyer@dealer.test',
    );

    expect(mocks.updates).toHaveLength(1);
    const patch = mocks.updates[0].patch as Record<string, unknown>;
    expect(patch.dropboxSignDocumentId).toBe('sig-req-abc');

    expect(mocks.recordAudit).toHaveBeenCalledWith({
      action: 'msa.sent',
      targetTable: 'master_service_agreements',
      targetId: 1,
      payload: {
        dealerId: 7,
        quoteId: 42,
        signatureRequestId: 'sig-req-abc',
        draftPdfStorageKey: 'msa/1/draft.pdf',
      },
    });
  });

  it('rejects when the Quote does not exist', async () => {
    mocks.dbResults.push([MSA_PENDING], [DEALER_ROW], []); // quote lookup empty
    const result = await call(
      sendMsaEnvelope(fd({ msaId: '1', firstQuoteId: '99' })),
    );
    expect((result as { error: string }).error).toContain('Quote not found');
    expect(mocks.renderMsaPdf).not.toHaveBeenCalled();
    expect(mocks.sendSignatureRequest).not.toHaveBeenCalled();
    expect(mocks.updates).toHaveLength(0);
  });

  it('rejects when the dealer is archived (no envelope post)', async () => {
    mocks.dbResults.push([MSA_PENDING], []); // dealer archived → empty
    const result = await call(
      sendMsaEnvelope(fd({ msaId: '1', firstQuoteId: '42' })),
    );
    expect((result as { error: string }).error).toContain('Dealer not found');
    expect(mocks.sendSignatureRequest).not.toHaveBeenCalled();
    expect(mocks.updates).toHaveLength(0);
    expect(mocks.putObject).not.toHaveBeenCalled();
  });

  it('does not mutate row state when the Dropbox Sign API call fails', async () => {
    mocks.dbResults.push([MSA_PENDING], [DEALER_ROW], [DRAFT_QUOTE_ROW]);
    mocks.sendSignatureRequest.mockResolvedValueOnce({
      error: 'rate limit',
    });
    const result = await call(
      sendMsaEnvelope(fd({ msaId: '1', firstQuoteId: '42' })),
    );
    expect((result as { error: string }).error).toContain(
      'Dropbox Sign send failed',
    );
    expect(mocks.updates).toHaveLength(0);
    expect(mocks.recordAudit).not.toHaveBeenCalled();
  });

  it('is idempotent when the MSA already has a dropboxSignDocumentId', async () => {
    mocks.dbResults.push([
      { ...MSA_PENDING, dropboxSignDocumentId: 'sig-req-existing' },
    ]);
    const result = await call(
      sendMsaEnvelope(fd({ msaId: '1', firstQuoteId: '42' })),
    );
    expect(result).toEqual({ ok: true });
    expect(mocks.renderMsaPdf).not.toHaveBeenCalled();
    expect(mocks.sendSignatureRequest).not.toHaveBeenCalled();
    expect(mocks.updates).toHaveLength(0);
    expect(mocks.recordAudit).not.toHaveBeenCalled();
  });

  it('rejects when the Quote belongs to a different dealer', async () => {
    mocks.dbResults.push(
      [MSA_PENDING],
      [DEALER_ROW],
      [{ ...DRAFT_QUOTE_ROW, dealerId: 99 }],
    );
    const result = await call(
      sendMsaEnvelope(fd({ msaId: '1', firstQuoteId: '42' })),
    );
    expect((result as { error: string }).error).toContain(
      'Quote does not belong',
    );
    expect(mocks.sendSignatureRequest).not.toHaveBeenCalled();
  });

  it('rejects when the Quote is not in draft', async () => {
    mocks.dbResults.push(
      [MSA_PENDING],
      [DEALER_ROW],
      [{ ...DRAFT_QUOTE_ROW, status: 'sent' }],
    );
    const result = await call(
      sendMsaEnvelope(fd({ msaId: '1', firstQuoteId: '42' })),
    );
    expect((result as { error: string }).error).toContain('must be in draft');
    expect(mocks.sendSignatureRequest).not.toHaveBeenCalled();
  });
});
