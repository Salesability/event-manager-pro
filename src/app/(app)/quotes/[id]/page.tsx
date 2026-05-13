import Link from 'next/link';
import { notFound } from 'next/navigation';
import { assertCan } from '@/lib/auth/assert-can';
import { loadQuote, loadQuoteSendHistory } from '@/features/quotes/queries';
import { displayStatusKey, STATUS_PILL_CLS } from '@/features/quotes/status-display';
import { resolveQuoteRecipient } from '@/features/quotes/recipient';
import { loadDealers } from '@/features/schedule/queries';
import { loadServiceItems } from '@/features/services/queries';
import { QuoteComposer, type Recipient } from '@/features/quotes/quote-composer';
import { type QuoteInputs } from '@/lib/quotes/pricing';
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

function formatSentAt(date: Date): string {
  return date.toLocaleString('en-CA', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
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

  const [dealers, catalog, recipientResult, sendHistory] = await Promise.all([
    loadDealers(),
    loadServiceItems(),
    resolveQuoteRecipient(quote.dealerId),
    loadQuoteSendHistory(quote.id),
  ]);
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

  return (
    <div className="flex flex-col gap-6">
      <div>
        <div className="flex items-center gap-3">
          <Link
            href="/quotes"
            className="text-xs font-medium text-stone-500 transition hover:text-navy"
          >
            ← Quotes
          </Link>
          <span className="text-stone-300">/</span>
          <h1 className="font-display text-3xl text-navy">Quote #{quote.id}</h1>
          {(() => {
            const pillKey = displayStatusKey(quote);
            return (
              <span
                className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold capitalize ${STATUS_PILL_CLS[pillKey]}`}
              >
                {pillKey}
              </span>
            );
          })()}
        </div>
        <p className="mt-1 text-sm text-stone-600">
          {quote.dealerName}
          {quote.dealerArchivedAt ? ' (dealer archived)' : ''}
        </p>
      </div>
      {quote.status !== 'draft' && sendHistory.length > 0 && (
        <section className="rounded-xl border border-stone-200 bg-stone-50 p-4 text-sm">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-stone-500">
            Send history
          </h2>
          <ul className="mt-3 flex flex-col gap-3">
            {sendHistory.map((row, idx) => {
              const emailId = readEmailId(row.payload);
              const isMostRecent = idx === 0;
              return (
                <li
                  key={`${row.occurredAt.toISOString()}-${idx}`}
                  className="flex flex-col gap-1 rounded-lg border border-stone-200 bg-white p-3 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4"
                >
                  <div className="flex flex-col gap-0.5">
                    <span className="text-stone-800">
                      {formatSentAt(row.occurredAt)}
                      {isMostRecent ? (
                        <span className="ml-2 rounded-full bg-stone-200 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-stone-700">
                          Latest
                        </span>
                      ) : null}
                    </span>
                    <span className="text-xs text-stone-600">
                      {quote.sentToEmail || quote.sentToFirstName
                        ? `Sent to ${quote.sentToFirstName ?? ''}${
                            quote.sentToFirstName && quote.sentToEmail ? ' ' : ''
                          }${quote.sentToEmail ? `<${quote.sentToEmail}>` : ''}`.trim()
                        : 'Sent to (recipient unknown — sent before recipient denorm shipped)'}
                    </span>
                    {emailId && (
                      <span className="font-mono text-[11px] text-stone-500">
                        Resend ID: {emailId}
                      </span>
                    )}
                  </div>
                  {isMostRecent && sentPdfDownloadUrl ? (
                    <a
                      href={sentPdfDownloadUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-navy underline hover:no-underline"
                    >
                      Download PDF
                    </a>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>
      )}
      <QuoteComposer
        dealers={dealers}
        catalog={catalog}
        initialDealerId={quote.dealerId}
        initialCampaignId={null}
        initial={{
          quoteId: quote.id,
          dealerId: quote.dealerId,
          dealerName: quote.dealerName,
          inputs: quote.inputs as QuoteInputs,
          lineItems: quote.lineItems,
          subtotal: Number(quote.subtotal) || 0,
          tax: Number(quote.tax) || 0,
          total: Number(quote.total) || 0,
          status: quote.status,
          isExpired: quote.isExpired,
          sentAt: quote.sentAt,
          quoteValidDays: quote.quoteValidDays,
        }}
        recipient={recipient}
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
