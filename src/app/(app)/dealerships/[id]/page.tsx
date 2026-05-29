import Link from 'next/link';
import { notFound } from 'next/navigation';
import { assertCan } from '@/lib/auth/assert-can';
import { KeyValueStrip } from '@/components/app/key-value-strip';
import { PageHeader } from '@/components/app/page-header';
import { Section } from '@/components/app/section';
import {
  DealerStatusBadge,
  MsaStatusBadge,
} from '@/components/app/status-badge';
import { loadDealer } from '@/features/schedule/queries';
import { loadQuotesByDealer } from '@/features/quotes/queries';
import { DealerQuotesPanel } from '@/features/quotes/dealer-quotes-panel';
import { DealerForm } from '@/features/dealers/dealer-form';
import { loadActiveOrPendingMsa } from '@/features/msa/queries';
import { signedUrl } from '@/lib/storage/gcs';

// Per-dealer detail. Gated `admin:access` to match the `/dealerships` index;
// coaches currently can't browse dealerships, so admin-only here avoids the
// asymmetry of a deep link reachable without the parent surface. If the
// nav-tab gate ever opens for coaches, this gate flips with it.

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

  const [quotes, msa] = await Promise.all([
    loadQuotesByDealer(id),
    loadActiveOrPendingMsa(id),
  ]);

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
      <Link
        href="/dealerships"
        className="text-xs font-medium text-zinc-500 transition hover:text-zinc-900"
      >
        ← Dealers
      </Link>
      <PageHeader
        title={dealer.name}
        actions={<DealerStatusBadge status={dealer.status} archivedAt={dealer.archivedAt} />}
      />

      <KeyValueStrip
        items={[
          {
            label: 'Status',
            value: dealer.archivedAt ? 'Archived' : dealer.status,
          },
          {
            label: 'MSA state',
            value: msa ? msa.status : 'None on file',
          },
          {
            label: 'Contact',
            value:
              [dealer.contactFirstName, dealer.contactLastName]
                .filter(Boolean)
                .join(' ') || '—',
          },
          { label: 'Phone', value: dealer.primaryPhone ?? '—' },
          { label: 'Email', value: dealer.primaryEmail ?? '—' },
          { label: 'Acquired via', value: dealer.acquiredVia ?? '—' },
        ]}
      />

      <Section title="Details" variant="card">
        <DealerForm mode="edit" dealer={dealer} autoFocus={false} />
      </Section>

      <Section
        title="Master Service Agreement"
        actions={msa ? <MsaStatusBadge status={msa.status} /> : null}
        variant="card"
      >
        {msa ? (
          <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-[max-content_1fr]">
            <dt className="font-medium text-zinc-500">Created</dt>
            <dd className="text-zinc-900">{fmtDate(msa.createdAt)}</dd>
            {msa.signedAt && (
              <>
                <dt className="font-medium text-zinc-500">Signed</dt>
                <dd className="text-zinc-900">{fmtDate(msa.signedAt)}</dd>
              </>
            )}
            {msa.expiresAt && (
              <>
                <dt className="font-medium text-zinc-500">Expires</dt>
                <dd className="text-zinc-900">{fmtDate(msa.expiresAt)}</dd>
              </>
            )}
            <dt className="font-medium text-zinc-500">Template version</dt>
            <dd className="font-mono text-xs text-zinc-900">{msa.templateVersion}</dd>
            {signedMsaPdfUrl && (
              <>
                <dt className="font-medium text-zinc-500">Signed PDF</dt>
                <dd>
                  <a
                    href={signedMsaPdfUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium text-brand-700 underline hover:opacity-80"
                  >
                    Download signed MSA
                  </a>
                </dd>
              </>
            )}
            {msa.status === 'pending' && msa.providerDocumentId && (
              <dd className="col-span-full mt-1 text-xs text-zinc-500">
                Envelope sent — awaiting signer. Sign event arrives via
                BoldSign webhook.
              </dd>
            )}
          </dl>
        ) : (
          <p className="text-sm text-zinc-500">
            No MSA on file yet. The MSA bundles with the dealer&apos;s first
            Quote and is sent for signature from that quote — open or create one
            in <span className="font-medium text-zinc-700">Quotes</span> below.
          </p>
        )}
      </Section>

      <Section
        title="Quotes"
        actions={
          !dealer.archivedAt ? (
            <Link
              href={`/quotes/new?dealerId=${dealer.id}`}
              className="rounded-lg border border-brand-200 bg-white px-3 py-1 text-xs font-semibold text-brand-700 transition hover:border-brand-500 hover:bg-brand-50"
            >
              + New quote
            </Link>
          ) : null
        }
        variant="card"
      >
        {quotes.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-12 text-zinc-500/70">
            <span className="text-3xl">📋</span>
            <span className="text-sm font-semibold text-zinc-500">No quotes yet</span>
            {!dealer.archivedAt && (
              <Link
                href={`/quotes/new?dealerId=${dealer.id}`}
                className="mt-2 text-xs font-medium text-brand-700 transition hover:underline"
              >
                Create the first quote →
              </Link>
            )}
          </div>
        ) : (
          <DealerQuotesPanel quotes={quotes} />
        )}
      </Section>
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

function fmtDate(d: Date | null): string {
  if (!d) return '—';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
