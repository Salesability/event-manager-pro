import { assertCan } from '@/lib/auth/assert-can';
import { loadCampaigns, loadDealers } from '@/features/schedule/queries';
import { loadServiceItems } from '@/features/services/queries';
import { loadTaxRates } from '@/features/tax-rates/queries';
import { QuoteComposer } from '@/features/quotes/quote-composer';

// Quote composer entry point. Admin || coach (`quote:edit`); coaches own
// their drafts per the multi-tenant-by-coach model. The page reads
// `?dealerId=` and/or `?campaignId=` from the query string to preselect the
// composer's dealer + event.
//
// 0093: every quote scopes to an event. `loadCampaigns()` feeds the composer's
// required Event picker (filtered to the chosen dealer); `?campaignId=` prefills
// it (an event's "Create Quote" link, or the "Create quote now" booking hand-off).

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

  const [dealers, campaigns, catalog, taxRates] = await Promise.all([
    loadDealers(),
    loadCampaigns(),
    loadServiceItems(),
    loadTaxRates(),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <QuoteComposer
        dealers={dealers}
        campaigns={campaigns}
        taxRates={taxRates}
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
