import Link from 'next/link';
import { notFound } from 'next/navigation';
import { assertCan } from '@/lib/auth/assert-can';
import { loadDealer } from '@/features/schedule/queries';
import { loadQuotesByDealer, type Quote } from '@/features/quotes/queries';
import { resolveQuoteRecipient } from '@/features/quotes/recipient';
import {
  firstDraftQuoteIdForDealer,
  loadActiveOrPendingMsa,
  type Msa,
} from '@/features/msa/queries';
import { MsaCreateTrigger } from '@/features/msa/msa-panel';
import { signedUrl } from '@/lib/storage/gcs';

// Per-dealer detail. Gated `admin:access` to match the `/dealerships` index;
// coaches currently can't browse dealerships, so admin-only here avoids the
// asymmetry of a deep link reachable without the parent surface. If the
// nav-tab gate ever opens for coaches, this gate flips with it.

const STATUS_PILL_CLS: Record<Quote['status'], string> = {
  draft: 'bg-stone-200 text-stone-600',
  sent: 'bg-status-blue/15 text-status-blue',
  accepted: 'bg-status-green/15 text-status-green',
  declined: 'bg-status-red/15 text-status-red',
};

const MSA_STATUS_PILL_CLS: Record<Msa['status'], string> = {
  pending: 'bg-amber-100 text-amber-700',
  active: 'bg-emerald-100 text-emerald-700',
  expired: 'bg-stone-200 text-stone-600',
  terminated: 'bg-status-red/15 text-status-red',
};

const MSA_PDF_SIGNED_URL_TTL_SECONDS = 5 * 60;

