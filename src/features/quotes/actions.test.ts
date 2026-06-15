import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  assertCan: vi.fn(),
  getUser: vi.fn(),
  loadCurrentMembership: vi.fn(),
  recordAudit: vi.fn(),
  renderQuotePdf: vi.fn(),
  putObject: vi.fn(),
  getObject: vi.fn(),
  deleteObject: vi.fn(),
  resolveQuoteRecipient: vi.fn(),
  sendEmail: vi.fn(),
  quoteEmail: vi.fn(),
  // Queue consumed by both `.returning()` calls and `.then()` / `.limit()`
  // terminals on the predicate-blind db mock. Push one entry per DB round-trip
  // in the order the code under test will issue them.
  dbResults: [] as unknown[][],
  // Dedicated FIFO for `select ... from(quote_attachments)` reads so adding the
  // 0078 attachment select inside `sendQuote` doesn't shift every existing
  // sendQuote test's `dbResults` alignment. Defaults to [] (no attachments).
  attachmentResults: [] as unknown[][],
  inserts: [] as Array<{ table: string; values: unknown }>,
  updates: [] as Array<{ table: string; patch: unknown }>,
  deletes: [] as Array<{ table: string }>,
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
vi.mock('@/lib/auth/assert-can', () => ({
  assertCan: mocks.assertCan,
}));
vi.mock('@/lib/supabase/session', () => ({ getUser: mocks.getUser }));
vi.mock('@/lib/auth/load-team-membership', async (importOriginal) => {
  const real =
    await importOriginal<typeof import('@/lib/auth/load-team-membership')>();
  return {
    ...real,
    loadCurrentMembership: mocks.loadCurrentMembership,
  };
});
// 0065: the quote actions derive tax from the dealer's province rate. Stub the
// rate lookup to 0 here so these pre-existing tax assertions (tax = 0 or the
// typed override) hold; the rate math itself is covered in pricing.test.ts.
vi.mock('@/features/tax-rates/queries', () => ({
  dealerTaxRatePct: () => Promise.resolve(0),
}));
vi.mock('@/features/audit/actions', () => ({
  recordAudit: mocks.recordAudit,
}));
vi.mock('@/lib/pdf/render-quote', () => ({
  renderQuotePdf: mocks.renderQuotePdf,
}));
vi.mock('@/lib/storage/gcs', () => ({
  putObject: mocks.putObject,
  getObject: mocks.getObject,
  deleteObject: mocks.deleteObject,
}));
vi.mock('./recipient', () => ({
  resolveQuoteRecipient: mocks.resolveQuoteRecipient,
}));
vi.mock('@/lib/email/send', () => ({
  sendEmail: mocks.sendEmail,
}));
vi.mock('@/lib/email/templates/quote', () => ({
  quoteEmail: mocks.quoteEmail,
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
    // 0062: the picker write path delete-and-inserts quote_line_items. The
    // delete is awaited without `.returning()`; record it + resolve empty so it
    // doesn't consume a dbResults entry (keeps the test FIFO aligned).
    delete: (table: unknown) => ({
      where: () => {
        mocks.deletes.push({ table: tableName(table) });
        // Two shapes: the 0062 line-items path awaits `.where()` directly
        // (resolves to [], no dbResults consume); the 0078 attachment-remove
        // path calls `.returning()` (consumes one dbResults entry).
        return {
          returning: () => Promise.resolve(mocks.dbResults.shift() ?? []),
          then: (onFulfilled: (v: unknown[]) => unknown) =>
            Promise.resolve([]).then(onFulfilled),
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
      from: (table: unknown) => {
        // Route quote_attachments reads to their own queue (0078) so the
        // attachment select added inside sendQuote doesn't disturb the shared
        // dbResults FIFO the rest of the sendQuote tests depend on.
        const queue =
          tableName(table) === 'quote_attachments'
            ? mocks.attachmentResults
            : mocks.dbResults;
        const next = () => Promise.resolve(queue.shift() ?? []);
        const terminal: {
          limit: () => Promise<unknown[]>;
          orderBy: () => Promise<unknown[]>;
          for: () => typeof terminal;
          then: (onFulfilled: (v: unknown[]) => unknown) => Promise<unknown>;
        } = {
          limit: () => next(),
          orderBy: () => next(),
          // `.for('update')` — row-lock chain. Mirror the terminal so a
          // subsequent .limit()/.then() works on top of it.
          for: () => terminal,
          then: (onFulfilled: (v: unknown[]) => unknown) => next().then(onFulfilled),
        };
        return {
          where: () => terminal,
        };
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

import {
  acceptQuote,
  createQuote,
  declineQuote,
  removeQuoteAttachment,
  sendQuote,
  setQuoteDealer,
  setQuoteInputs,
  uploadQuoteAttachment,
} from './actions';
import { MAX_ADDRESS_LINES } from './constants';
import { MAX_TOTAL_ATTACHMENT_BYTES } from './attachments';
import { markQuoteAccepted, markQuoteDeclined } from './lifecycle';

// Unwrap the next-safe-action envelope into the legacy ActionResult shape.
async function call<T>(
  p: Promise<{ data?: T; serverError?: string; validationErrors?: unknown } | undefined | null>,
): Promise<T> {
  const r = await p;
  if (!r) throw new Error('action returned null/undefined');
  if (r.serverError) throw new Error(`unexpected serverError: ${r.serverError}`);
  if (r.validationErrors) {
    throw new Error(`unexpected validationErrors: ${JSON.stringify(r.validationErrors)}`);
  }
  if (r.data === undefined) {
    throw new Error('action returned undefined data');
  }
  return r.data;
}

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.append(k, v);
  return f;
}

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
  mocks.renderQuotePdf.mockResolvedValue({ ok: true, body: Buffer.from('%PDF-1.7 stub') });
  mocks.putObject.mockResolvedValue({ ok: true, key: 'stub' });
  mocks.getObject.mockResolvedValue({ ok: true, body: Buffer.from('attachment-bytes') });
  mocks.deleteObject.mockResolvedValue({ ok: true });
  mocks.resolveQuoteRecipient.mockResolvedValue({
    ok: true,
    recipient: { email: 'buyer@dealer.test', firstName: 'Pat' },
  });
  mocks.quoteEmail.mockResolvedValue({
    subject: 'Your Salesability Quote — Quote-20260512-0700',
    text: 'Plain text body',
    html: '<p>HTML body</p>',
  });
  mocks.sendEmail.mockResolvedValue({ ok: true, id: 'resend-msg-id' });
  mocks.dbResults = [];
  mocks.attachmentResults = [];
  mocks.inserts = [];
  mocks.updates = [];
  mocks.deletes = [];
  // sendQuote requires GCS_BUCKET — the dev .env carries it, but vitest
  // doesn't pull dotenv. Set it explicitly per-test so the action doesn't
  // bail before the render/upload path is exercised.
  process.env.GCS_BUCKET = 'test-bucket';
});

describe('createQuote', () => {
  it('inserts a draft quote for an active dealer and emits audit', async () => {
    mocks.dbResults.push([{ id: 7 }], [{ id: 42 }]);

    const result = await call(createQuote(fd({ dealerId: '7' })));

    expect(result).toEqual({ ok: true, quoteId: 42 });
    expect(mocks.inserts).toHaveLength(1);
    expect(mocks.inserts[0].table).toBe('quotes');
    const values = mocks.inserts[0].values as Record<string, unknown>;
    expect(values.dealerId).toBe(7);
    expect(values.inputs).toMatchObject({ audienceSize: 500, eventDays: 1 });
    expect(values.createdById).toBe('coach-uuid');
    expect(mocks.recordAudit).toHaveBeenCalledWith({
      action: 'quote.create',
      targetTable: 'quotes',
      targetId: 42,
      payload: { dealerId: 7 },
    });
  });

  it('rejects when dealerId is missing', async () => {
    const result = await call(createQuote(fd({})));
    expect(result).toEqual({ error: 'Dealer is required.' });
    expect(mocks.inserts).toHaveLength(0);
    expect(mocks.recordAudit).not.toHaveBeenCalled();
  });

  it('rejects when dealer is missing or archived', async () => {
    mocks.dbResults.push([]); // dealer lookup returns nothing (archivedAt-aware)
    const result = await call(createQuote(fd({ dealerId: '99' })));
    expect(result).toEqual({ error: 'Dealer not found or archived.' });
    expect(mocks.inserts).toHaveLength(0);
    expect(mocks.recordAudit).not.toHaveBeenCalled();
  });
});

// Realistic draft row that sendQuote pre-loads. Tests can override fields
// via spread; the mocked db queue feeds the values through.
// `createdAt` (2026-05-12 11:00 UTC = 07:00 EDT) renders as
// `Quote-20260512-0700` via `quoteDisplayName` — used in subject/filename
// assertions below.
const DRAFT_ROW = {
  id: 42,
  status: 'draft',
  dealerId: 7,
  sentAt: null,
  updatedAt: new Date('2026-05-12T12:00:00.000Z'),
  createdAt: new Date('2026-05-12T11:00:00.000Z'),
  acceptToken: '11111111-2222-3333-4444-555555555555',
  quoteValidDays: 30,
  // 0062: render lines come inline from the quote_line_items subquery
  // (`renderLines`), mapped by `mapRenderLines` (label → PDF description).
  renderLines: [
    {
      label: 'Base Event (includes 500 records)',
      description: null,
      qty: 1,
      unitPrice: 6900,
      overrideUnitPrice: null,
      lineTotal: 6900,
    },
  ],
  subtotal: '6900.00',
  tax: '0.00',
  total: '6900.00',
};

// Already-sent row used by re-send tests. Pre-load matches DRAFT_ROW shape
// but with the lifecycle fields a `sent` quote carries.
const SENT_ROW = {
  ...DRAFT_ROW,
  status: 'sent',
  sentAt: new Date('2026-05-12T13:00:00.000Z'),
  // The composer's setQuoteInputs bumps updatedAt on every save; an
  // already-sent row pre-loaded for re-send carries the latest one.
  updatedAt: new Date('2026-05-12T13:00:00.000Z'),
};

const DEALER_ROW = {
  id: 7,
  name: 'Acme Auto Group',
  address:
    '456 Dealership Boulevard\nSuite 200\nMississauga, ON  L5B 3C2\nCanada',
};

describe('sendQuote', () => {
  it('renders PDF, flips draft → sent, uploads to GCS, sets sentAt + pdfStorageKey, and emits audit', async () => {
    // Pre-load: draft row + dealer; then guarded UPDATE returns one row.
    mocks.dbResults.push([DRAFT_ROW], [DEALER_ROW], [{ id: 42 }]);

    const result = await call(sendQuote(fd({ quoteId: '42' })));
    expect(result).toEqual({ ok: true });

    // Renderer received a QuoteData assembled from the row + dealer.
    expect(mocks.renderQuotePdf).toHaveBeenCalledTimes(1);
    const quoteData = mocks.renderQuotePdf.mock.calls[0][0] as Record<string, unknown>;
    expect(quoteData.createdAt).toEqual(DRAFT_ROW.createdAt);
    expect(quoteData.clientName).toBe('Acme Auto Group');
    expect(quoteData.clientAddress).toEqual([
      '456 Dealership Boulevard',
      'Suite 200',
      'Mississauga, ON  L5B 3C2',
      'Canada',
    ]);
    expect(quoteData.subtotal).toBe(6900);
    expect(quoteData.total).toBe(6900);
    // Line-items mapped from {label, qty, lineTotal} → {description, quantity, total}.
    const lines = quoteData.lineItems as Array<Record<string, unknown>>;
    expect(lines[0].description).toBe('Base Event (includes 500 records)');
    expect(lines[0].quantity).toBe(1);
    expect(lines[0].total).toBe(6900);

    // Upload landed at the canonical key.
    expect(mocks.putObject).toHaveBeenCalledTimes(1);
    const uploadArg = mocks.putObject.mock.calls[0][0] as Record<string, unknown>;
    expect(uploadArg.bucket).toBe('test-bucket');
    expect(uploadArg.key).toBe('quotes/42/1.pdf');
    expect(uploadArg.contentType).toBe('application/pdf');
    expect(uploadArg.ifGenerationMatch).toBeUndefined();

    // Transition update carries the storage key + sentAt timestamp + the
    // recipient denorm (0040: lets the UI show the address the email actually
    // went to without resolving from current dealer state).
    expect(mocks.updates).toHaveLength(1);
    const patch = mocks.updates[0].patch as Record<string, unknown>;
    expect(patch.status).toBe('sent');
    expect(patch.sentAt).toBeInstanceOf(Date);
    expect(patch.pdfStorageKey).toBe('quotes/42/1.pdf');
    expect(patch.sentToEmail).toBe('buyer@dealer.test');
    expect(patch.sentToFirstName).toBe('Pat');

    expect(mocks.recordAudit).toHaveBeenCalledWith({
      action: 'quote.sent',
      targetTable: 'quotes',
      targetId: 42,
      payload: {
        pdfStorageKey: 'quotes/42/1.pdf',
        emailId: 'resend-msg-id',
        sentToEmail: 'buyer@dealer.test',
        sentToFirstName: 'Pat',
        // 0078: no uploads on this quote → empty attachment denorm.
        attachmentCount: 0,
        attachments: [],
      },
    });
    expect(mocks.sendEmail).toHaveBeenCalledTimes(1);
    const sendArg = mocks.sendEmail.mock.calls[0][0] as Record<string, unknown>;
    expect(sendArg.to).toBe('buyer@dealer.test');
    expect(sendArg.subject).toBe('Your Salesability Quote — Quote-20260512-0700');
    expect(sendArg.html).toBe('<p>HTML body</p>');
    const attachments = sendArg.attachments as Array<Record<string, unknown>>;
    expect(attachments[0].filename).toBe('saledayevents-Quote-20260512-0700.pdf');
    expect(attachments[0].contentType).toBe('application/pdf');

    // Email template received the recipient name + quote summary; no
    // accept/decline URLs in v1 (the coach flips the status via the staff
    // surface after the customer phones or replies).
    expect(mocks.quoteEmail).toHaveBeenCalledTimes(1);
    const tplArg = mocks.quoteEmail.mock.calls[0][0] as Record<string, unknown>;
    expect(tplArg.firstName).toBe('Pat');
    expect(tplArg.createdAt).toEqual(DRAFT_ROW.createdAt);
    expect(tplArg).not.toHaveProperty('acceptUrl');
    expect(tplArg).not.toHaveProperty('declineUrl');

    // 0044: PDF + email both receive validUntilDate derived from sentAt +
    // quoteValidDays (default 30). The same anchor `sentAt` lands on the row
    // and the rendered strings, so issued/valid lines stay in sync.
    expect(quoteData.issuedDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(quoteData.validUntilDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const issuedMs = new Date(`${quoteData.issuedDate}T00:00:00.000Z`).getTime();
    const validMs = new Date(`${quoteData.validUntilDate}T00:00:00.000Z`).getTime();
    expect(validMs - issuedMs).toBe(30 * 24 * 60 * 60 * 1000);
    expect(tplArg.validUntilDate).toBe(quoteData.validUntilDate);
  });

  it('honors a per-row quoteValidDays override on the PDF + email (14 days, not the 30-day default)', async () => {
    mocks.dbResults.push(
      [{ ...DRAFT_ROW, quoteValidDays: 14 }],
      [DEALER_ROW],
      [{ id: 42 }],
    );
    await call(sendQuote(fd({ quoteId: '42' })));
    const quoteData = mocks.renderQuotePdf.mock.calls[0][0] as Record<string, unknown>;
    const tplArg = mocks.quoteEmail.mock.calls[0][0] as Record<string, unknown>;
    const issuedMs = new Date(`${quoteData.issuedDate}T00:00:00.000Z`).getTime();
    const validMs = new Date(`${quoteData.validUntilDate}T00:00:00.000Z`).getTime();
    expect(validMs - issuedMs).toBe(14 * 24 * 60 * 60 * 1000);
    expect(tplArg.validUntilDate).toBe(quoteData.validUntilDate);
  });

  it('fails closed when the dealer has no customer-contact primary email (no render, no transition)', async () => {
    mocks.dbResults.push([DRAFT_ROW], [DEALER_ROW]);
    mocks.resolveQuoteRecipient.mockResolvedValueOnce({
      error: 'Dealer has no customer contact with a primary email address. Add a customer contact before sending.',
    });
    const result = await call(sendQuote(fd({ quoteId: '42' })));
    expect((result as { error: string }).error).toContain('primary email');
    expect(mocks.renderQuotePdf).not.toHaveBeenCalled();
    expect(mocks.updates).toHaveLength(0);
    expect(mocks.putObject).not.toHaveBeenCalled();
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });

  it('surfaces a degraded-state error when email send fails after the transition', async () => {
    mocks.dbResults.push([DRAFT_ROW], [DEALER_ROW], [{ id: 42 }]);
    mocks.sendEmail.mockResolvedValueOnce({ error: 'Resend rejected the send' });
    const result = await call(sendQuote(fd({ quoteId: '42' })));
    expect(result).toEqual({
      error: 'Quote sent but email delivery failed; admin repair required.',
    });
    // Row is already flipped — the UPDATE landed before the email attempt.
    expect((mocks.updates[0].patch as Record<string, unknown>).status).toBe('sent');
    expect(mocks.recordAudit).not.toHaveBeenCalled();
  });

  it('handles a null dealer.address without breaking the renderer call', async () => {
    mocks.dbResults.push(
      [DRAFT_ROW],
      [{ ...DEALER_ROW, address: null }],
      [{ id: 42 }],
    );
    await call(sendQuote(fd({ quoteId: '42' })));
    const quoteData = mocks.renderQuotePdf.mock.calls[0][0] as Record<string, unknown>;
    expect(quoteData.clientAddress).toBeUndefined();
  });

  it('caps multi-line dealer.address before passing it to the renderer', async () => {
    mocks.dbResults.push(
      [DRAFT_ROW],
      [
        {
          ...DEALER_ROW,
          address: 'Line 1\nLine 2\nLine 3\nLine 4\nLine 5\nLine 6',
        },
      ],
      [{ id: 42 }],
    );
    await call(sendQuote(fd({ quoteId: '42' })));
    const quoteData = mocks.renderQuotePdf.mock.calls[0][0] as Record<string, unknown>;
    expect(quoteData.clientAddress).toEqual(['Line 1', 'Line 2', 'Line 3', 'Line 4']);
    expect((quoteData.clientAddress as string[]).length).toBe(MAX_ADDRESS_LINES);
  });

  it('re-sends an already-sent quote: re-renders, re-uploads, resets sentAt, and emits a fresh quote.sent audit row (0046)', async () => {
    // Pre-load finds status='sent'; dealer; MSA-pending lookup empty
    // (no in-flight envelope); UPDATE returns one row.
    mocks.dbResults.push([SENT_ROW], [DEALER_ROW], [], [{ id: 42 }]);
    const result = await call(sendQuote(fd({ quoteId: '42' })));
    expect(result).toEqual({ ok: true });
    expect(mocks.renderQuotePdf).toHaveBeenCalledTimes(1);
    expect(mocks.putObject).toHaveBeenCalledTimes(1);
    // PDF overwrites the existing storage key (no versioning suffix).
    expect((mocks.putObject.mock.calls[0][0] as Record<string, unknown>).key).toBe('quotes/42/1.pdf');
    const patch = mocks.updates[0].patch as Record<string, unknown>;
    expect(patch.status).toBe('sent');
    expect(patch.sentAt).toBeInstanceOf(Date);
    // Reset to "now" — strictly after the pre-loaded `sentAt`.
    expect((patch.sentAt as Date).getTime()).toBeGreaterThan(SENT_ROW.sentAt.getTime());
    expect(patch.pdfStorageKey).toBe('quotes/42/1.pdf');
    expect(mocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'quote.sent', targetId: 42 }),
    );
  });

  it('re-sends an expired quote (status=sent + past validity is presentational only)', async () => {
    const longAgoSent = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
    mocks.dbResults.push(
      [{ ...SENT_ROW, sentAt: longAgoSent, updatedAt: longAgoSent }],
      [DEALER_ROW],
      [], // MSA-pending lookup empty
      [{ id: 42 }],
    );
    const result = await call(sendQuote(fd({ quoteId: '42' })));
    expect(result).toEqual({ ok: true });
    const patch = mocks.updates[0].patch as Record<string, unknown>;
    expect((patch.sentAt as Date).getTime()).toBeGreaterThan(longAgoSent.getTime());
  });

  it('rejects send from accepted with the friendly terminal-status message (no render)', async () => {
    mocks.dbResults.push([{ ...DRAFT_ROW, status: 'accepted' }]);
    const result = await call(sendQuote(fd({ quoteId: '42' })));
    expect(result).toEqual({
      error: 'This quote has been accepted — make a new quote to revise it.',
    });
    expect(mocks.renderQuotePdf).not.toHaveBeenCalled();
    expect(mocks.putObject).not.toHaveBeenCalled();
    expect(mocks.updates).toHaveLength(0);
  });

  it('rejects send from declined with the friendly terminal-status message (no render)', async () => {
    mocks.dbResults.push([{ ...DRAFT_ROW, status: 'declined' }]);
    const result = await call(sendQuote(fd({ quoteId: '42' })));
    expect(result).toEqual({
      error: 'This quote has been declined — make a new quote to revise it.',
    });
    expect(mocks.renderQuotePdf).not.toHaveBeenCalled();
    expect(mocks.updates).toHaveLength(0);
  });

  it('rejects when the quote does not exist (pre-load returns nothing)', async () => {
    mocks.dbResults.push([]);
    const result = await call(sendQuote(fd({ quoteId: '999' })));
    expect(result).toEqual({ error: 'Quote not found.' });
    expect(mocks.renderQuotePdf).not.toHaveBeenCalled();
  });

  it('rejects when the dealer behind the quote is missing or archived', async () => {
    mocks.dbResults.push([DRAFT_ROW], []);
    const result = await call(sendQuote(fd({ quoteId: '42' })));
    expect(result).toEqual({ error: 'Dealer not found or archived.' });
    expect(mocks.renderQuotePdf).not.toHaveBeenCalled();
  });

  it('surfaces render errors without flipping status or uploading', async () => {
    mocks.dbResults.push([DRAFT_ROW], [DEALER_ROW]);
    mocks.renderQuotePdf.mockResolvedValueOnce({ error: 'too many line items' });
    const result = await call(sendQuote(fd({ quoteId: '42' })));
    expect(result).toEqual({ error: 'Quote PDF render failed: too many line items' });
    expect(mocks.putObject).not.toHaveBeenCalled();
    expect(mocks.updates).toHaveLength(0);
  });

  it('surfaces upload errors after the successful sent transition as degraded state', async () => {
    mocks.dbResults.push([DRAFT_ROW], [DEALER_ROW], [{ id: 42 }]);
    mocks.putObject.mockResolvedValueOnce({ error: 'bucket unavailable' });
    const result = await call(sendQuote(fd({ quoteId: '42' })));
    expect(result).toEqual({
      error: 'Quote sent but PDF upload failed; admin repair required.',
    });
    expect(mocks.updates).toHaveLength(1);
    expect(mocks.recordAudit).not.toHaveBeenCalled();
  });

  it('falls back to idempotent on a UPDATE race (already sent by a concurrent caller)', async () => {
    // Pre-load + dealer succeed; render succeeds; UPDATE misses before upload;
    // re-select finds the row in 'sent' with a different updatedAt AND an
    // advanced sentAt (the concurrent caller's UPDATE wrote both). Mimics a
    // concurrent send winning the race — OQ #6 says the second clicker sees
    // ok:true (the row IS now freshly sent, their snapshot just wasn't the
    // one used). The advanced `sentAt` is the load-bearing signal that
    // distinguishes "concurrent send won" from "concurrent edit bumped
    // updatedAt" (eval Codex High #1).
    mocks.dbResults.push(
      [DRAFT_ROW],
      [DEALER_ROW],
      [],
      [{
        id: 42,
        status: 'sent',
        updatedAt: new Date('2026-05-12T12:00:05.000Z'),
        sentAt: new Date('2026-05-12T12:00:05.000Z'),
      }],
    );
    const result = await call(sendQuote(fd({ quoteId: '42' })));
    expect(result).toEqual({ ok: true });
    expect(mocks.putObject).not.toHaveBeenCalled();
    expect(mocks.recordAudit).not.toHaveBeenCalled();
  });

  it('rejects rather than claims success when a concurrent EDIT (not a send) bumped updatedAt under a re-send (eval Codex High #1)', async () => {
    // Pre-load row=sent at T1; dealer; MSA empty; UPDATE misses; re-select
    // finds the row still in `sent` with a DIFFERENT updatedAt but the SAME
    // (unchanged) sentAt — a concurrent `setQuoteInputs` ran. The pre-fix
    // path would have returned ok:true (claiming the re-send succeeded);
    // the fixed path classifies as concurrent edit and returns the retry
    // error so the coach re-pre-loads before re-sending stale data.
    mocks.dbResults.push(
      [SENT_ROW],
      [DEALER_ROW],
      [],
      [],
      [{
        id: 42,
        status: 'sent',
        updatedAt: new Date('2026-05-12T13:30:00.000Z'),
        sentAt: SENT_ROW.sentAt, // unchanged
      }],
    );
    const result = await call(sendQuote(fd({ quoteId: '42' })));
    expect(result).toEqual({ error: 'Quote was edited concurrently; please retry.' });
    expect(mocks.recordAudit).not.toHaveBeenCalled();
  });

  it('refuses re-send when the dealer\'s MSA envelope is in flight (status=pending + providerDocumentId set)', async () => {
    // Pre-load row=sent, dealer; MSA-pending in-flight lookup returns a row
    // with a providerDocumentId. Action aborts before render/recipient/UPDATE.
    mocks.dbResults.push(
      [SENT_ROW],
      [DEALER_ROW],
      [{ status: 'pending', providerDocumentId: 'dbox-sign-123' }],
    );
    const result = await call(sendQuote(fd({ quoteId: '42' })));
    expect(result).toEqual({
      error:
        'MSA envelope is in flight — finish signing or terminate before re-sending this quote.',
    });
    expect(mocks.renderQuotePdf).not.toHaveBeenCalled();
    expect(mocks.updates).toHaveLength(0);
    expect(mocks.putObject).not.toHaveBeenCalled();
  });

  it('re-sends successfully when an MSA is pending but the envelope has not been posted yet (providerDocumentId IS NULL)', async () => {
    // Pre-load row=sent, dealer; MSA-pending lookup finds a row WITHOUT a
    // providerDocumentId (sendMsaEnvelope hasn\'t fired yet). Re-send is
    // allowed — there\'s no in-flight envelope for the dealer to be confused by.
    mocks.dbResults.push(
      [SENT_ROW],
      [DEALER_ROW],
      [{ status: 'pending', providerDocumentId: null }],
      [{ id: 42 }],
    );
    const result = await call(sendQuote(fd({ quoteId: '42' })));
    expect(result).toEqual({ ok: true });
    expect(mocks.renderQuotePdf).toHaveBeenCalledTimes(1);
  });

  it('first send (sentAt=null) does not run the MSA-pending in-flight check', async () => {
    // The MSA gate is gated on `sentAt != null` — first send must not pay
    // the cost. Pre-load=draft, dealer, then straight to recipient/render/UPDATE
    // (no MSA SELECT between dealer + recipient resolve).
    mocks.dbResults.push([DRAFT_ROW], [DEALER_ROW], [{ id: 42 }]);
    const result = await call(sendQuote(fd({ quoteId: '42' })));
    expect(result).toEqual({ ok: true });
  });

  it('re-sends when no MSA exists for the dealer (gate is a no-op)', async () => {
    // Pre-load row=sent, dealer; MSA SELECT returns []. Re-send proceeds.
    mocks.dbResults.push([SENT_ROW], [DEALER_ROW], [], [{ id: 42 }]);
    const result = await call(sendQuote(fd({ quoteId: '42' })));
    expect(result).toEqual({ ok: true });
  });

  it('is idempotent on the send-then-immediate-retry-with-same-updatedAt path (optimistic-lock collapses two concurrent re-sends)', async () => {
    // Two clicks pre-load the same updatedAt; the first wins, the second's
    // UPDATE misses on the (now-bumped) updatedAt predicate and re-select
    // confirms the row is `sent`. The second click returns ok:true without
    // a second PDF upload or audit row — exactly the concurrent-race
    // semantic from the previous test, but exercised from the re-send path.
    mocks.dbResults.push(
      [SENT_ROW],
      [DEALER_ROW],
      [], // MSA-pending lookup empty
      [], // UPDATE misses
      [{
        id: 42,
        status: 'sent',
        updatedAt: new Date('2026-05-12T13:00:05.000Z'),
        sentAt: new Date('2026-05-12T13:00:05.000Z'), // advanced past SENT_ROW.sentAt
      }],
    );
    const result = await call(sendQuote(fd({ quoteId: '42' })));
    expect(result).toEqual({ ok: true });
    expect(mocks.putObject).not.toHaveBeenCalled();
    expect(mocks.recordAudit).not.toHaveBeenCalled();
  });

  it('rejects when a concurrent edit changes updatedAt before the final UPDATE', async () => {
    mocks.dbResults.push(
      [DRAFT_ROW],
      [DEALER_ROW],
      [],
      [
        {
          id: 42,
          status: 'draft',
          updatedAt: new Date('2026-05-12T12:01:00.000Z'),
        },
      ],
    );
    const result = await call(sendQuote(fd({ quoteId: '42' })));
    expect(result).toEqual({ error: 'Quote was edited concurrently; please retry.' });
    expect(mocks.renderQuotePdf).toHaveBeenCalledTimes(1);
    expect(mocks.putObject).not.toHaveBeenCalled();
    expect(mocks.recordAudit).not.toHaveBeenCalled();
  });

  it('classifies UPDATE race against illegal-status (raced to declined) with the friendly terminal-status message', async () => {
    mocks.dbResults.push(
      [DRAFT_ROW],
      [DEALER_ROW],
      [],
      [{ id: 42, status: 'declined' }],
    );
    const result = await call(sendQuote(fd({ quoteId: '42' })));
    expect(result).toEqual({
      error: 'This quote has been declined — make a new quote to revise it.',
    });
  });

  it('rejects when GCS_BUCKET is unset (no render, no DB)', async () => {
    delete process.env.GCS_BUCKET;
    const result = await call(sendQuote(fd({ quoteId: '42' })));
    expect((result as { error: string }).error).toContain('GCS_BUCKET');
    expect(mocks.renderQuotePdf).not.toHaveBeenCalled();
  });

  it('rejects invalid quote id without any db round-trip', async () => {
    const result = await call(sendQuote(fd({})));
    expect(result).toEqual({ error: 'Invalid quote id.' });
    expect(mocks.updates).toHaveLength(0);
    expect(mocks.renderQuotePdf).not.toHaveBeenCalled();
  });

  // 0062: empty-quote guard — a picker quote with zero lines can't be sent.
  it('refuses to send an empty quote (no line items) before any side effect', async () => {
    mocks.dbResults.push([{ ...DRAFT_ROW, renderLines: [] }], [DEALER_ROW]);
    const result = await call(sendQuote(fd({ quoteId: '42' })));
    expect(result).toEqual({
      error: 'Add at least one line item before sending this quote.',
    });
    expect(mocks.renderQuotePdf).not.toHaveBeenCalled();
    expect(mocks.updates).toHaveLength(0);
    expect(mocks.putObject).not.toHaveBeenCalled();
  });

  // 0078: uploaded attachments ride alongside the quote PDF in the send.
  it('appends every uploaded attachment to the email (PDF + 2) and denorms them in the audit', async () => {
    mocks.dbResults.push([DRAFT_ROW], [DEALER_ROW], [{ id: 42 }]);
    mocks.attachmentResults.push([
      {
        filename: 'form.pdf',
        storageKey: 'quotes/42/attachments/a-form.pdf',
        contentType: 'application/pdf',
        byteSize: 1000,
      },
      {
        filename: 'banking.png',
        storageKey: 'quotes/42/attachments/b-banking.png',
        contentType: 'image/png',
        byteSize: 2000,
      },
    ]);

    const result = await call(sendQuote(fd({ quoteId: '42' })));
    expect(result).toEqual({ ok: true });

    const sendArg = mocks.sendEmail.mock.calls[0][0] as {
      attachments: Array<{ filename: string; contentType?: string }>;
    };
    expect(sendArg.attachments).toHaveLength(3); // quote PDF + 2 uploads
    expect(sendArg.attachments[0].contentType).toBe('application/pdf'); // the quote PDF
    expect(sendArg.attachments[1].filename).toBe('form.pdf');
    expect(sendArg.attachments[2].filename).toBe('banking.png');
    // Bytes fetched once per attachment, before the transition.
    expect(mocks.getObject).toHaveBeenCalledTimes(2);
    // Audit denorms what went out.
    expect(mocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'quote.sent',
        payload: expect.objectContaining({
          attachmentCount: 2,
          attachments: [
            { filename: 'form.pdf', byteSize: 1000 },
            { filename: 'banking.png', byteSize: 2000 },
          ],
        }),
      }),
    );
  });

  it('fails closed before the transition when the total payload is over the cap', async () => {
    mocks.dbResults.push([DRAFT_ROW], [DEALER_ROW]); // no UPDATE entry — must not reach it
    mocks.attachmentResults.push([
      {
        filename: 'huge.pdf',
        storageKey: 'quotes/42/attachments/huge.pdf',
        contentType: 'application/pdf',
        byteSize: MAX_TOTAL_ATTACHMENT_BYTES + 1,
      },
    ]);

    const result = await call(sendQuote(fd({ quoteId: '42' })));
    expect((result as { error: string }).error).toContain('exceeds');
    expect(mocks.updates).toHaveLength(0); // no status transition
    expect(mocks.getObject).not.toHaveBeenCalled(); // size guard precedes the byte fetch
    expect(mocks.putObject).not.toHaveBeenCalled();
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });
});

describe('declineQuote (staff-side)', () => {
  it('flips sent → declined and emits audit with source=staff', async () => {
    // markQuoteDeclined → guarded UPDATE returns one row.
    mocks.dbResults.push([{ id: 42 }]);
    const result = await call(declineQuote(fd({ quoteId: '42' })));
    expect(result).toEqual({ ok: true });
    expect((mocks.updates[0].patch as Record<string, unknown>).status).toBe('declined');
    expect((mocks.updates[0].patch as Record<string, unknown>).declinedAt).toBeInstanceOf(Date);
    expect(mocks.recordAudit).toHaveBeenCalledWith({
      action: 'quote.declined',
      targetTable: 'quotes',
      targetId: 42,
      payload: { source: 'staff' },
    });
  });

  it('is idempotent on already-declined — no audit emit', async () => {
    // Guarded UPDATE misses; re-select finds 'declined'.
    mocks.dbResults.push([], [{ id: 42, status: 'declined' }]);
    const result = await call(declineQuote(fd({ quoteId: '42' })));
    expect(result).toEqual({ ok: true });
    expect(mocks.recordAudit).not.toHaveBeenCalled();
  });

  it('rejects decline of a draft quote', async () => {
    mocks.dbResults.push([], [{ id: 42, status: 'draft' }]);
    const result = await call(declineQuote(fd({ quoteId: '42' })));
    expect(result).toEqual({ error: "Quote cannot be declined from status 'draft'." });
  });
});

// Pre-load shape for the markQuoteAccepted expiry guard. Use a sentAt that's
// well within the validity window so the guard passes; tests that exercise
// the expiry rejection path override sentAt + quoteValidDays.
const FRESH_SENT_PRELOAD = {
  status: 'sent',
  sentAt: new Date(),
  quoteValidDays: 30,
};

describe('acceptQuote (staff-side)', () => {
  it('flips sent → accepted, emits audit, and promotes a prospect dealer to active', async () => {
    // 1. markQuoteAccepted expiry pre-load (status='sent', within window).
    // 2. markQuoteAccepted UPDATE returns one row.
    // 3. SELECT quotes.dealerId.
    // 4. UPDATE dealers (prospect → active) returns one row.
    mocks.dbResults.push(
      [FRESH_SENT_PRELOAD],
      [{ id: 42 }],
      [{ dealerId: 7 }],
      [{ id: 7 }],
    );
    const result = await call(acceptQuote(fd({ quoteId: '42' })));
    expect(result).toEqual({ ok: true });

    // First UPDATE: the quote transition.
    expect((mocks.updates[0].patch as Record<string, unknown>).status).toBe('accepted');
    expect((mocks.updates[0].patch as Record<string, unknown>).acceptedAt).toBeInstanceOf(Date);
    // Second UPDATE: the dealer promotion.
    expect((mocks.updates[1].patch as Record<string, unknown>).status).toBe('active');

    expect(mocks.recordAudit).toHaveBeenCalledWith({
      action: 'quote.accepted',
      targetTable: 'quotes',
      targetId: 42,
      payload: { source: 'staff' },
    });
    expect(mocks.recordAudit).toHaveBeenCalledWith({
      action: 'dealer.activated',
      targetTable: 'dealers',
      targetId: 7,
      payload: { from: 'prospect', via: 'quote.accepted' },
    });
  });

  it('does not emit dealer.activated when the dealer is already active', async () => {
    // markQuoteAccepted expiry pre-load; UPDATE wins; SELECT dealerId;
    // UPDATE dealers misses (guard `status='prospect'` falsy on already-active).
    mocks.dbResults.push(
      [FRESH_SENT_PRELOAD],
      [{ id: 42 }],
      [{ dealerId: 7 }],
      [],
    );
    await call(acceptQuote(fd({ quoteId: '42' })));
    expect(mocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'quote.accepted' }),
    );
    expect(mocks.recordAudit).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: 'dealer.activated' }),
    );
  });

  it('is idempotent on already-accepted — no audit, no dealer promotion', async () => {
    // Pre-load finds 'accepted' (expiry guard skipped); UPDATE misses;
    // re-select finds 'accepted'.
    mocks.dbResults.push(
      [{ status: 'accepted', sentAt: null, quoteValidDays: 30 }],
      [],
      [{ status: 'accepted', sentAt: null, quoteValidDays: 30 }],
    );
    const result = await call(acceptQuote(fd({ quoteId: '42' })));
    expect(result).toEqual({ ok: true });
    expect(mocks.recordAudit).not.toHaveBeenCalled();
  });

  it('rejects accept of a draft quote', async () => {
    // Pre-load finds 'draft' (expiry guard skipped — only fires inside the
    // 'sent' branch per OQ #2); UPDATE misses; re-select finds 'draft'.
    mocks.dbResults.push(
      [{ status: 'draft', sentAt: null, quoteValidDays: 30 }],
      [],
      [{ status: 'draft', sentAt: null, quoteValidDays: 30 }],
    );
    const result = await call(acceptQuote(fd({ quoteId: '42' })));
    expect(result).toEqual({ error: "Quote cannot be accepted from status 'draft'." });
    expect(mocks.recordAudit).not.toHaveBeenCalled();
  });

  it('rejects invalid quote id without any db round-trip', async () => {
    const result = await call(acceptQuote(fd({})));
    expect(result).toEqual({ error: 'Invalid quote id.' });
    expect(mocks.updates).toHaveLength(0);
  });

  it('refuses acceptance when a sent quote has expired (default 30-day window)', async () => {
    // sent 31 days ago with the default quoteValidDays=30 → expired.
    const sentAt = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000);
    mocks.dbResults.push([{ status: 'sent', sentAt, quoteValidDays: 30 }]);
    const result = await call(acceptQuote(fd({ quoteId: '42' })));
    expect(result).toEqual({
      error: `This Quote has expired (valid for 30 days from send date — sent ${sentAt.toISOString().slice(0, 10)}). Re-issue a new Quote with current pricing.`,
    });
    // Guard fires before the UPDATE — no row flips, no audit emitted.
    expect(mocks.updates).toHaveLength(0);
    expect(mocks.recordAudit).not.toHaveBeenCalled();
  });

  it('allows acceptance on the last valid day (regression for the happy path under the new guard)', async () => {
    // sent 29 days ago with the default quoteValidDays=30 → still valid.
    const sentAt = new Date(Date.now() - 29 * 24 * 60 * 60 * 1000);
    mocks.dbResults.push(
      [{ status: 'sent', sentAt, quoteValidDays: 30 }],
      [{ id: 42 }],
      [{ dealerId: 7 }],
      [{ id: 7 }],
    );
    const result = await call(acceptQuote(fd({ quoteId: '42' })));
    expect(result).toEqual({ ok: true });
    expect((mocks.updates[0].patch as Record<string, unknown>).status).toBe('accepted');
    expect(mocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'quote.accepted' }),
    );
  });

  it('honors the per-row quoteValidDays override (7-day window expires after 8 days)', async () => {
    // sent 8 days ago with a per-row quoteValidDays=7 → expired even though
    // the default 30-day window would still allow it.
    const sentAt = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
    mocks.dbResults.push([{ status: 'sent', sentAt, quoteValidDays: 7 }]);
    const result = await call(acceptQuote(fd({ quoteId: '42' })));
    expect(result).toEqual({
      error: `This Quote has expired (valid for 7 days from send date — sent ${sentAt.toISOString().slice(0, 10)}). Re-issue a new Quote with current pricing.`,
    });
    expect(mocks.updates).toHaveLength(0);
  });

  it('returns the expired error via the Postgres-time guard when JS pre-load thought the quote was fresh (TOCTOU)', async () => {
    // Simulates the race: JS pre-load sees the row as "fresh" (e.g. clock
    // skew or a sub-second crossing of the expiry boundary), but the
    // Postgres-side time predicate in the UPDATE refuses. The reselect
    // path re-reads the row, sees it's now past its deadline, and returns
    // the friendly expired-error rather than a confused "cannot be
    // accepted from status 'sent'" fallthrough.
    const freshSentAt = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
    const expiredSentAt = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000);
    mocks.dbResults.push(
      [{ status: 'sent', sentAt: freshSentAt, quoteValidDays: 30 }], // JS pre-load: looks fresh
      [], // UPDATE miss — simulating the SQL guard rejecting
      [{ status: 'sent', sentAt: expiredSentAt, quoteValidDays: 30 }], // reselect: now-expired
    );
    const result = await call(acceptQuote(fd({ quoteId: '42' })));
    expect(result).toEqual({
      error: `This Quote has expired (valid for 30 days from send date — sent ${expiredSentAt.toISOString().slice(0, 10)}). Re-issue a new Quote with current pricing.`,
    });
    expect(mocks.recordAudit).not.toHaveBeenCalled();
  });
});

