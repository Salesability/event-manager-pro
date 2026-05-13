import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  assertCan: vi.fn(),
  getUser: vi.fn(),
  loadCurrentMembership: vi.fn(),
  recordAudit: vi.fn(),
  renderQuotePdf: vi.fn(),
  putObject: vi.fn(),
  resolveQuoteRecipient: vi.fn(),
  sendEmail: vi.fn(),
  quoteEmail: vi.fn(),
  // Queue consumed by both `.returning()` calls and `.then()` / `.limit()`
  // terminals on the predicate-blind db mock. Push one entry per DB round-trip
  // in the order the code under test will issue them.
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
vi.mock('@/features/audit/actions', () => ({
  recordAudit: mocks.recordAudit,
}));
vi.mock('@/lib/pdf/render-quote', () => ({
  renderQuotePdf: mocks.renderQuotePdf,
}));
vi.mock('@/lib/storage/gcs', () => ({
  putObject: mocks.putObject,
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
  sendQuote,
  setQuoteDealer,
  setQuoteInputs,
  setQuoteTax,
} from './actions';
import { MAX_ADDRESS_LINES } from './constants';
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
  mocks.resolveQuoteRecipient.mockResolvedValue({
    ok: true,
    recipient: { email: 'buyer@dealer.test', firstName: 'Pat' },
  });
  mocks.quoteEmail.mockResolvedValue({
    subject: 'Your Salesability Quote — Quote #42',
    text: 'Plain text body',
    html: '<p>HTML body</p>',
  });
  mocks.sendEmail.mockResolvedValue({ ok: true, id: 'resend-msg-id' });
  mocks.dbResults = [];
  mocks.inserts = [];
  mocks.updates = [];
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
const DRAFT_ROW = {
  id: 42,
  status: 'draft',
  dealerId: 7,
  updatedAt: new Date('2026-05-12T12:00:00.000Z'),
  acceptToken: '11111111-2222-3333-4444-555555555555',
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
    expect(quoteData.quoteNumber).toBe('42');
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
      payload: { pdfStorageKey: 'quotes/42/1.pdf', emailId: 'resend-msg-id' },
    });
    expect(mocks.sendEmail).toHaveBeenCalledTimes(1);
    const sendArg = mocks.sendEmail.mock.calls[0][0] as Record<string, unknown>;
    expect(sendArg.to).toBe('buyer@dealer.test');
    expect(sendArg.subject).toBe('Your Salesability Quote — Quote #42');
    expect(sendArg.html).toBe('<p>HTML body</p>');
    const attachments = sendArg.attachments as Array<Record<string, unknown>>;
    expect(attachments[0].filename).toBe('quote-42.pdf');
    expect(attachments[0].contentType).toBe('application/pdf');

    // Email template received the recipient name + quote summary; no
    // accept/decline URLs in v1 (the coach flips the status via the staff
    // surface after the customer phones or replies).
    expect(mocks.quoteEmail).toHaveBeenCalledTimes(1);
    const tplArg = mocks.quoteEmail.mock.calls[0][0] as Record<string, unknown>;
    expect(tplArg.firstName).toBe('Pat');
    expect(tplArg.quoteNumber).toBe('42');
    expect(tplArg).not.toHaveProperty('acceptUrl');
    expect(tplArg).not.toHaveProperty('declineUrl');
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

  it('is idempotent on already-sent (pre-load finds status=sent, no render)', async () => {
    mocks.dbResults.push([{ ...DRAFT_ROW, status: 'sent' }]);
    const result = await call(sendQuote(fd({ quoteId: '42' })));
    expect(result).toEqual({ ok: true });
    expect(mocks.renderQuotePdf).not.toHaveBeenCalled();
    expect(mocks.putObject).not.toHaveBeenCalled();
    expect(mocks.updates).toHaveLength(0);
    expect(mocks.recordAudit).not.toHaveBeenCalled();
  });

  it('rejects send from accepted or declined (illegal source status, no render)', async () => {
    mocks.dbResults.push([{ ...DRAFT_ROW, status: 'accepted' }]);
    const result = await call(sendQuote(fd({ quoteId: '42' })));
    expect(result).toEqual({ error: "Quote cannot be sent from status 'accepted'." });
    expect(mocks.renderQuotePdf).not.toHaveBeenCalled();
    expect(mocks.putObject).not.toHaveBeenCalled();
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
    // re-select finds the row in 'sent'. Mimics a concurrent send winning
    // the race after our pre-load saw it as draft.
    mocks.dbResults.push(
      [DRAFT_ROW],
      [DEALER_ROW],
      [],
      [{ id: 42, status: 'sent' }],
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

  it('classifies UPDATE race against illegal-status (raced to declined)', async () => {
    mocks.dbResults.push(
      [DRAFT_ROW],
      [DEALER_ROW],
      [],
      [{ id: 42, status: 'declined' }],
    );
    const result = await call(sendQuote(fd({ quoteId: '42' })));
    expect(result).toEqual({ error: "Quote cannot be sent from status 'declined'." });
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
      [{ id: 42, status: 'accepted' }],
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
      [{ id: 42, status: 'draft' }],
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
      [{ id: 42, status: 'accepted' }],
    );
    const result = await markQuoteAccepted(42);
    expect(result).toEqual({ ok: true, transitioned: false });
  });

  it('rejects accept from a non-sent status', async () => {
    mocks.dbResults.push(
      [{ status: 'draft', sentAt: null, quoteValidDays: 30 }],
      [],
      [{ id: 42, status: 'draft' }],
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
    unit: 'flat',
    unitPrice: '6900.00',
    unitPriceMin: null,
    unitPriceMax: null,
    description: null,
    sortOrder: 0,
  },
  {
    id: 2,
    code: 'additional-contact',
    label: 'Additional Contact',
    unit: 'per-record',
    unitPrice: '3.00',
    unitPriceMin: null,
    unitPriceMax: null,
    description: null,
    sortOrder: 1,
  },
];

describe('createQuote (composer Save-Draft path)', () => {
  it('persists inputs + computed lines + totals when `inputs` is submitted', async () => {
    // db round-trips: catalog SELECT (loadActiveCatalog before tx), then
    // inside transaction: dealer FOR-UPDATE SELECT, then insert returns id.
    mocks.dbResults.push(CATALOG_FIXTURE, [{ id: 7 }], [{ id: 99 }]);
    const result = await call(
      createQuote(
        fd({
          dealerId: '7',
          inputs: JSON.stringify({ audienceSize: 700, eventDays: 1 }),
          tax: '50',
        }),
      ),
    );
    expect(result).toEqual({ ok: true, quoteId: 99 });
    const insert = mocks.inserts[0].values as Record<string, unknown>;
    expect(insert.inputs).toMatchObject({ audienceSize: 700, eventDays: 1 });
    // base 6900 + 200 × 3 = 7500 subtotal, + 50 tax = 7550 total.
    expect(insert.subtotal).toBe('7500.00');
    expect(insert.tax).toBe('50.00');
    expect(insert.total).toBe('7550.00');
    expect(Array.isArray(insert.lineItems)).toBe(true);
  });

  it('rejects bad JSON in inputs payload', async () => {
    const result = await call(
      createQuote(fd({ dealerId: '7', inputs: 'not-json' })),
    );
    expect(result).toEqual({ error: 'Quote inputs payload is not valid JSON.' });
    expect(mocks.inserts).toHaveLength(0);
  });

  it('rejects inputs failing validation (negative count)', async () => {
    mocks.dbResults.push(CATALOG_FIXTURE);
    const result = await call(
      createQuote(
        fd({
          dealerId: '7',
          inputs: JSON.stringify({ bdcCallCount: -1 }),
        }),
      ),
    );
    expect((result as { error: string }).error).toContain('bdcCallCount');
    expect(mocks.inserts).toHaveLength(0);
  });

  it('discards unknown JSON keys instead of persisting them', async () => {
    mocks.dbResults.push(CATALOG_FIXTURE, [{ id: 7 }], [{ id: 99 }]);
    await call(
      createQuote(
        fd({
          dealerId: '7',
          inputs: JSON.stringify({
            audienceSize: 500,
            __proto__: { polluted: true },
            constructor: { prototype: { x: 1 } },
            blob: 'garbage',
          }),
        }),
      ),
    );
    const insert = mocks.inserts[0].values as Record<string, unknown>;
    const persistedInputs = insert.inputs as Record<string, unknown>;
    expect(persistedInputs).not.toHaveProperty('blob');
    expect(persistedInputs).not.toHaveProperty('constructor');
    // Canonical fields are present.
    expect(persistedInputs.audienceSize).toBe(500);
    expect(persistedInputs.eventDays).toBe(1);
  });

  // 0045 Phase 2 — schema-as-contract: action surfaces `fieldErrors` alongside
  // `error` so a future composer caller can route per-field via `setError`.
  it('surfaces per-field errors on safeParse failure', async () => {
    mocks.dbResults.push(CATALOG_FIXTURE);
    const result = (await call(
      createQuote(
        fd({
          dealerId: '7',
          inputs: JSON.stringify({ audienceSize: -1, eventDays: 0 }),
        }),
      ),
    )) as { error: string; fieldErrors?: Record<string, string[]> };
    expect(result.error).toContain('audienceSize');
    expect(result.fieldErrors?.audienceSize?.length).toBeGreaterThan(0);
    expect(mocks.inserts).toHaveLength(0);
  });
});

describe('setQuoteInputs', () => {
  it('updates inputs + recomputes lines/totals on a draft quote', async () => {
    // status SELECT, catalog SELECT, then UPDATE.returning() returns one row.
    mocks.dbResults.push(
      [{ status: 'draft', tax: '0' }],
      CATALOG_FIXTURE,
      [{ id: 42 }],
    );
    const result = await call(
      setQuoteInputs(
        fd({
          quoteId: '42',
          inputs: JSON.stringify({ audienceSize: 600, eventDays: 1 }),
        }),
      ),
    );
    expect(result).toEqual({ ok: true });
    const patch = mocks.updates[0].patch as Record<string, unknown>;
    expect(patch.inputs).toMatchObject({ audienceSize: 600 });
    // base 6900 + 100 × 3 = 7200; tax preserved at 0.
    expect(patch.subtotal).toBe('7200.00');
    expect(patch.total).toBe('7200.00');
  });

  it('rejects when concurrent send races past the read-then-write window', async () => {
    // status SELECT returns draft, catalog SELECT, UPDATE.returning() returns
    // [] (concurrent transition between our SELECT and UPDATE), then
    // re-classify SELECT finds the row now in `sent`.
    mocks.dbResults.push(
      [{ status: 'draft', tax: '0' }],
      CATALOG_FIXTURE,
      [],
      [{ status: 'sent' }],
    );
    const result = await call(
      setQuoteInputs(fd({ quoteId: '42', inputs: JSON.stringify({ audienceSize: 500 }) })),
    );
    expect(result).toEqual({ error: "Quote cannot be edited in status 'sent'." });
  });

  it('rejects edit on a sent quote', async () => {
    mocks.dbResults.push([{ status: 'sent', tax: '0' }]);
    const result = await call(
      setQuoteInputs(
        fd({ quoteId: '42', inputs: JSON.stringify({ audienceSize: 600 }) }),
      ),
    );
    expect(result).toEqual({ error: "Quote cannot be edited in status 'sent'." });
    expect(mocks.updates).toHaveLength(0);
  });

  it('rejects when the quote is gone', async () => {
    mocks.dbResults.push([]);
    const result = await call(
      setQuoteInputs(fd({ quoteId: '42', inputs: JSON.stringify({}) })),
    );
    expect(result).toEqual({ error: 'Quote not found.' });
  });

  it('rejects invalid id without a db round-trip', async () => {
    const result = await call(setQuoteInputs(fd({ inputs: '{}' })));
    expect(result).toEqual({ error: 'Invalid quote id.' });
  });
});

describe('setQuoteTax', () => {
  it('overrides tax and recomputes total = subtotal + tax', async () => {
    // status SELECT, then UPDATE.returning() returns one row.
    mocks.dbResults.push([{ status: 'draft', subtotal: '7500.00' }], [{ id: 42 }]);
    const result = await call(setQuoteTax(fd({ quoteId: '42', tax: '1125' })));
    expect(result).toEqual({ ok: true });
    const patch = mocks.updates[0].patch as Record<string, unknown>;
    expect(patch.tax).toBe('1125.00');
    expect(patch.total).toBe('8625.00');
  });

  it('rejects negative tax', async () => {
    const result = await call(setQuoteTax(fd({ quoteId: '42', tax: '-5' })));
    expect((result as { error: string }).error).toMatch(/non-negative/);
  });

  it('rejects tax with more than 2 decimal places (no IEEE-754 drift between paths)', async () => {
    const result = await call(setQuoteTax(fd({ quoteId: '42', tax: '2.675' })));
    expect((result as { error: string }).error).toContain('2 decimal places');
  });

  it('rejects tax above the dollar cap (matches pricing module)', async () => {
    const result = await call(setQuoteTax(fd({ quoteId: '42', tax: '999999999999' })));
    expect((result as { error: string }).error).toContain('Tax must be ≤');
  });

  it('rejects edit on non-draft quote', async () => {
    mocks.dbResults.push([{ status: 'accepted', subtotal: '7500.00' }]);
    const result = await call(setQuoteTax(fd({ quoteId: '42', tax: '100' })));
    expect(result).toEqual({ error: "Quote cannot be edited in status 'accepted'." });
  });

  it('rejects when concurrent send races past the read-then-write window', async () => {
    mocks.dbResults.push(
      [{ status: 'draft', subtotal: '7500.00' }],
      [],
      [{ status: 'sent' }],
    );
    const result = await call(setQuoteTax(fd({ quoteId: '42', tax: '100' })));
    expect(result).toEqual({ error: "Quote cannot be edited in status 'sent'." });
  });
});

describe('setQuoteDealer', () => {
  it('flips dealer on a draft quote when the new dealer is active', async () => {
    mocks.dbResults.push([{ id: 9 }], [{ id: 42 }]);
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
    // dealer ok, guarded UPDATE misses, re-select finds status='sent'.
    mocks.dbResults.push([{ id: 9 }], [], [{ status: 'sent' }]);
    const result = await call(setQuoteDealer(fd({ quoteId: '42', dealerId: '9' })));
    expect(result).toEqual({ error: "Quote cannot be edited in status 'sent'." });
  });
});
