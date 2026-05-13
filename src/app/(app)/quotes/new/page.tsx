import { assertCan } from '@/lib/auth/assert-can';
import { loadDealers } from '@/features/schedule/queries';
import { loadServiceItems } from '@/features/services/queries';
import { QuoteComposer } from '@/features/quotes/quote-composer';

// Quote composer entry point. Admin || coach (`quote:edit`); coaches own
// their drafts per the multi-tenant-by-coach model. The page reads
// `?dealerId=` and/or `?campaignId=` from the query string to preselect the
// composer's header context.
//
// `campaignId` plumbing is **post-MVP for 0035** — we resolve the id here so
// the composer can surface a "Tied to campaign #X" label, but full campaign
// linkage (Quote → Campaign FK in the create payload) is deferred to 7.2
// Contract phase. v1 just shows the linkage as context.

type SearchParams = Record<string, string | string[] | undefined>;

export default async function NewQuotePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await assertCan('quote:edit'); // expected: server-only — admin || coach
  const sp = await searchParams;
  const initialDealerId = pickFirst(sp.dealerId);
  const initialCampaignId = pickFirst(sp.campaignId);

  const [dealers, catalog] = await Promise.all([loadDealers(), loadServiceItems()]);

  return (
    <div className="flex flex-col gap-6">
      <QuoteComposer
        dealers={dealers}
        catalog={catalog}
        initialDealerId={parseIntOrNull(initialDealerId)}
        initialCampaignId={parseIntOrNull(initialCampaignId)}
        pageTitle="New Quote"
        pageDescription="Build a quote against the service catalog. Save Draft to persist; sending happens later."
      />
    </div>
  );
}

function pickFirst(v: string | string[] | undefined): string | undefined {
  if (Array.isArray(v)) return v[0];
  return v;
}

function parseIntOrNull(v: string | undefined): number | null {
  if (!v) return null;
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}