describe('markQuoteAccepted (internal helper)', () => {
  it('flips sent → accepted atomically and reports transitioned:true', async () => {
    // Expiry pre-load (within window) → UPDATE returns one row.
    mocks.dbResults.push([FRESH_SENT_PRELOAD], [{ id: 42 }]);
    const result = await markQuoteAccepted(42, 'public-uuid');
    expect(result).toEqual({ ok: true, transitioned: true });
    const patch = mocks.updates[0].patch as Record<string, unknown>;
    expect(patch.status).toBe('accepted');
    expect(patch.acceptedAt).toBeInstanceOf(Date);
    expect(patch.updatedById).toBe('public-uuid');
  });

  it('reports transitioned:false on already-accepted', async () => {
    // Pre-load finds 'accepted' (expiry guard skipped); UPDATE miss; reselect.
    mocks.dbResults.push(
      [{ status: 'accepted', sentAt: null, quoteValidDays: 30 }],
      [],
      [{ status: 'accepted', sentAt: null, quoteValidDays: 30 }],
    );
    const result = await markQuoteAccepted(42);
    expect(result).toEqual({ ok: true, transitioned: false });
  });

  it('rejects accept from a non-sent status', async () => {
    mocks.dbResults.push(
      [{ status: 'draft', sentAt: null, quoteValidDays: 30 }],
      [],
      [{ status: 'draft', sentAt: null, quoteValidDays: 30 }],
    );
    const result = await markQuoteAccepted(42);
    expect(result).toEqual({ error: "Quote cannot be accepted from status 'draft'." });
  });

  it('errors when the quote does not exist', async () => {
    // Pre-load empty (row gone) → UPDATE miss → reselect empty.
    mocks.dbResults.push([], [], []);
    const result = await markQuoteAccepted(999);
    expect(result).toEqual({ error: 'Quote not found.' });
  });

  it('omits updatedById when caller passes null (public route has no user)', async () => {
    mocks.dbResults.push([FRESH_SENT_PRELOAD], [{ id: 42 }]);
    await markQuoteAccepted(42, null);
    expect(mocks.updates[0].patch).not.toHaveProperty('updatedById');
  });
});

