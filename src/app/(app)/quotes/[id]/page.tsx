import Link from 'next/link';
import { notFound } from 'next/navigation';
import { assertCan } from '@/lib/auth/assert-can';
import { Button } from '@/components/catalyst/button';
import { RelativeTime } from '@/components/app/relative-time';
import { Section } from '@/components/app/section';
import { QuoteStatusBadge } from '@/components/app/status-badge';
import { loadQuote, loadQuoteAttachments, loadQuoteSendHistory } from '@/features/quotes/queries';
import { loadActiveOrPendingMsa } from '@/features/msa/queries';
import { deriveQuoteMsaState } from '@/features/msa/send-state';
import { displayStatusKey } from '@/features/quotes/status-display';
import { quoteDisplayName } from '@/features/quotes/display-name';
import { resolveQuoteRecipient } from '@/features/quotes/recipient';
import { loadDealers } from '@/features/schedule/queries';
import { loadServiceItems } from '@/features/services/queries';
import { loadTaxRates } from '@/features/tax-rates/queries';
import { QuoteComposer, type Recipient } from '@/features/quotes/quote-composer';
import { QuoteStatusActions } from '@/features/quotes/quote-status-actions';
import { can } from '@/lib/auth/capabilities';
import { loadCurrentMembership } from '@/lib/auth/load-team-membership';
import { getConnection } from '@/lib/quickbooks/connection';
import { pushQuoteToQuickbooks } from '@/features/quickbooks/actions';
import { signedUrl } from '@/lib/storage/gcs';

// Edit-mode quote page. Mirrors `/quotes/new` but hydrates the composer from
// an existing row. Saving routes through `setQuoteInputs` (per-row atomic
// guarded UPDATE; terminal statuses reject server-side). 0046 made sent
// rows editable + Re-send-able; only `accepted`/`declined` lock the
// composer, and the Send-history section below the header lists every
// `quote.sent` audit row most-recent first.

const SENT_PDF_SIGNED_URL_TTL_SECONDS = 5 * 60;

function readEmailId(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const e = (payload as { emailId?: unknown }).emailId;
  return typeof e === 'string' ? e : null;
}

// Send-history rows carry recipient denorm in payload as of 0046 so multi-row
// reads show the recipient *at the time of each send*, not the current denorm.
// Pre-0046 rows fall back to the row-level denorm via the callsite.
function readRecipient(payload: unknown): { email: string | null; firstName: string | null } {
  if (!payload || typeof payload !== 'object') return { email: null, firstName: null };
  const p = payload as { sentToEmail?: unknown; sentToFirstName?: unknown };
  return {
    email: typeof p.sentToEmail === 'string' ? p.sentToEmail : null,
    firstName: typeof p.sentToFirstName === 'string' ? p.sentToFirstName : null,
  };
}

function recipientLabel(firstName: string | null, email: string | null): string {
  if (!email && !firstName) {
    return 'Sent to (recipient unknown — sent before recipient denorm shipped)';
  }
  const name = firstName ?? '';
  const addr = email ? `<${email}>` : '';
  const space = name && email ? ' ' : '';
  return `Sent to ${name}${space}${addr}`.trim();
}

