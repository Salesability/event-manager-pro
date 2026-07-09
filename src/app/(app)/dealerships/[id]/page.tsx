import Link from 'next/link';
import { notFound } from 'next/navigation';
import { assertCan } from '@/lib/auth/assert-can';
import { Button } from '@/components/catalyst/button';
import { KeyValueStrip } from '@/components/app/key-value-strip';
import { PageHeader } from '@/components/app/page-header';
import { Section } from '@/components/app/section';
import {
  DealerStatusBadge,
  MsaStatusBadge,
} from '@/components/app/status-badge';
import { loadCampaign, loadCoaches, loadDealer, loadDealerActivities } from '@/features/schedule/queries';
import { loadQuotesByDealer } from '@/features/quotes/queries';
import { DealerQuotesPanel } from '@/features/quotes/dealer-quotes-panel';
import { DealerPipelinePanel } from '@/features/dealers/dealer-pipeline-panel';
import { DealerForm } from '@/features/dealers/dealer-form';
import { loadActiveOrPendingMsa } from '@/features/msa/queries';
import { MsaSendForSignatureButton } from '@/features/msa/msa-send-button';
import { resolveQuoteRecipient } from '@/features/quotes/recipient';
import { pushDealerToQuickbooks } from '@/features/quickbooks/actions';
import { getConnection } from '@/lib/quickbooks/connection';
import { signedUrl } from '@/lib/storage/gcs';

// Per-dealer detail. Gated `admin:access` to match the `/dealerships` index;
// coaches currently can't browse dealerships, so admin-only here avoids the
// asymmetry of a deep link reachable without the parent surface. If the
// nav-tab gate ever opens for coaches, this gate flips with it.

const MSA_PDF_SIGNED_URL_TTL_SECONDS = 5 * 60;

export default async function DealerDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await assertCan('admin:access'); // expected: server-only
  const { id: idParam } = await params;
  const id = parsePositiveIntPathSegment(idParam);
  if (id == null) notFound();

  const dealer = await loadDealer(id);
  if (!dealer) notFound();

  const [quotes, msa, qbConnection, recipientResult, coaches, activities] = await Promise.all([
    loadQuotesByDealer(id),
    loadActiveOrPendingMsa(id),
    getConnection(),
    resolveQuoteRecipient(id),
    loadCoaches(),
    loadDealerActivities(id),
  ]);

  // 0082: the MSA is sent for signature from here (the dealer page), on its own
  // BoldSign envelope — no longer bundled with the first quote. Eligible when
  // there's no usable MSA (none / expired / terminated, the states where
  // `createMsaDraft` succeeds) and the dealer isn't archived.
  const canSendMsa =
    !dealer.archivedAt &&
    (msa == null || msa.status === 'expired' || msa.status === 'terminated');
  const msaRecipient =
    'ok' in recipientResult ? recipientResult.recipient : { error: recipientResult.error };

  // The push action redirects back here with ?qbpush=created|updated.
  const sp = await searchParams;

  // 0104: `?returnEvent=<id>` — the admin arrived from an event's "Send MSA".
  // Carry it into the send button (a successful send returns to that event's
  // dialog) and surface a "← Back to event" affordance so they can bail without
  // sending. Load the event for a dated label; a stale/invalid id just yields a
  // generic link (the calendar no-ops on an unknown `?event=`).
  const returnEventRaw = Array.isArray(sp.returnEvent) ? sp.returnEvent[0] : sp.returnEvent;
  const returnEventId =
    returnEventRaw && /^\d+$/.test(returnEventRaw) && Number(returnEventRaw) > 0
      ? Number(returnEventRaw)
      : null;
  const returnEventCampaign = returnEventId != null ? await loadCampaign(returnEventId) : null;

  const qbNotice =
    sp.qbpush === 'created'
      ? 'Created this dealer in QuickBooks and linked it.'
      : sp.qbpush === 'updated'
        ? "Pushed this dealer's details to its QuickBooks customer."
        : null;

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

      {returnEventId != null && (
        <Link
          href={`/calendar?event=${returnEventId}`}
          className="flex items-center gap-1.5 self-start rounded-lg border border-brand-200 bg-brand-50 px-3 py-1.5 text-xs font-semibold text-brand-700 transition hover:border-brand-500"
        >
          ← Back to event
          {returnEventCampaign
            ? ` · ${fmtEventDates(returnEventCampaign.startDate, returnEventCampaign.endDate)}`
            : ''}
        </Link>
      )}

      {qbNotice && (
        <p className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">
          {qbNotice}
        </p>
      )}

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

      {!dealer.archivedAt && (
        <Section title="Pipeline" variant="card">
          <DealerPipelinePanel dealer={dealer} coaches={coaches} activities={activities} />
        </Section>
      )}

      {qbConnection && (
        <Section title="QuickBooks" variant="card">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-zinc-500">
              {dealer.quickbooksId ? (
                <>
                  Linked to QuickBooks customer{' '}
                  <code className="font-mono text-zinc-700">#{dealer.quickbooksId}</code>. Pushing
                  updates that customer with this dealer&apos;s current details.
                </>
              ) : (
                <>Not in QuickBooks yet. Pushing creates a new customer and links it to this dealer.</>
              )}
            </p>
            {!dealer.archivedAt && (
              <form action={pushDealerToQuickbooks}>
                <input type="hidden" name="dealerId" value={dealer.id} />
                <Button outline compact type="submit">
                  Push to QuickBooks
                </Button>
              </form>
            )}
          </div>
        </Section>
      )}

      <Section
        title="Master Service Agreement"
        actions={msa ? <MsaStatusBadge status={msa.status} /> : null}
        variant="card"
      >
        {msa && (
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
        )}
        {canSendMsa ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-zinc-500">
              {msa
                ? 'The previous agreement is no longer active — send a renewal for signature.'
                : 'No MSA on file yet. Send the Master Service Agreement to the Client for signature; once signed, this dealer’s quotes can be accepted.'}
            </p>
            <MsaSendForSignatureButton
              dealerId={dealer.id}
              dealerName={dealer.name}
              recipient={msaRecipient}
              returnEventId={returnEventId}
            />
          </div>
        ) : (
          !msa && (
            <p className="text-sm text-zinc-500">
              No MSA on file yet.
            </p>
          )
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

// 0104: date-range label for the "← Back to event" affordance. Campaign dates
// are `date` columns (ISO, no TZ) — parse at UTC noon to match the calendar's
// date handling so the day doesn't shift.
function fmtEventDates(startIso: string, endIso: string): string {
  const f = (iso: string) => {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      timeZone: 'UTC',
    });
  };
  return startIso === endIso ? f(startIso) : `${f(startIso)} – ${f(endIso)}`;
}