describe('markQuoteDeclined (internal helper)', () => {
  it('flips sent → declined atomically and reports transitioned:true', async () => {
    mocks.dbResults.push([{ id: 42 }]);
    const result = await markQuoteDeclined(42, 'public-uuid');
    expect(result).toEqual({ ok: true, transitioned: true });
    const patch = mocks.updates[0].patch as Record<string, unknown>;
    expect(patch.status).toBe('declined');
    expect(patch.declinedAt).toBeInstanceOf(Date);
  });

  it('reports transitioned:false on already-declined', async () => {
    mocks.dbResults.push([], [{ id: 42, status: 'declined' }]);
    const result = await markQuoteDeclined(42);
    expect(result).toEqual({ ok: true, transitioned: false });
  });

  it('rejects decline from a non-sent status', async () => {
    mocks.dbResults.push([], [{ id: 42, status: 'accepted' }]);
    const result = await markQuoteDeclined(42);
    expect(result).toEqual({ error: "Quote cannot be declined from status 'accepted'." });
  });
});

// Minimal service-items catalog used by the composer setters. Mirrors the
// shape that `loadActiveCatalog` returns in production.
const CATALOG_FIXTURE = [
  {
    id: 1,
    code: 'base-event',
    label: 'Base Event',
    unitPrice: '6900.00',
    description: null,
    sortOrder: 0,
  },
  {
    id: 2,
    code: 'additional-contact',
    label: 'Additional Contact',
    unitPrice: '3.00',
    description: null,
    sortOrder: 1,
  },
];