export default async function QuoteEditPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await assertCan('quote:edit'); // expected: server-only — admin || coach
  const { id: idParam } = await params;
  const id = parsePositiveIntPathSegment(idParam);
  if (id == null) notFound();

  const quote = await loadQuote(id);
  if (!quote) notFound();

  // QBO Estimate push is admin-only (0073) — the page itself admits coaches, so
  // gate the button on a fresh `admin:access` check. `loadCurrentMembership` is
  // request-cached, so this shares the round-trip with `assertCan` above.
  const membership = await loadCurrentMembership();
  const isQbAdmin = can(
    { user, roles: membership?.roles ?? [], coachContactId: membership?.coachContactId ?? null },
    'admin:access',
  );

  // Flash from the push action: ?qbpush=created|updated (success) / ?qberror=… .
  const sp = await searchParams;
  const qbNotice =
    sp.qbpush === 'created'
      ? { kind: 'success' as const, msg: 'Created this quote as a QuickBooks Estimate.' }
      : sp.qbpush === 'updated'
        ? { kind: 'success' as const, msg: "Pushed this quote to its QuickBooks Estimate." }
        : typeof sp.qberror === 'string'
          ? { kind: 'error' as const, msg: sp.qberror }
          : null;

  const [dealers, catalog, taxRates, recipientResult, sendHistory, msa, qbConnection, attachments] =
    await Promise.all([
      loadDealers(),
      loadServiceItems(),
      loadTaxRates(),
      resolveQuoteRecipient(quote.dealerId),
      loadQuoteSendHistory(quote.id),
    // 0046 Phase 5: when the dealer\'s MSA envelope is with BoldSign awaiting
    // signature, the server-side `sendQuote` action refuses re-send. The
    // composer mirrors this state so the button reads as disabled rather
      // than firing then surfacing the server-side error.
      loadActiveOrPendingMsa(quote.dealerId),
      getConnection(),
      // 0078: uploaded attachments seed the send dialog's Documents list.
      loadQuoteAttachments(quote.id),
    ]);
  // 0082: the MSA send action moved to the dealer page; the composer keeps only
  // an informational MSA-active indicator, and the accept gate (D3) reads the
  // same active flag. Derived in one tested helper so the lifecycle rules aren't
  // re-encoded in the page.
  const sendState = deriveQuoteMsaState(msa);
  const msaState = {
    active: sendState.active,
    expiresAt: sendState.expiresAt,
  };
  const recipient: Recipient =
    'ok' in recipientResult ? recipientResult.recipient : { error: recipientResult.error };

  // PDF storage key overwrites on every send (per 0046 Decision), so only
  // the most-recent send row gets a Download link — older receipts point at
  // the same (now-overwritten) object. Recipients keep their own emailed
  // PDFs in their inbox; the staff portal's current-truth is the latest.
  let sentPdfDownloadUrl: string | null = null;
  if (quote.status !== 'draft' && quote.pdfStorageKey) {
    const bucket = process.env.GCS_BUCKET;
    if (bucket) {
      const signed = await signedUrl(bucket, quote.pdfStorageKey, SENT_PDF_SIGNED_URL_TTL_SECONDS);
      if ('ok' in signed) sentPdfDownloadUrl = signed.url;
    }
  }

  const pillKey = displayStatusKey(quote);
  const totalMoney = fmtMoney(quote.total);
  const validUntilDate =
    quote.sentAt != null ? isoDateOffset(quote.sentAt, quote.quoteValidDays) : null;
  const sendHistoryNode =
    quote.status !== 'draft' && sendHistory.length > 0 ? (
      <Section title="Send history" variant="card">
        <ul className="flex flex-col gap-3">
          {sendHistory.map((row, idx) => {
            const emailId = readEmailId(row.payload);
            const isMostRecent = idx === 0;
            // Prefer the per-send recipient denorm from the audit payload
            // (added 0046); fall back to the row-level denorm for pre-0046
            // sends that don't carry the field.
            const perRow = readRecipient(row.payload);
            const recipientFirstName = perRow.firstName ?? quote.sentToFirstName;
            const recipientEmail = perRow.email ?? quote.sentToEmail;
            return (
              <li
                key={`${row.occurredAt.toISOString()}-${idx}`}
                className="flex flex-col gap-1 rounded-lg border border-zinc-200 bg-white p-3 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4"
              >
                <div className="flex flex-col gap-0.5">
                  <span className="text-zinc-900">
                    <RelativeTime value={row.occurredAt} />
                    {isMostRecent ? (
                      <span className="ml-2 rounded-full bg-zinc-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-900">
                        Latest
                      </span>
                    ) : null}
                  </span>
                  <span className="text-xs text-zinc-500">
                    {recipientLabel(recipientFirstName, recipientEmail)}
                  </span>
                  {emailId && (
                    <span className="font-mono text-[11px] text-zinc-500">
                      Resend ID: {emailId}
                    </span>
                  )}
                </div>
                {isMostRecent && sentPdfDownloadUrl ? (
                  <a
                    href={sentPdfDownloadUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-brand-700 underline hover:no-underline"
                  >
                    Download PDF
                  </a>
                ) : null}
              </li>
            );
          })}
        </ul>
      </Section>
    ) : null;

  return (
    <div className="flex flex-col gap-6">
      <Link
        href="/quotes"
        className="text-xs font-medium text-zinc-500 transition hover:text-zinc-900"
      >
        ← Quotes
      </Link>

      {qbNotice && (
        <p
          className={
            qbNotice.kind === 'error'
              ? 'rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800'
              : 'rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800'
          }
        >
          {qbNotice.msg}
        </p>
      )}

      {quote.status === 'sent' && (
        <Section title="Customer decision" variant="card">
          <QuoteStatusActions
            quoteId={quote.id}
            status={quote.status}
            hasActiveMsa={sendState.active}
            isExpired={quote.isExpired}
          />
        </Section>
      )}

      <QuoteComposer
        dealers={dealers}
        taxRates={taxRates}
        catalog={catalog}
        initialDealerId={quote.dealerId}
        initialCampaignId={null}
        initial={{
          quoteId: quote.id,
          dealerId: quote.dealerId,
          dealerName: quote.dealerName,
          quoteNotes: quote.inputs.quoteNotes ?? '',
          pickedLines: quote.pickedLines,
          subtotal: Number(quote.subtotal) || 0,
          tax: Number(quote.tax) || 0,
          total: Number(quote.total) || 0,
          status: quote.status,
          isExpired: quote.isExpired,
          sentAt: quote.sentAt,
          quoteValidDays: quote.quoteValidDays,
        }}
        recipient={recipient}
        msaState={msaState}
        pageTitle={quoteDisplayName(quote.createdAt)}
        pageStatusBadge={<QuoteStatusBadge status={pillKey} />}
        keyValueItems={[
          { label: 'Status', value: <QuoteStatusBadge status={pillKey} /> },
          ...(validUntilDate
            ? [{ label: 'Valid until', value: validUntilDate }]
            : []),
          {
            label: 'Dealer',
            value: `${quote.dealerName}${quote.dealerArchivedAt ? ' (archived)' : ''}`,
          },
          { label: 'Line items', value: String(quote.pickedLines.length) },
          { label: 'Total', value: totalMoney },
        ]}
        sendHistorySlot={sendHistoryNode}
        initialAttachments={attachments}
      />

      {qbConnection && isQbAdmin && (
        <Section title="QuickBooks" variant="card">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-zinc-500">
              {quote.quickbooksEstimateId ? (
                <>
                  Pushed to QuickBooks Estimate{' '}
                  <code className="font-mono text-zinc-700">#{quote.quickbooksEstimateId}</code> —
                  pushing again updates it.
                </>
              ) : (
                <>
                  Not in QuickBooks yet. Pushing creates an Estimate (the dealer and every line
                  item must be linked to QuickBooks first).
                </>
              )}
            </p>
            <form action={pushQuoteToQuickbooks}>
              <input type="hidden" name="quoteId" value={quote.id} />
              <Button outline compact type="submit">
                Push to QuickBooks
              </Button>
            </form>
          </div>
        </Section>
      )}
    </div>
  );
}

// Strict decimal-only path-segment validator. Rejects `1e10`, `0x10`,
// `1.0`, `-1`, `0`, leading-`+`, and non-digit input — the dynamic-route
// `params.id` should be a plain canonical integer. Capped at
// `Number.MAX_SAFE_INTEGER` since the underlying column is `bigint`.
function parsePositiveIntPathSegment(v: string): number | null {
  if (!/^\d+$/.test(v)) return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0 || n > Number.MAX_SAFE_INTEGER) return null;
  return n;
}

function fmtMoney(amount: string): string {
  const n = Number(amount);
  if (!Number.isFinite(n)) return amount;
  return n.toLocaleString('en-CA', { style: 'currency', currency: 'CAD' });
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function isoDateOffset(base: Date, days: number): string {
  return new Date(base.getTime() + days * MS_PER_DAY).toISOString().slice(0, 10);
}
