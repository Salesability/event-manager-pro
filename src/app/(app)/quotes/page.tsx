import { assertCan } from '@/lib/auth/assert-can';
import { PageHeader } from '@/components/app/page-header';
import { loadQuotes, type Quote, type QuoteStatus } from '@/features/quotes/queries';
import { displayStatusKey, STATUS_PILL_CLS } from '@/features/quotes/status-display';
import { QuotesFilters } from './quotes-filters';
import { QuoteRowActions } from './row-actions';

type Props = {
  searchParams: Promise<{ q?: string | string[]; status?: string | string[] }>;
};

// Quote index. Mirrors `/production` (server-component list page with
// URL-driven filter pills + search). Both admin and coach reach it via
// `quote:edit` — same gate the `/quotes/new` composer and `/quotes/[id]`
// edit-mode page use.
export default async function QuotesPage({ searchParams }: Props) {
  await assertCan('quote:edit'); // expected: server-only — admin || coach
  const { q, status } = await searchParams;
  const pickedQ = pickFirst(q);
  const pickedStatus = pickFirst(status);

  const all = await loadQuotes();
  const counts = {
    all: all.length,
    draft: all.filter((x) => x.status === 'draft').length,
    sent: all.filter((x) => x.status === 'sent').length,
    accepted: all.filter((x) => x.status === 'accepted').length,
    declined: all.filter((x) => x.status === 'declined').length,
  };
  const filtered = filterQuotes(all, { q: pickedQ ?? '', status: pickedStatus ?? '' });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Quotes"
        description="Every quote in the pipeline — drafts, sent, accepted, declined."
      />
      <QuotesFilters counts={counts} />

      <section className="overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-[0_1px_4px_rgba(15,30,60,0.08)]">
        <div className="overflow-x-auto">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-20 text-stone-400">
              <span className="text-4xl">📋</span>
              <span className="text-sm font-semibold text-stone-600">No quotes match</span>
              <span className="text-xs">
                {all.length === 0
                  ? 'Create the first quote from a dealer row on /dealerships.'
                  : 'Adjust the search or status filter to see more.'}
              </span>
            </div>
          ) : (
            <table className="w-full min-w-[900px] table-auto border-separate border-spacing-0 text-sm">
              <thead>
                <tr className="bg-navy text-left text-[11px] font-semibold uppercase tracking-wider text-white/80">
                  <th className="w-full px-3 py-2.5">Dealer</th>
                  <th className="px-3 py-2.5">Status</th>
                  <th className="px-3 py-2.5 text-right">Total</th>
                  <th className="px-3 py-2.5">Sent</th>
                  <th className="px-3 py-2.5">Created</th>
                  <th className="px-3 py-2.5"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((quote) => (
                  <QuoteRow key={quote.id} quote={quote} />
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>
    </div>
  );
}

function pickFirst(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

function filterQuotes(
  rows: Quote[],
  { q, status }: { q: string; status: string },
): Quote[] {
  const needle = q.trim().toLowerCase();
  const wantedStatus = isQuoteStatus(status) ? status : null;
  return rows.filter((row) => {
    if (wantedStatus && row.status !== wantedStatus) return false;
    if (needle && !row.dealerName.toLowerCase().includes(needle)) return false;
    return true;
  });
}

function isQuoteStatus(v: string): v is QuoteStatus {
  return v === 'draft' || v === 'sent' || v === 'accepted' || v === 'declined';
}

function QuoteRow({ quote }: { quote: Quote }) {
  const pillKey = displayStatusKey(quote);
  return (
    <tr className="border-b border-stone-200 last:border-b-0 hover:bg-navy-pale/40">
      <td className="border-b border-stone-200 px-3 py-2.5 align-top">
        <div className="font-semibold text-stone-800">{quote.dealerName}</div>
        {quote.dealerArchivedAt && (
          <div className="text-[11px] text-stone-400">Dealer archived</div>
        )}
      </td>
      <td className="border-b border-stone-200 px-3 py-2.5 align-top">
        <span
          className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold capitalize ${STATUS_PILL_CLS[pillKey]}`}
        >
          {pillKey}
        </span>
      </td>
      <td className="border-b border-stone-200 px-3 py-2.5 text-right align-top font-semibold">
        {fmtMoney(quote.total)}
      </td>
      <td className="whitespace-nowrap border-b border-stone-200 px-3 py-2.5 align-top text-xs text-stone-600">
        {fmtDate(quote.sentAt)}
      </td>
      <td className="whitespace-nowrap border-b border-stone-200 px-3 py-2.5 align-top text-xs text-stone-600">
        {fmtDate(quote.createdAt)}
      </td>
      <td className="border-b border-stone-200 px-3 py-2.5 align-top">
        <QuoteRowActions quote={quote} />
      </td>
    </tr>
  );
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