describe('setQuoteDealer', () => {
  it('flips dealer on a draft quote when the new dealer is active', async () => {
    // dealer active, quote pre-read (0065: re-derives tax for the new dealer),
    // guarded UPDATE.
    mocks.dbResults.push(
      [{ id: 9 }],
      [{ status: 'draft', subtotal: '1000', taxOverride: null }],
      [{ id: 42 }],
    );
    const result = await call(setQuoteDealer(fd({ quoteId: '42', dealerId: '9' })));
    expect(result).toEqual({ ok: true });
    expect((mocks.updates[0].patch as Record<string, unknown>).dealerId).toBe(9);
  });

  it('rejects when the new dealer is missing or archived', async () => {
    mocks.dbResults.push([]);
    const result = await call(setQuoteDealer(fd({ quoteId: '42', dealerId: '99' })));
    expect(result).toEqual({ error: 'Dealer not found or archived.' });
  });

  it('rejects edit on non-draft quote', async () => {
    // dealer ok; the 0065 quote pre-read finds status='sent' → early reject.
    mocks.dbResults.push([{ id: 9 }], [{ status: 'sent' }]);
    const result = await call(setQuoteDealer(fd({ quoteId: '42', dealerId: '9' })));
    expect(result).toEqual({ error: "Quote cannot be edited in status 'sent'." });
  });
});

