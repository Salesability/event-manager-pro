'use client';

import type { ReactNode } from 'react';
import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Can } from '@/components/auth/can';
import { toast } from '@/components/ui/toaster';
import { toLegacyResult } from '@/lib/actions/legacy-result';
import type {
  ProvinceMappingInput,
  ProvinceMappingRow,
  TaxCodeOption,
  TaxMappingAdminData,
} from './mapping';
import { assignProvinceTaxCode } from './actions';

// 0076 — /admin/lookups province → QuickBooks tax-code mapping. Each province maps
// to a QBO tax code (single or group); QuickBooks computes the tax on pushed
// Estimates and the code's rate is adopted into the app for the quote preview.
// Replaces 0075's removed editor + the auto-apply "Pull tax codes" heuristic (the
// name matcher is now only a dropdown *suggestion*). Modeled on the removed
// `tax-rates-admin.tsx` shape (per-province row + Server Action via transition).

const cardClass =
  'rounded-2xl border border-zinc-200 bg-white p-5 shadow-[0_1px_4px_rgba(15,30,60,0.08)]';
const selectClass =
  'min-w-0 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 outline-none transition focus:border-brand-500 focus:ring-3 focus:ring-brand-500/20 disabled:cursor-not-allowed disabled:opacity-50';

export function TaxRateMapping({ data }: { data: TaxMappingAdminData }) {
  return (
    <section className={cardClass}>
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-sans font-bold tracking-tight text-2xl text-brand-700">
          Sales Tax Rates
        </h2>
        <span className="rounded-full bg-brand-50 px-2.5 py-1 text-xs font-semibold text-brand-700">
          {data.rows.length}
        </span>
      </div>
      <p className="mt-1 text-xs text-zinc-500">
        Each province maps to a QuickBooks tax code — QuickBooks computes the tax on pushed quote
        Estimates and the code&rsquo;s rate is adopted here. Group codes (Quebec GST+QST, BC GST+PST)
        are supported. A province with no code stays unmanaged (its app rate is a fallback).
      </p>

      {data.connected ? (
        <div className="mt-4 flex flex-col divide-y divide-zinc-200">
          {data.rows.map((row) => (
            <ConnectedRow key={row.province} row={row} options={data.options} />
          ))}
        </div>
      ) : (
        <DisconnectedList rows={data.rows} />
      )}
    </section>
  );
}

function ConnectedRow({ row, options }: { row: ProvinceMappingRow; options: TaxCodeOption[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function onSelect(taxCodeId: string) {
    startTransition(async () => {
      const fd = new FormData();
      fd.set('province', row.province);
      fd.set('taxCodeId', taxCodeId);
      const result = toLegacyResult(await assignProvinceTaxCode(fd));
      if ('ok' in result) {
        toast.success(`${row.label} mapping saved`);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2 py-2.5">
      <span className="min-w-40 flex-1 truncate text-sm font-medium text-zinc-900">
        {row.label} <span className="text-zinc-400">({row.province})</span>
      </span>
      <span className="w-16 text-right text-sm tabular-nums text-zinc-500">{row.appRate}%</span>
      <Can capability="lookup:edit">
        <select
          value={row.currentCodeId ?? ''}
          disabled={pending}
          onChange={(e) => onSelect(e.target.value)}
          aria-label={`${row.label} QuickBooks tax code`}
          className={`${selectClass} w-64`}
        >
          <option value="">— none (unmanaged) —</option>
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
              {o.id === row.suggestionCodeId && !row.managed ? ' (suggested)' : ''}
            </option>
          ))}
        </select>
      </Can>
      <MappingStatus row={row} />
    </div>
  );
}

function MappingStatus({ row }: { row: ProvinceMappingRow }) {
  if (row.brokenLink) return <Badge tone="amber">⚠ mapped code missing in QuickBooks</Badge>;
  if (row.drift)
    return (
      <Badge tone="amber">
        ⚠ app {row.appRate}% ≠ QB {row.currentCodeRatePct}%
      </Badge>
    );
  if (row.managed) return <Badge tone="green">managed by QuickBooks</Badge>;
  return <Badge tone="zinc">unmanaged</Badge>;
}

function Badge({ tone, children }: { tone: 'green' | 'amber' | 'zinc'; children: ReactNode }) {
  const tones = {
    green: 'bg-emerald-50 text-emerald-700',
    amber: 'bg-amber-50 text-amber-700',
    zinc: 'bg-zinc-100 text-zinc-500',
  } as const;
  return (
    <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${tones[tone]}`}>
      {children}
    </span>
  );
}

function DisconnectedList({ rows }: { rows: ProvinceMappingInput[] }) {
  return (
    <>
      <p className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-xs font-medium text-amber-700">
        Connect QuickBooks on the QuickBooks admin page to change tax-code mappings.
      </p>
      <div className="mt-2 flex flex-col divide-y divide-zinc-200">
        {rows.map((r) => (
          <div key={r.province} className="flex items-center gap-2 py-2.5">
            <span className="min-w-40 flex-1 truncate text-sm font-medium text-zinc-900">
              {r.label} <span className="text-zinc-400">({r.province})</span>
            </span>
            <span className="w-16 text-right text-sm tabular-nums text-zinc-500">{r.rate}%</span>
            <span className="rounded-full bg-zinc-100 px-2.5 py-1 text-xs font-semibold text-zinc-500">
              {r.quickbooksTaxCodeId ? 'managed by QuickBooks' : 'unmanaged'}
            </span>
          </div>
        ))}
      </div>
    </>
  );
}
