import Link from 'next/link';
import { notFound } from 'next/navigation';
import { assertCan } from '@/lib/auth/assert-can';
import { RelativeTime } from '@/components/app/relative-time';
import { Section } from '@/components/app/section';
import { QuoteStatusBadge } from '@/components/app/status-badge';
import { loadQuote, loadQuoteSendHistory } from '@/features/quotes/queries';
import { loadActiveOrPendingMsa } from '@/features/msa/queries';
import { deriveQuoteMsaState } from '@/features/msa/send-state';
import { displayStatusKey } from '@/features/quotes/status-display';
import { quoteDisplayName } from '@/features/quotes/display-name';
import { resolveQuoteRecipient } from '@/features/quotes/recipient';
import { loadDealers } from '@/features/schedule/queries';
import { loadServiceItems } from '@/features/services/queries';
import { QuoteComposer, type Recipient } from '@/features/quotes/quote-composer';
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
}: {
  params: Promise<{ id: string }>;
}) {
  await assertCan('quote:edit'); // expected: server-only — admin || coach
  const { id: idParam } = await params;
  const id = parsePositiveIntPathSegment(idParam);
  if (id == null) notFound();

  const quote = await loadQuote(id);
  if (!quote) notFound();

  const [dealers, catalog, recipientResult, sendHistory, msa] = await Promise.all([
    loadDealers(),
    loadServiceItems(),
    resolveQuoteRecipient(quote.dealerId),
    loadQuoteSendHistory(quote.id),
    // 0046 Phase 5: when the dealer\'s MSA envelope is with BoldSign awaiting
    // signature, the server-side `sendQuote` action refuses re-send. The
    // composer mirrors this state so the button reads as disabled rather
    // than firing then surfacing the server-side error.
    loadActiveOrPendingMsa(quote.dealerId),
  ]);
  // 0061: drive the composer toolbar's MSA-aware send action. The four flags
  // (active / expiresAt / bundleEligible / envelopeInFlight) are derived in one
  // tested helper so the lifecycle rules aren't re-encoded in the page.
  const sendState = deriveQuoteMsaState(msa);
  const msaEnvelopeInFlight = sendState.envelopeInFlight;
  const msaState = {
    active: sendState.active,
    expiresAt: sendState.expiresAt,
    bundleEligible: sendState.bundleEligible,
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
      <QuoteComposer
        dealers={dealers}
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
        msaEnvelopeInFlight={msaEnvelopeInFlight}
        msaState={msaState}
        quoteCreatedAt={quote.createdAt}
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
      />
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