// === 0062: SKU line-item picker write path ===============================
// Pre-load shape for the picker save path. applyPickerSave selects `inputs`
// (to merge quoteNotes) in addition to the priced-output snapshot.
const PICKER_PRELOAD = {
  status: 'draft',
  tax: '0.00',
  subtotal: '0.00',
  total: '0.00',
  renderLines: [],
  inputs: { audienceSize: 500, eventDays: 1, quoteNotes: '' },
  updatedAt: new Date('2026-05-12T12:00:00.000Z'),
};

describe('setQuoteInputs (0062 picker path)', () => {
  it('persists picked lines as quote_line_items rows + totals', async () => {
    // pre-load SELECT, catalog SELECT, UPDATE returns one row.
    mocks.dbResults.push([PICKER_PRELOAD], CATALOG_FIXTURE, [{ id: 42 }]);
    const result = await call(
      setQuoteInputs(
        fd({
          quoteId: '42',
          lines: JSON.stringify([
            { serviceItemId: 1, qty: 1, price: 6900 }, // base-event seed 6900 → no override
            { serviceItemId: 2, qty: 2, price: 5 }, // additional-contact seed 3 → override 5
          ]),
          tax: '0',
          quoteNotes: 'VIP setup',
        }),
      ),
    );
    expect(result).toEqual({ ok: true });

    // Relational rows: delete-then-insert into quote_line_items.
    expect(mocks.deletes).toEqual([{ table: 'quote_line_items' }]);
    expect(mocks.inserts).toHaveLength(1);
    expect(mocks.inserts[0].table).toBe('quote_line_items');
    const rows = mocks.inserts[0].values as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      quoteId: 42,
      serviceItemId: 1,
      code: 'base-event',
      qty: 1,
      unitPrice: '6900.00',
      overrideUnitPrice: null,
      lineTotal: '6900.00',
      displayOrder: 0,
    });
    expect(rows[1]).toMatchObject({
      serviceItemId: 2,
      code: 'additional-contact',
      qty: 2,
      unitPrice: '3.00',
      overrideUnitPrice: '5.00',
      lineTotal: '10.00',
      displayOrder: 1,
    });

    // quotes UPDATE: totals + merged quoteNotes (audienceSize preserved from
    // the pre-loaded inputs — the picker doesn't touch it). No more line_items
    // jsonb column — the rows above are the sole store.
    const patch = mocks.updates[0].patch as Record<string, unknown>;
    expect(patch.subtotal).toBe('6910.00');
    expect(patch.total).toBe('6910.00');
    expect((patch.inputs as Record<string, unknown>).quoteNotes).toBe('VIP setup');
    expect((patch.inputs as Record<string, unknown>).audienceSize).toBe(500);
    expect(patch.lineItems).toBeUndefined();
  });

  it('clears the rows and zeroes totals on an empty lines payload', async () => {
    mocks.dbResults.push(
      [{ ...PICKER_PRELOAD, subtotal: '6900.00', total: '6900.00' }],
      CATALOG_FIXTURE,
      [{ id: 42 }],
    );
    const result = await call(
      setQuoteInputs(fd({ quoteId: '42', lines: '[]' })),
    );
    expect(result).toEqual({ ok: true });
    // Delete fired; no insert (no lines to write).
    expect(mocks.deletes).toEqual([{ table: 'quote_line_items' }]);
    expect(mocks.inserts).toHaveLength(0);
    const patch = mocks.updates[0].patch as Record<string, unknown>;
    expect(patch.subtotal).toBe('0.00');
    expect(patch.total).toBe('0.00');
  });

  it('rejects a malformed lines payload before any db round-trip', async () => {
    const result = await call(
      setQuoteInputs(
        fd({ quoteId: '42', lines: JSON.stringify([{ serviceItemId: 1, qty: 0, price: 10 }]) }),
      ),
    );
    expect((result as { error: string }).error).toContain('quantity');
    expect(mocks.updates).toHaveLength(0);
    expect(mocks.deletes).toHaveLength(0);
  });

  it('rejects a line whose catalogue item no longer exists', async () => {
    mocks.dbResults.push([PICKER_PRELOAD], CATALOG_FIXTURE);
    const result = await call(
      setQuoteInputs(
        fd({ quoteId: '42', lines: JSON.stringify([{ serviceItemId: 999, qty: 1, price: 10 }]) }),
      ),
    );
    expect((result as { error: string }).error).toContain('catalogue');
    expect(mocks.updates).toHaveLength(0);
  });

  it('rejects the picker save on a terminal (accepted) quote', async () => {
    mocks.dbResults.push([{ ...PICKER_PRELOAD, status: 'accepted' }]);
    const result = await call(
      setQuoteInputs(fd({ quoteId: '42', lines: JSON.stringify([{ serviceItemId: 1, qty: 1, price: 6900 }]) })),
    );
    expect(result).toEqual({
      error: 'This quote has been accepted — make a new quote to revise it.',
    });
    expect(mocks.deletes).toHaveLength(0);
    expect(mocks.updates).toHaveLength(0);
  });
});

