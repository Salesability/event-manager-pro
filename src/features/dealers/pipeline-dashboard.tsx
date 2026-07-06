import Link from 'next/link';
import type { ReactNode } from 'react';
import { Section } from '@/components/app/section';
import { PipelineStageBadge } from '@/components/app/status-badge';
import { cn } from '@/lib/utils';
import {
  ACTIVITY_KIND_LABELS,
  ACTIVITY_KINDS,
  PIPELINE_STAGE_LABELS,
  PIPELINE_STAGES,
} from './pipeline';
import type {
  ActivityActorCount,
  BlockerDealer,
  PipelineDashboard,
} from './dashboard';

// Read-only management view for the 0088 dealer-pipeline dashboard. A server
// component (no client JS — every interaction is a plain drill-through link into
// the /dealerships commitment queue). Renders the four facets from the
// `PipelineDashboard` view model built in `dashboard.ts`; the page owns the
// breadcrumb + header + capability gate.

const QUEUE = '/dealerships';

/** Build a pre-filtered /dealerships queue href from the 0087 URL params
 *  (`status` / `stage` / `due` / `idle`). Drill-through contract: decision.md. */
function queueHref(params: Record<string, string>): string {
  return `${QUEUE}?${new URLSearchParams(params).toString()}`;
}

function fmtDate(d: Date): string {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function StatCard({
  href,
  count,
  label,
}: {
  href: string;
  count: number;
  label: string;
}) {
  return (
    <Link
      href={href}
      className="flex flex-col gap-1 rounded-xl border border-zinc-200 bg-white p-4 transition hover:border-brand-500 hover:bg-brand-50/40"
    >
      <span className="text-2xl font-semibold tabular-nums text-zinc-900">{count}</span>
      <span className="text-xs font-medium uppercase tracking-wide text-zinc-500">{label}</span>
    </Link>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="py-6 text-center text-sm text-zinc-400">{children}</p>;
}

/** Compact "3 call · 1 email" line from a per-kind count map. */
function kindsSummary(byKind: ActivityActorCount['byKind']): string {
  const parts = ACTIVITY_KINDS.filter((k) => byKind[k] > 0).map(
    (k) => `${byKind[k]} ${ACTIVITY_KIND_LABELS[k].toLowerCase()}`,
  );
  return parts.length ? parts.join(' · ') : '—';
}

function BlockerColumn({
  title,
  hint,
  href,
  dealers,
  metric,
}: {
  title: string;
  hint: string;
  href: string;
  dealers: BlockerDealer[];
  metric: (d: BlockerDealer) => string | null;
}) {
  const shown = dealers.slice(0, 5);
  const rest = dealers.length - shown.length;
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4">
      <div className="flex items-baseline justify-between">
        <Link href={href} className="text-sm font-semibold text-zinc-900 transition hover:text-brand-700">
          {title}
        </Link>
        <span
          className={cn(
            'text-lg font-semibold tabular-nums',
            dealers.length > 0 ? 'text-amber-700' : 'text-zinc-400',
          )}
        >
          {dealers.length}
        </span>
      </div>
      <p className="mt-0.5 text-xs text-zinc-500">{hint}</p>
      {shown.length === 0 ? (
        <p className="mt-3 text-xs text-zinc-400">Nothing here — nice.</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {shown.map((d) => {
            const m = metric(d);
            return (
              <li
                key={d.id}
                className="flex flex-col gap-0.5 border-b border-zinc-100 pb-2 last:border-0 last:pb-0"
              >
                <div className="flex items-center justify-between gap-2">
                  <Link
                    href={`/dealerships/${d.id}`}
                    className="truncate text-sm font-medium text-brand-700 hover:underline"
                  >
                    {d.name}
                  </Link>
                  {d.pipelineStage ? <PipelineStageBadge stage={d.pipelineStage} /> : null}
                </div>
                <span className="text-xs text-zinc-500">
                  {d.ownerName ?? 'Unassigned'}
                  {m ? ` · ${m}` : ''}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {rest > 0 ? (
        <Link
          href={href}
          className="mt-3 inline-block text-xs font-medium text-zinc-500 transition hover:text-brand-700"
        >
          +{rest} more →
        </Link>
      ) : null}
    </div>
  );
}

export function PipelineDashboardView({ data }: { data: PipelineDashboard }) {
  const { funnel, byOwner, activity, blockers } = data;

  return (
    <div className="flex flex-col gap-6">
      {/* Funnel — N-by-stage over prospects, with the converted (won) count. */}
      <Section
        title="Funnel"
        variant="card"
        actions={
          <span className="text-xs text-zinc-500">
            <Link href={queueHref({ status: 'prospect' })} className="hover:text-brand-700">
              {funnel.totalProspects} prospects
            </Link>{' '}
            ·{' '}
            <Link href={QUEUE} className="hover:text-brand-700">
              {funnel.won} won
            </Link>
          </span>
        }
      >
        {funnel.totalProspects === 0 ? (
          <Empty>No prospects in the pipeline yet.</Empty>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {funnel.stages.map((s) => (
              <StatCard
                key={s.stage}
                href={queueHref({ status: 'prospect', stage: s.stage })}
                count={s.count}
                label={s.label}
              />
            ))}
          </div>
        )}
      </Section>

      {/* By owner — workload + stage breakdown per rep. */}
      <Section title="By owner" variant="card">
        {byOwner.length === 0 ? (
          <Empty>No prospects assigned yet.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-200 text-left text-xs uppercase tracking-wide text-zinc-500">
                  <th className="py-2 pr-4 font-semibold">Owner</th>
                  <th className="py-2 pr-4 text-right font-semibold">Prospects</th>
                  <th className="py-2 font-semibold">Stages</th>
                </tr>
              </thead>
              <tbody>
                {byOwner.map((o) => (
                  <tr key={o.ownerId ?? 'unassigned'} className="border-b border-zinc-100 last:border-0">
                    <td className="py-2 pr-4 font-medium text-zinc-900">{o.ownerName}</td>
                    <td className="py-2 pr-4 text-right tabular-nums text-zinc-900">{o.total}</td>
                    <td className="py-2">
                      <div className="flex flex-wrap gap-1">
                        {PIPELINE_STAGES.filter((st) => o.byStage[st] > 0).map((st) => (
                          <span
                            key={st}
                            className="inline-flex items-center gap-1 rounded-full border border-zinc-200 bg-zinc-50 px-2 py-0.5 text-xs text-zinc-600"
                          >
                            {PIPELINE_STAGE_LABELS[st]}
                            <span className="font-semibold tabular-nums text-zinc-900">
                              {o.byStage[st]}
                            </span>
                          </span>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {/* Activity — touches per rep over rolling last-7 / last-30-day windows. */}
      <Section
        title="Activity"
        variant="card"
        actions={<span className="text-xs text-zinc-500">Rolling windows</span>}
      >
        {activity.length === 0 ? (
          <Empty>No activity logged in the last 30 days.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-200 text-left text-xs uppercase tracking-wide text-zinc-500">
                  <th className="py-2 pr-4 font-semibold">Rep</th>
                  <th className="py-2 pr-4 text-right font-semibold">This week</th>
                  <th className="py-2 pr-4 text-right font-semibold">Last 30d</th>
                  <th className="py-2 font-semibold">Breakdown</th>
                </tr>
              </thead>
              <tbody>
                {activity.map((a) => (
                  <tr key={a.actorId ?? 'unknown'} className="border-b border-zinc-100 last:border-0">
                    <td className="py-2 pr-4 font-medium text-zinc-900">{a.actorName}</td>
                    <td className="py-2 pr-4 text-right tabular-nums text-zinc-900">{a.thisWeek}</td>
                    <td className="py-2 pr-4 text-right tabular-nums text-zinc-900">{a.last30}</td>
                    <td className="py-2 text-zinc-500">{kindsSummary(a.byKind)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {/* Blockers — the "why isn't this moving" lists (decision.md D3). */}
      <Section title="Blockers" variant="card">
        <div className="grid gap-4 lg:grid-cols-3">
          <BlockerColumn
            title="Stalled"
            hint="21+ days in the same stage"
            href={queueHref({ status: 'prospect' })}
            dealers={blockers.stalled}
            metric={(d) => (d.stageChangedAt ? `since ${fmtDate(d.stageChangedAt)}` : null)}
          />
          <BlockerColumn
            title="Stale"
            hint="14+ days without a touch"
            href={queueHref({ status: 'prospect', idle: '1' })}
            dealers={blockers.stale}
            metric={(d) => (d.lastContactedAt ? `last ${fmtDate(d.lastContactedAt)}` : 'never contacted')}
          />
          <BlockerColumn
            title="Overdue"
            hint="past-due commitment"
            href={queueHref({ status: 'prospect', due: 'overdue' })}
            dealers={blockers.overdue}
            metric={(d) => (d.nextActionAt ? `due ${d.nextActionAt}` : null)}
          />
        </div>
      </Section>
    </div>
  );
}
