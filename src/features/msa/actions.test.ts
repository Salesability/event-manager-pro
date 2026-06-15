import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  assertCan: vi.fn(),
  getUser: vi.fn(),
  loadCurrentMembership: vi.fn(),
  recordAudit: vi.fn(),
  renderMsaPdf: vi.fn(),
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
vi.mock('@/lib/storage/gcs', () => ({ putObject: mocks.putObject }));
vi.mock('@/features/quotes/recipient', () => ({
  resolveQuoteRecipient: mocks.resolveQuoteRecipient,
}));
vi.mock('@/lib/boldsign/client', () => ({
  sendSignatureRequest: mocks.sendSignatureRequest,
}));
vi.mock('@/features/msa/template-version', () => ({
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

import { createMsaDraft, sendMsaEnvelope, sendTestMsa } from './actions';

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
  providerDocumentId: null as string | null,
};

const DEALER_ROW = {
  id: 7,
  name: 'Acme Auto Group',
  address: '456 Dealership Boulevard\nMississauga, ON  L5B 3C2',
};

// 0082: the MSA renders on its own; its signature anchor is forwarded straight
// to BoldSign (no merge step shifting page coordinates).
const MSA_SIG_ANCHOR = { pageNumber: 1, x: 321, y: 600, width: 241, height: 22 };

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
    signatureAnchor: MSA_SIG_ANCHOR,
  });
  mocks.putObject.mockResolvedValue({ ok: true, key: 'msa/1/draft.pdf' });
  mocks.resolveQuoteRecipient.mockResolvedValue({
    ok: true,
    recipient: { email: 'buyer@dealer.test', firstName: 'Pat' },
  });
  mocks.sendSignatureRequest.mockResolvedValue({
    ok: true,
    documentId: 'doc-abc',
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

describe('sendMsaEnvelope (0082 — MSA-only)', () => {
  it('happy path: renders the MSA alone, uploads one draft, posts a single-file MSA-only envelope, persists doc id, emits audit — no quote touched', async () => {
    // MSA pre-load → dealer → guarded MSA UPDATE. No quote read or write.
    mocks.dbResults.push([MSA_PENDING], [DEALER_ROW], [{ id: 1 }]);

    const result = await call(sendMsaEnvelope(fd({ msaId: '1' })));

    expect(result).toEqual({ ok: true });
    expect(mocks.renderMsaPdf).toHaveBeenCalledTimes(1);
    const msaData = mocks.renderMsaPdf.mock.calls[0][0] as Record<string, unknown>;
    expect(msaData.msaNumber).toBe('1');
    expect(msaData.clientName).toBe('Acme Auto Group');
    expect(msaData.signerEmail).toBe('buyer@dealer.test');
    expect(msaData.terminationNoticeDays).toBe(30);
    expect(msaData.templateVersion).toBe('2026-05-12');

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
    expect(files).toHaveLength(1);
    expect(files[0].filename).toBe('agreement-1.pdf');
    // MSA-only: no initials anchor, and the MSA's own signature anchor is
    // forwarded as-is (no merge step shifting the page number).
    expect(envelopeArg.initialsAnchors).toBeUndefined();
    expect(envelopeArg.signatureAnchor).toEqual(MSA_SIG_ANCHOR);
    expect(envelopeArg.metadata).toEqual({ msaId: '1' });
    expect((envelopeArg.signer as { emailAddress: string }).emailAddress).toBe(
      'buyer@dealer.test',
    );

    // Exactly ONE update: the MSA providerDocumentId. No quote→MSA link.
    expect(mocks.updates).toHaveLength(1);
    expect(mocks.updates[0].table).toBe('master_service_agreements');
    expect((mocks.updates[0].patch as Record<string, unknown>).providerDocumentId).toBe(
      'doc-abc',
    );

    expect(mocks.recordAudit).toHaveBeenCalledWith({
      action: 'msa.sent',
      targetTable: 'master_service_agreements',
      targetId: 1,
      payload: {
        dealerId: 7,
        providerDocumentId: 'doc-abc',
        draftPdfStorageKey: 'msa/1/draft.pdf',
      },
    });
  });

  it('rejects when the dealer is archived (no envelope post)', async () => {
    mocks.dbResults.push([MSA_PENDING], []); // dealer archived → empty
    const result = await call(sendMsaEnvelope(fd({ msaId: '1' })));
    expect((result as { error: string }).error).toContain('Dealer not found');
    expect(mocks.sendSignatureRequest).not.toHaveBeenCalled();
    expect(mocks.updates).toHaveLength(0);
    expect(mocks.putObject).not.toHaveBeenCalled();
  });

  it('rejects when the MSA is not pending', async () => {
    mocks.dbResults.push([{ ...MSA_PENDING, status: 'active' }]);
    const result = await call(sendMsaEnvelope(fd({ msaId: '1' })));
    expect((result as { error: string }).error).toContain('cannot be sent');
    expect(mocks.renderMsaPdf).not.toHaveBeenCalled();
    expect(mocks.sendSignatureRequest).not.toHaveBeenCalled();
  });

  it('does not mutate row state when the BoldSign API call fails', async () => {
    mocks.dbResults.push([MSA_PENDING], [DEALER_ROW]);
    mocks.sendSignatureRequest.mockResolvedValueOnce({
      error: 'rate limit',
    });
    const result = await call(sendMsaEnvelope(fd({ msaId: '1' })));
    expect((result as { error: string }).error).toContain(
      'BoldSign send failed',
    );
    expect(mocks.updates).toHaveLength(0);
    expect(mocks.recordAudit).not.toHaveBeenCalled();
  });

  it('is idempotent when the MSA already has a providerDocumentId', async () => {
    mocks.dbResults.push([
      { ...MSA_PENDING, providerDocumentId: 'sig-req-existing' },
    ]);
    const result = await call(sendMsaEnvelope(fd({ msaId: '1' })));
    expect(result).toEqual({ ok: true });
    expect(mocks.renderMsaPdf).not.toHaveBeenCalled();
    expect(mocks.sendSignatureRequest).not.toHaveBeenCalled();
    expect(mocks.updates).toHaveLength(0);
    expect(mocks.recordAudit).not.toHaveBeenCalled();
  });
});

// 0067 — admin BoldSign-verification tool. No DB row; renders placeholder MSA
// prose and posts a real envelope, surfacing the documentId.
describe('sendTestMsa', () => {
  const SIG_ANCHOR = { pageNumber: 3, x: 321, y: 600, width: 241, height: 22 };

  beforeEach(() => {
    // Default render mock omits signatureAnchor; the test tool passes it
    // through to BoldSign, so give it one for the happy-path assertions.
    mocks.renderMsaPdf.mockResolvedValue({
      ok: true,
      body: Buffer.from('%PDF-test-msa'),
      signatureAnchor: SIG_ANCHOR,
    });
  });

  it('renders placeholder MSA + posts a test envelope, returning the documentId', async () => {
    const result = await call(
      sendTestMsa(fd({ to: 'me@admin.test', signerName: 'Pat Admin', message: 'pls sign' })),
    );
    expect(result).toEqual({ ok: true, documentId: 'doc-abc' });

    // Render got placeholder data with the typed signer threaded in.
    const renderArg = mocks.renderMsaPdf.mock.calls[0][0] as Record<string, unknown>;
    expect(renderArg.signerName).toBe('Pat Admin');
    expect(renderArg.signerEmail).toBe('me@admin.test');
    expect(renderArg.templateVersion).toBe('2026-05-12');

    // Envelope went to the typed recipient with the test metadata + anchor.
    const sendArg = mocks.sendSignatureRequest.mock.calls[0][0] as {
      signer: { emailAddress: string; name: string };
      metadata: Record<string, string>;
      signatureAnchor: unknown;
      message: string;
    };
    expect(sendArg.signer).toEqual({ emailAddress: 'me@admin.test', name: 'Pat Admin' });
    expect(sendArg.metadata).toEqual({ test: 'true' });
    expect(sendArg.signatureAnchor).toEqual(SIG_ANCHOR);
    expect(sendArg.message).toBe('pls sign');
  });

  it('falls back to a default message when none is supplied', async () => {
    await call(sendTestMsa(fd({ to: 'me@admin.test', signerName: 'Pat Admin' })));
    const sendArg = mocks.sendSignatureRequest.mock.calls[0][0] as { message: string };
    expect(sendArg.message).toMatch(/TEST envelope/i);
  });

  it('rejects a malformed recipient without rendering or sending', async () => {
    const result = await call(sendTestMsa(fd({ to: 'nope', signerName: 'Pat Admin' })));
    expect((result as { error: string }).error).toMatch(/valid email/i);
    expect(mocks.renderMsaPdf).not.toHaveBeenCalled();
    expect(mocks.sendSignatureRequest).not.toHaveBeenCalled();
  });

  it('rejects an empty signer name', async () => {
    const result = await call(sendTestMsa(fd({ to: 'me@admin.test', signerName: '  ' })));
    expect((result as { error: string }).error).toMatch(/signer name/i);
    expect(mocks.sendSignatureRequest).not.toHaveBeenCalled();
  });

  it('surfaces a missing MSA_TEMPLATE_VERSION before any send', async () => {
    mocks.currentMsaTemplateVersion.mockReturnValueOnce({
      error: 'MSA_TEMPLATE_VERSION is not set.',
    });
    const result = await call(sendTestMsa(fd({ to: 'me@admin.test', signerName: 'Pat Admin' })));
    expect((result as { error: string }).error).toContain('MSA_TEMPLATE_VERSION');
    expect(mocks.renderMsaPdf).not.toHaveBeenCalled();
    expect(mocks.sendSignatureRequest).not.toHaveBeenCalled();
  });

  it('surfaces a render failure', async () => {
    mocks.renderMsaPdf.mockResolvedValueOnce({ error: 'boom' });
    const result = await call(sendTestMsa(fd({ to: 'me@admin.test', signerName: 'Pat Admin' })));
    expect((result as { error: string }).error).toContain('MSA PDF render failed');
    expect(mocks.sendSignatureRequest).not.toHaveBeenCalled();
  });

  it('surfaces a BoldSign send failure', async () => {
    mocks.sendSignatureRequest.mockResolvedValueOnce({ error: 'BoldSign 401' });
    const result = await call(sendTestMsa(fd({ to: 'me@admin.test', signerName: 'Pat Admin' })));
    expect((result as { error: string }).error).toContain('BoldSign send failed');
  });
});