describe('createQuote (0062 picker path)', () => {
  it('persists a picked-line draft: quotes insert + quote_line_items insert', async () => {
    // catalog SELECT (before tx), dealer FOR-UPDATE SELECT, quotes insert id.
    mocks.dbResults.push(CATALOG_FIXTURE, [{ id: 7 }], [{ id: 99 }]);
    const result = await call(
      createQuote(
        fd({
          dealerId: '7',
          lines: JSON.stringify([{ serviceItemId: 1, qty: 1, price: 6900 }]),
          tax: '0',
          quoteNotes: 'VIP setup',
        }),
      ),
    );
    expect(result).toEqual({ ok: true, quoteId: 99 });
    expect(mocks.inserts).toHaveLength(2);
    expect(mocks.inserts[0].table).toBe('quotes');
    const quoteValues = mocks.inserts[0].values as Record<string, unknown>;
    expect(quoteValues.subtotal).toBe('6900.00');
    expect((quoteValues.inputs as Record<string, unknown>).quoteNotes).toBe('VIP setup');
    expect(quoteValues.lineItems).toBeUndefined();
    expect(mocks.inserts[1].table).toBe('quote_line_items');
    const rows = mocks.inserts[1].values as Array<Record<string, unknown>>;
    expect(rows[0]).toMatchObject({ quoteId: 99, code: 'base-event', displayOrder: 0 });
  });

  it('rejects a picked line for an unknown catalogue id (no insert)', async () => {
    mocks.dbResults.push(CATALOG_FIXTURE);
    const result = await call(
      createQuote(
        fd({ dealerId: '7', lines: JSON.stringify([{ serviceItemId: 999, qty: 1, price: 10 }]) }),
      ),
    );
    expect((result as { error: string }).error).toContain('catalogue');
    expect(mocks.inserts).toHaveLength(0);
  });
});

