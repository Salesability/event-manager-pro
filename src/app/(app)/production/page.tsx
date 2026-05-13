import { assertCan } from '@/lib/auth/assert-can';
import { PageHeader } from '@/components/app/page-header';
import {
  loadCampaignStyles,
  loadCampaigns,
  loadCoaches,
  loadDealers,
  loadAudienceSources,
  type Campaign,
  type Coach,
  type Dealer,
  type LookupOption,
} from '@/features/schedule/queries';
import { filterCampaigns, todayIso } from './filter';
import { ProductionFilters } from './production-filters';
import { RowActions } from './row-actions';

type Props = {
  searchParams: Promise<{ q?: string; status?: string; cancelled?: string }>;
};

export default async function ProductionPage({ searchParams }: Props) {
  await assertCan('admin:access'); // expected: server-only
  const { q, status, cancelled } = await searchParams;
  const showCancelled = cancelled === '1';

  const [all, dealers, coaches, styles, sources] = await Promise.all([
    loadCampaigns(),
    loadDealers(),
    loadCoaches(),
    loadCampaignStyles(),
    loadAudienceSources(),
  ]);
  const filtered = filterCampaigns(all, { q: q ?? '', status: status ?? '', showCancelled });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Production List"
        description="All campaigns imported from the legacy spreadsheet."
        actions={<ProductionFilters />}
      />

      <section className="overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-[0_1px_4px_rgba(15,30,60,0.08)]">
        <div className="overflow-x-auto">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-20 text-stone-400">
              <span className="text-4xl">📋</span>
              <span className="text-sm font-semibold text-stone-600">No campaigns match</span>
              <span className="text-xs">Adjust the search or status filter to see more.</span>
            </div>
          ) : (
            <table className="min-w-[1100px] table-auto border-separate border-spacing-0 text-sm print:min-w-0 print:text-[10px]">
              <thead>
                <tr className="bg-navy text-left text-[11px] font-semibold uppercase tracking-wider text-white/80">
                  <th className="px-3 py-2.5">Date Range</th>
                  <th className="px-3 py-2.5">Dealership</th>
                  <th className="px-3 py-2.5">Contact</th>
                  <th className="px-3 py-2.5">Format</th>
                  <th className="px-3 py-2.5">Data Source</th>
                  <th className="px-3 py-2.5 text-right">Records</th>
                  <th className="px-3 py-2.5 text-right">SMS / Email</th>
                  <th className="px-3 py-2.5 text-right">Letters</th>
                  <th className="px-3 py-2.5 text-right">BDC</th>
                  <th className="px-3 py-2.5">Coach</th>
                  <th className="px-3 py-2.5">Notes</th>
                  <th className="px-3 py-2.5 print:hidden"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((c) => (
                  <CampaignRow
                    key={c.id}
                    campaign={c}
                    dealers={dealers}
                    coaches={coaches}
                    styles={styles}
                    sources={sources}
                  />
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>
    </div>
  );
}

function CampaignRow({
  campaign,
  dealers,
  coaches,
  styles,
  sources,
}: {
  campaign: Campaign;
  dealers: Dealer[];
  coaches: Coach[];
  styles: LookupOption[];
  sources: LookupOption[];
}) {
  const today = todayIso();
  const isPast = campaign.endDate < today;
  const isLive = campaign.startDate <= today && campaign.endDate >= today;
  const badge = isLive
    ? { label: 'Live', cls: 'bg-status-green/15 text-status-green' }
    : isPast
      ? { label: 'Past', cls: 'bg-stone-200 text-stone-600' }
      : { label: 'Upcoming', cls: 'bg-navy-pale text-navy' };

  return (
    <tr className="border-b border-stone-200 last:border-b-0 hover:bg-navy-pale/40">
      <td className="border-b border-stone-200 px-3 py-2.5 align-top">
        <div className="text-xs font-semibold text-navy">{fmtDate(campaign.startDate)}</div>
        <div className="text-[11px] text-stone-400">→ {fmtDate(campaign.endDate)}</div>
        <span
          className={`mt-1 inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold ${badge.cls}`}
        >
          {badge.label}
        </span>
      </td>
      <td className="border-b border-stone-200 px-3 py-2.5 align-top">
        <div className="font-semibold text-stone-800">{campaign.dealerName}</div>
        {campaign.dealerAddress && (
          <div className="text-[11px] text-stone-400">{campaign.dealerAddress}</div>
        )}
      </td>
      <td className="border-b border-stone-200 px-3 py-2.5 align-top">
        <div className="text-xs">{campaign.contact ?? '—'}</div>
        <div className="text-[11px] text-stone-400">{campaign.phone ?? '—'}</div>
        <div className="text-[11px] text-status-blue">{campaign.email ?? '—'}</div>
      </td>
      <td className="border-b border-stone-200 px-3 py-2.5 align-top">
        {campaign.styleLabel ? (
          <span className="inline-block rounded-full bg-status-blue/10 px-2 py-0.5 text-[11px] font-semibold text-status-blue">
            {campaign.styleLabel}
          </span>
        ) : (
          '—'
        )}
      </td>
      <td className="border-b border-stone-200 px-3 py-2.5 align-top text-xs text-stone-600">
        {campaign.audienceSourceLabel ?? '—'}
      </td>
      <td className="border-b border-stone-200 px-3 py-2.5 text-right align-top font-semibold">
        {fmtNum(campaign.qtyRecords)}
      </td>
      <td className="border-b border-stone-200 px-3 py-2.5 text-right align-top font-semibold">
        {fmtNum(campaign.smsEmail)}
      </td>
      <td className="border-b border-stone-200 px-3 py-2.5 text-right align-top font-semibold">
        {fmtNum(campaign.letters)}
      </td>
      <td className="border-b border-stone-200 px-3 py-2.5 text-right align-top font-semibold">
        {fmtNum(campaign.bdc)}
      </td>
      <td className="border-b border-stone-200 px-3 py-2.5 align-top">
        {campaign.coachName ? (
          <span className="font-semibold">{campaign.coachName}</span>
        ) : (
          <span className="text-stone-400">—</span>
        )}
      </td>
      <td className="max-w-[200px] border-b border-stone-200 px-3 py-2.5 align-top text-xs text-stone-600">
        {campaign.notes ?? '—'}
      </td>
      <td className="border-b border-stone-200 px-3 py-2.5 align-top print:hidden">
        <RowActions
          campaign={campaign}
          dealers={dealers}
          coaches={coaches}
          styles={styles}
          sources={sources}
        />
      </td>
    </tr>
  );
}

function fmtDate(iso: string) {
  const d = new Date(`${iso}T12:00:00`);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function fmtNum(n: number | null) {
  return n == null ? <span className="text-stone-400">—</span> : n.toLocaleString();
}
