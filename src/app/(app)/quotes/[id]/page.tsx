import Link from 'next/link';
import { notFound } from 'next/navigation';
import { assertCan } from '@/lib/auth/assert-can';
import { loadQuote, loadQuoteSendReceipt, type Quote } from '@/features/quotes/queries';
import { resolveQuoteRecipient } from '@/features/quotes/recipient';
import { loadDealers } from '@/features/schedule/queries';
import { loadServiceItems } from '@/features/services/queries';
import { QuoteComposer, type Recipient } from '@/features/quotes/quote-composer';
import { type QuoteInputs } from '@/lib/quotes/pricing';
import { signedUrl } from '@/lib/storage/gcs';

// Edit-mode quote page. Mirrors `/quotes/new` but hydrates the composer from
// an existing row. Saving routes through `setQuoteInputs` (draft-only,
// atomic guarded UPDATE per `actions.ts:281-289`). Non-draft statuses
// render read-only — server-side guard is the real defence; the UI is
// just the courtesy.

const STATUS_PILL_CLS: Record<Quote['status'], string> = {
  draft: 'bg-stone-200 text-stone-600',
  sent: 'bg-status-blue/15 text-status-blue',
  accepted: 'bg-status-green/15 text-status-green',
  declined: 'bg-status-red/15 text-status-red',
};

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

  const [dealers, catalog, recipientResult, sendReceipt] = await Promise.all([
    loadDealers(),
    loadServiceItems(),
    resolveQuoteRecipient(quote.dealerId),
    loadQuoteSendReceipt(quote.id),
  ]);
  const recipient: Recipient =
    'ok' in recipientResult ? recipientResult.recipient : { error: recipientResult.error };

  let sentPdfDownloadUrl: string | null = null;
  if (quote.status !== 'draft' && quote.pdfStorageKey) {
    const bucket = process.env.GCS_BUCKET;
    if (bucket) {
      const signed = await signedUrl(bucket, quote.pdfStorageKey, SENT_PDF_SIGNED_URL_TTL_SECONDS);
      if ('ok' in signed) sentPdfDownloadUrl = signed.url;
    }
  }
  const emailId = readEmailId(sendReceipt?.payload);

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
          <span
            className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold capitalize ${STATUS_PILL_CLS[quote.status]}`}
          >
            {quote.status}
          </span>
        </div>
        <p className="mt-1 text-sm text-stone-600">
          {quote.dealerName}
          {quote.dealerArchivedAt ? ' (dealer archived)' : ''}
        </p>
      </div>
      {quote.status !== 'draft' && (
        <section className="rounded-xl border border-stone-200 bg-stone-50 p-4 text-sm">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-stone-500">
            Send receipt
          </h2>
          <dl className="mt-2 grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-[max-content_1fr]">
            {quote.sentAt && (
              <>
                <dt className="font-medium text-stone-600">Sent</dt>
                <dd className="text-stone-800">{formatSentAt(quote.sentAt)}</dd>
              </>
            )}
            <dt className="font-medium text-stone-600">Sent to</dt>
            <dd className="text-stone-800">
              {quote.sentToEmail || quote.sentToFirstName
                ? `${quote.sentToFirstName ?? ''}${
                    quote.sentToFirstName && quote.sentToEmail ? ' ' : ''
                  }${quote.sentToEmail ? `<${quote.sentToEmail}>` : ''}`.trim()
                : '(recipient unknown — sent before recipient denorm shipped)'}
            </dd>
            {emailId && (
              <>
                <dt className="font-medium text-stone-600">Resend ID</dt>
                <dd className="font-mono text-xs text-stone-700">{emailId}</dd>
              </>
            )}
            {sentPdfDownloadUrl && (
              <>
                <dt className="font-medium text-stone-600">PDF</dt>
                <dd>
                  <a
                    href={sentPdfDownloadUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-navy underline hover:no-underline"
                  >
                    Download sent PDF
                  </a>
                </dd>
              </>
            )}
          </dl>
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