// 0078 — quote attachments. Build a FormData carrying a real File so the action
// exercises the same `formData.get('file') instanceof File` path the dialog hits.
function uploadFd(
  quoteId: string,
  file: { name: string; type: string; bytes: number },
): FormData {
  const f = new FormData();
  f.set('quoteId', quoteId);
  f.set('file', new File([new Uint8Array(file.bytes)], file.name, { type: file.type }));
  return f;
}

describe('uploadQuoteAttachment', () => {
  it('stores the file in GCS + inserts a row + emits audit', async () => {
    mocks.dbResults = [
      [{ status: 'draft' }], // quote status lookup (quotes)
      [
        {
          id: 5,
          filename: 'Banking Info.pdf',
          contentType: 'application/pdf',
          byteSize: 1234,
        },
      ], // insert ... returning
    ];
    mocks.attachmentResults = [[]]; // existing attachments (none)

    const result = await call(
      uploadQuoteAttachment(
        uploadFd('7', { name: 'Banking Info.pdf', type: 'application/pdf', bytes: 1234 }),
      ),
    );

    expect(result).toMatchObject({ ok: true, attachment: { id: 5 } });
    // GCS key is uuid-prefixed under the quote's attachments path; the display
    // name's space is sanitized to `_` in the key (kept as-is in the row).
    expect(mocks.putObject).toHaveBeenCalledWith(
      expect.objectContaining({
        bucket: 'test-bucket',
        contentType: 'application/pdf',
        key: expect.stringMatching(/^quotes\/7\/attachments\/[0-9a-f-]+-Banking_Info\.pdf$/),
      }),
    );
    expect(mocks.inserts).toHaveLength(1);
    expect(mocks.inserts[0].table).toBe('quote_attachments');
    expect(mocks.inserts[0].values).toMatchObject({
      quoteId: 7,
      filename: 'Banking Info.pdf',
      contentType: 'application/pdf',
      byteSize: 1234,
      displayOrder: 1,
    });
    expect(mocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'quote.attachment_added', targetId: 7 }),
    );
  });

  it('rejects an unsupported file type before any side effect', async () => {
    const result = await call(
      uploadQuoteAttachment(
        uploadFd('7', { name: 'notes.txt', type: 'text/plain', bytes: 10 }),
      ),
    );
    expect((result as { error: string }).error).toContain('Unsupported file type');
    expect(mocks.putObject).not.toHaveBeenCalled();
    expect(mocks.inserts).toHaveLength(0);
  });

  it('fails closed when the running total would exceed the payload cap', async () => {
    mocks.dbResults = [[{ status: 'draft' }]];
    mocks.attachmentResults = [
      [{ byteSize: MAX_TOTAL_ATTACHMENT_BYTES, displayOrder: 1 }], // already at the cap
    ];
    const result = await call(
      uploadQuoteAttachment(
        uploadFd('7', { name: 'extra.pdf', type: 'application/pdf', bytes: 100 }),
      ),
    );
    expect((result as { error: string }).error).toContain('exceed');
    expect(mocks.putObject).not.toHaveBeenCalled();
    expect(mocks.inserts).toHaveLength(0);
  });

  it('refuses to attach to a terminal (accepted) quote', async () => {
    mocks.dbResults = [[{ status: 'accepted' }]];
    const result = await call(
      uploadQuoteAttachment(
        uploadFd('7', { name: 'late.pdf', type: 'application/pdf', bytes: 100 }),
      ),
    );
    expect((result as { error: string }).error).toContain('accepted');
    expect(mocks.putObject).not.toHaveBeenCalled();
    expect(mocks.inserts).toHaveLength(0);
  });
});

