import Link from 'next/link';
import { notFound } from 'next/navigation';
import { assertCan } from '@/lib/auth/assert-can';
import { loadQuote, type Quote } from '@/features/quotes/queries';
import { loadDealers } from '@/features/schedule/queries';
import { loadServiceItems } from '@/features/services/queries';
import { QuoteComposer } from '@/features/quotes/quote-composer';
import { type QuoteInputs } from '@/lib/quotes/pricing';

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

export default async function QuoteEditPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await assertCan('quote:edit'); // expected: server-only — admin || coach
  const { id: idParam } = await params;
  const id = Number(idParam);
  if (!Number.isInteger(id) || id <= 0) notFound();

  const quote = await loadQuote(id);
  if (!quote) notFound();

  const [dealers, catalog] = await Promise.all([loadDealers(), loadServiceItems()]);

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
      />
    </div>
  );
}