export default async function DealerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await assertCan('admin:access'); // expected: server-only
  const { id: idParam } = await params;
  const id = parsePositiveIntPathSegment(idParam);
  if (id == null) notFound();

  const dealer = await loadDealer(id);
  if (!dealer) notFound();

  const [quotes, msa, firstDraftQuoteId, recipientResult] = await Promise.all([
    loadQuotesByDealer(id),
    loadActiveOrPendingMsa(id),
    firstDraftQuoteIdForDealer(id),
    resolveQuoteRecipient(id),
  ]);
  const recipient =
    'ok' in recipientResult
      ? recipientResult.recipient
      : { error: recipientResult.error };

  let signedMsaPdfUrl: string | null = null;
  if (msa?.status === 'active' && msa.signedPdfStorageKey) {
    const bucket = process.env.GCS_BUCKET;
    if (bucket) {
      const signed = await signedUrl(
        bucket,
        msa.signedPdfStorageKey,
        MSA_PDF_SIGNED_URL_TTL_SECONDS,
      );
      if ('ok' in signed) signedMsaPdfUrl = signed.url;
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <div className="flex flex-wrap items-center gap-3">
          <Link
            href="/dealerships"
            className="text-xs font-medium text-stone-500 transition hover:text-navy"
          >
            ← Dealers
          </Link>
          <span className="text-stone-300">/</span>
          <h1 className="font-display text-3xl text-navy">{dealer.name}</h1>
          <DealerStatusPill status={dealer.status} archivedAt={dealer.archivedAt} />
        </div>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-stone-600">
          {dealer.address && <span>{dealer.address}</span>}
          {dealer.acquiredVia && (
            <span>
              <span className="text-stone-400">Acquired via:</span> {dealer.acquiredVia}
            </span>
          )}
          {dealer.primaryEmail && <span>{dealer.primaryEmail}</span>}
          {dealer.primaryPhone && <span>{dealer.primaryPhone}</span>}
        </div>
      </div>

      <section className="rounded-2xl border border-stone-200 bg-white p-5 shadow-[0_1px_4px_rgba(15,30,60,0.08)]">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="font-display text-xl text-navy">Master Service Agreement</h2>
          {msa && (
            <span
              className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold capitalize ${MSA_STATUS_PILL_CLS[msa.status]}`}
            >
              {msa.status}
            </span>
          )}
        </div>
        {msa ? (
          <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-[max-content_1fr]">
            <dt className="font-medium text-stone-600">Created</dt>
            <dd className="text-stone-800">{fmtDate(msa.createdAt)}</dd>
            {msa.signedAt && (
              <>
                <dt className="font-medium text-stone-600">Signed</dt>
                <dd className="text-stone-800">{fmtDate(msa.signedAt)}</dd>
              </>
            )}
            {msa.expiresAt && (
              <>
                <dt className="font-medium text-stone-600">Expires</dt>
                <dd className="text-stone-800">{fmtDate(msa.expiresAt)}</dd>
              </>
            )}
            <dt className="font-medium text-stone-600">Template version</dt>
            <dd className="font-mono text-xs text-stone-700">{msa.templateVersion}</dd>
            {signedMsaPdfUrl && (
              <>
                <dt className="font-medium text-stone-600">Signed PDF</dt>
                <dd>
                  <a
                    href={signedMsaPdfUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium text-navy underline hover:opacity-80"
                  >
                    Download signed MSA
                  </a>
                </dd>
              </>
            )}
            {msa.status === 'pending' && msa.dropboxSignDocumentId && (
              <dd className="col-span-full mt-1 text-xs text-stone-500">
                Envelope sent — awaiting signer. Sign event arrives via Dropbox
                Sign webhook.
              </dd>
            )}
          </dl>
        ) : (
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <p className="text-sm text-stone-600">
              No MSA on file yet. The first envelope bundles the MSA with the
              dealer&apos;s first draft Quote.
            </p>
            {!dealer.archivedAt && (
              <MsaCreateTrigger
                dealerId={dealer.id}
                dealerName={dealer.name}
                recipient={recipient}
                firstDraftQuoteId={firstDraftQuoteId}
              />
            )}
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-stone-200 bg-white p-5 shadow-[0_1px_4px_rgba(15,30,60,0.08)]">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-xl text-navy">Quotes</h2>
          {!dealer.archivedAt && (
            <Link
              href={`/quotes/new?dealerId=${dealer.id}`}
              className="rounded-lg border border-accent/40 bg-white px-3 py-1 text-xs font-semibold text-accent transition hover:border-accent hover:bg-accent/10"
            >
              + New quote
            </Link>
          )}
        </div>

        {quotes.length === 0 ? (
          <div className="mt-4 flex flex-col items-center gap-2 py-12 text-stone-400">
            <span className="text-3xl">📋</span>
            <span className="text-sm font-semibold text-stone-600">No quotes yet</span>
            {!dealer.archivedAt && (
              <Link
                href={`/quotes/new?dealerId=${dealer.id}`}
                className="mt-2 text-xs font-medium text-accent transition hover:underline"
              >
                Create the first quote →
              </Link>
            )}
          </div>
        ) : (
          <div className="mt-4 overflow-hidden rounded-xl border border-stone-200">
            <table className="w-full text-sm">
              <thead className="bg-navy text-left text-[11px] font-semibold uppercase tracking-wider text-white/80">
                <tr>
                  <th className="px-3 py-2.5">Status</th>
                  <th className="px-3 py-2.5 text-right">Total</th>
                  <th className="px-3 py-2.5">Sent</th>
                  <th className="px-3 py-2.5">Created</th>
                  <th className="px-3 py-2.5">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {quotes.map((quote) => (
                  <tr key={quote.id} className="border-b border-stone-200 last:border-b-0">
                    <td className="px-3 py-2.5 align-top">
                      <span
                        className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold capitalize ${STATUS_PILL_CLS[quote.status]}`}
                      >
                        {quote.status}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-right align-top font-semibold tabular-nums">
                      {fmtMoney(quote.total)}
                    </td>
                    <td className="px-3 py-2.5 align-top text-xs text-stone-600">
                      {fmtDate(quote.sentAt)}
                    </td>
                    <td className="px-3 py-2.5 align-top text-xs text-stone-600">
                      {fmtDate(quote.createdAt)}
                    </td>
                    <td className="px-3 py-2.5 align-top">
                      <Link
                        href={`/quotes/${quote.id}`}
                        aria-label={`View quote #${quote.id}`}
                        className="rounded border border-stone-200 bg-white px-2 py-0.5 text-xs font-medium text-stone-600 transition hover:border-navy hover:text-navy"
                      >
                        View
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function DealerStatusPill({
  status,
  archivedAt,
}: {
  status: 'prospect' | 'active';
  archivedAt: Date | null;
}) {
  if (archivedAt) {
    return (
      <span className="rounded-full bg-stone-200 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-stone-600">
        Archived
      </span>
    );
  }
  return (
    <span
      className={
        status === 'active'
          ? 'rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700'
          : 'rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700'
      }
    >
      {status}
    </span>
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

function fmtDate(d: Date | null): string {
  if (!d) return '—';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
