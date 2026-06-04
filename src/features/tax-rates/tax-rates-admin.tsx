'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Can } from '@/components/auth/can';
import { toast } from '@/components/ui/toaster';
import { toLegacyResult } from '@/lib/actions/legacy-result';
import type { TaxRate } from '@/lib/tax-rates';
import { updateTaxRate } from './actions';

// 0065 — admin editor for the seeded province→sales-tax-rate table. Edit-only
// (the 13 rows are fixed), so no add/archive — just a rate input + Save per
// province. Modeled on `schedule/lookup-admin.tsx`.

const inputClass =
  'min-w-0 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 outline-none transition focus:border-brand-500 focus:ring-3 focus:ring-brand-500/20';

const buttonClass =
  'rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs font-semibold text-zinc-900 transition hover:border-brand-500 hover:text-brand-700 disabled:cursor-not-allowed disabled:opacity-50';

export function TaxRatesAdmin({ items }: { items: TaxRate[] }) {
  return (
    <section className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-[0_1px_4px_rgba(15,30,60,0.08)]">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-sans font-bold tracking-tight text-2xl text-brand-700">
          Sales Tax Rates
        </h2>
        <span className="rounded-full bg-brand-50 px-2.5 py-1 text-xs font-semibold text-brand-700">
          {items.length}
        </span>
      </div>
      <p className="mt-1 text-xs text-zinc-500">
        Combined GST/HST/PST/QST percent applied to a quote, by the dealer&rsquo;s province.
      </p>

      <div className="mt-4 flex flex-col divide-y divide-zinc-200">
        {items.map((item) => (
          <TaxRateRow key={item.province} item={item} />
        ))}
      </div>
    </section>
  );
}

function TaxRateRow({ item }: { item: TaxRate }) {
  const router = useRouter();
  const [rate, setRate] = useState(item.rate);
  const [pending, startTransition] = useTransition();
  const dirty = rate.trim() !== item.rate;

  function save() {
    if (!dirty) return;
    startTransition(async () => {
      const fd = new FormData();
      fd.set('province', item.province);
      fd.set('rate', rate.trim());
      const result = toLegacyResult(await updateTaxRate(fd));
      if ('ok' in result) {
        toast.success(`${item.label} rate saved`);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <div className="flex min-h-14 items-center gap-2 py-2">
      <span className="min-w-0 flex-1 truncate text-sm font-medium text-zinc-900">
        {item.label} <span className="text-zinc-400">({item.province})</span>
      </span>
      <Can capability="lookup:edit">
        <input
          type="number"
          min={0}
          max={30}
          step={0.001}
          value={rate}
          onChange={(e) => setRate(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') save();
            if (e.key === 'Escape') setRate(item.rate);
          }}
          aria-label={`${item.label} tax rate (percent)`}
          className={`${inputClass} w-24 text-right`}
        />
        <span className="text-sm text-zinc-500">%</span>
        <button
          type="button"
          onClick={save}
          disabled={pending || !dirty}
          className={buttonClass}
        >
          Save
        </button>
      </Can>
    </div>
  );
}