describe('removeQuoteAttachment', () => {
  it('deletes the row, best-effort deletes the object, emits audit', async () => {
    mocks.dbResults = [
      [{ status: 'draft' }], // terminal-status guard
      [
        {
          id: 5,
          storageKey: 'quotes/7/attachments/uuid-file.pdf',
          filename: 'file.pdf',
        },
      ], // delete ... returning
    ];

    const f = new FormData();
    f.set('quoteId', '7');
    f.set('attachmentId', '5');
    const result = await call(removeQuoteAttachment(f));

    expect(result).toEqual({ ok: true, attachmentId: 5 });
    expect(mocks.deletes).toContainEqual({ table: 'quote_attachments' });
    expect(mocks.deleteObject).toHaveBeenCalledWith(
      'test-bucket',
      'quotes/7/attachments/uuid-file.pdf',
    );
    expect(mocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'quote.attachment_removed', targetId: 7 }),
    );
  });

  it('returns an error when the attachment is not found (no audit)', async () => {
    mocks.dbResults = [[{ status: 'draft' }], []]; // status ok, delete matched nothing
    const f = new FormData();
    f.set('quoteId', '7');
    f.set('attachmentId', '999');
    const result = await call(removeQuoteAttachment(f));
    expect((result as { error: string }).error).toContain('not found');
    expect(mocks.deleteObject).not.toHaveBeenCalled();
    expect(mocks.recordAudit).not.toHaveBeenCalled();
  });

  it('refuses to remove an attachment from a terminal (accepted) quote', async () => {
    mocks.dbResults = [[{ status: 'accepted' }]];
    const f = new FormData();
    f.set('quoteId', '7');
    f.set('attachmentId', '5');
    const result = await call(removeQuoteAttachment(f));
    expect((result as { error: string }).error).toContain('accepted');
    expect(mocks.deletes).toHaveLength(0);
    expect(mocks.deleteObject).not.toHaveBeenCalled();
    expect(mocks.recordAudit).not.toHaveBeenCalled();
  });
});
