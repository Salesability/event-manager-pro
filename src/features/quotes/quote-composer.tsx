'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Combobox } from '@/components/ui/combobox';
import { toast } from '@/components/ui/toaster';
import { toLegacyResult } from '@/lib/actions/legacy-result';
import { createQuote, setQuoteInputs } from '@/features/quotes/actions';
import type { Dealer } from '@/features/schedule/queries';
import type { QuoteStatus } from '@/features/quotes/queries';
import type { ServiceItem } from '@/features/services/queries';
import {
  computeQuote,
  DEFAULT_QUOTE_INPUTS,
  QuoteInputsError,
  type ComputedLine,
  type QuoteInputs,
} from '@/lib/quotes/pricing';

// Quote composer — structured-input calculator (per 0035 plan Phase 3 OQ #2
// resolution). Coach edits the small input set on the left; the computed
// line-items table is read-only output on the right. Saving a fresh quote
// creates a draft row and routes to `/quotes/<id>` (edit-mode home); saving
// from edit-mode hits `setQuoteInputs` (draft-only, atomic guarded UPDATE
// per actions.ts:281-289) and stays put. Non-draft statuses render
// read-only — server-side guard is the real defence.

export type InitialQuote = {
  quoteId: number;
  dealerId: number;
  dealerName: string;
  inputs: QuoteInputs;
  lineItems: ComputedLine[];
  subtotal: number;
  /** Tax dollar amount (not %). Matches `computeQuote`'s `taxOverride` and
   *  the FormData `tax` field consumed by `setQuoteInputs`. */
  tax: number;
  total: number;
  status: QuoteStatus;
};

type Props = {
  dealers: Dealer[];
  catalog: ServiceItem[];
  initialDealerId: number | null;
  initialCampaignId: number | null;
  /** When set, the composer hydrates from this row and saves through
   *  `setQuoteInputs` (UPDATE) instead of `createQuote` (INSERT). */
  initial?: InitialQuote;
};

const inputClass =
  'w-full min-w-0 rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm text-stone-800 outline-none transition focus:border-accent focus:ring-3 focus:ring-accent/20';
const labelClass = 'text-xs font-medium text-stone-600';
const fieldClass = 'flex flex-col gap-1';

const RETRIEVAL_BRACKETS = [0, 100, 200, 300, 400] as const;

const currency = new Intl.NumberFormat('en-CA', {
  style: 'currency',
  currency: 'CAD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function fmtMoney(n: number): string {
  return currency.format(Number.isFinite(n) ? n : 0);
}

export function QuoteComposer({
  dealers,
  catalog,
  initialDealerId,
  initialCampaignId,
  initial,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const isEdit = initial != null;
  const isReadOnly = isEdit && initial.status !== 'draft';

  const [dealerId, setDealerId] = useState<number | null>(initial?.dealerId ?? initialDealerId);
  const [inputs, setInputs] = useState<QuoteInputs>(initial?.inputs ?? DEFAULT_QUOTE_INPUTS);
  const [taxOverride, setTaxOverride] = useState<number>(initial?.tax ?? 0);

  const dealerOptions = useMemo(
    () => dealers.map((d) => ({ value: String(d.id), label: dealerLabel(d) })),
    [dealers],
  );

  // Live computation — uses the same pure function the server runs at
  // setQuoteInputs / createQuote time, so the UI never drifts from what
  // gets persisted. Catches validation errors so adversarial input doesn't
  // crash the render.
  const computed = useMemo(() => {
    try {
      return { ok: true as const, out: computeQuote(inputs, catalog, taxOverride) };
    } catch (err) {
      const msg = err instanceof QuoteInputsError ? err.message : 'Invalid inputs.';
      return { ok: false as const, error: msg };
    }
  }, [inputs, catalog, taxOverride]);
  const display = isReadOnly && initial
    ? {
        ok: true as const,
        lines: initial.lineItems,
        subtotal: initial.subtotal,
        tax: initial.tax,
        total: initial.total,
      }
    : computed.ok
      ? {
          ok: true as const,
          lines: computed.out.lines,
          subtotal: computed.out.subtotal,
          tax: computed.out.tax,
          total: computed.out.total,
        }
      : computed;

  function patch<K extends keyof QuoteInputs>(key: K, value: QuoteInputs[K]) {
    setInputs((prev) => ({ ...prev, [key]: value }));
  }

  function onSaveDraft() {
    if (isReadOnly) return;
    if (!dealerId) {
      toast.error('Pick a dealer first.');
      return;
    }
    if (!computed.ok) {
      toast.error(computed.error);
      return;
    }
    startTransition(async () => {
      const fd = new FormData();
      fd.set('inputs', JSON.stringify(inputs));
      fd.set('tax', String(taxOverride));
      if (initial?.quoteId) {
        fd.set('quoteId', String(initial.quoteId));
        const result = toLegacyResult(await setQuoteInputs(fd));
        if ('ok' in result) {
          toast.success('Quote saved');
          router.refresh();
        } else {
          toast.error(result.error);
        }
        return;
      }
      fd.set('dealerId', String(dealerId));
      const result = toLegacyResult<{ ok: true; quoteId: number }>(await createQuote(fd));
      if ('ok' in result) {
        toast.success(`Draft saved (quote #${result.quoteId})`);
        router.push(`/quotes/${result.quoteId}`);
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <fieldset disabled={isReadOnly} className="contents">
      {isReadOnly && initial && (
        <div className="rounded-xl border border-stone-200 bg-stone-50 px-4 py-3 text-sm text-stone-700">
          This quote is <span className="font-semibold capitalize">{initial.status}</span> and can
          no longer be edited.
        </div>
      )}
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <section className="flex flex-col gap-4 rounded-2xl border border-stone-200 bg-white p-5 shadow-[0_1px_4px_rgba(15,30,60,0.08)]">
        <div className="flex flex-col gap-3">
          <h2 className="font-display text-xl text-navy">Quote header</h2>
          <div className={fieldClass}>
            <span className={labelClass}>Dealer</span>
            {isEdit ? (
              // The composer wires `setQuoteInputs` only; dealer swap on an
              // existing quote routes through `setQuoteDealer` (separate
              // setter, not surfaced in this phase). Render a static label
              // so a user can't think they're editing the dealer mid-save.
              <div className="rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-sm text-stone-800">
                {initial.dealerName}
              </div>
            ) : (
              <Combobox
                options={dealerOptions}
                value={dealerId ? String(dealerId) : ''}
                onChange={(v) => setDealerId(v ? Number(v) : null)}
                placeholder="Pick a dealer…"
                ariaLabel="Dealer"
              />
            )}
          </div>
          {initialCampaignId ? (
            <p className="text-xs text-stone-500">
              Tied to campaign #{initialCampaignId}. Full campaign-linkage wiring lands later.
            </p>
          ) : null}
        </div>

        <div className="flex flex-col gap-3">
          <h2 className="font-display text-xl text-navy">Inputs</h2>

          <NumberField
            name="audienceSize"
            label="Audience size"
            value={inputs.audienceSize}
            min={0}
            onChange={(n) => patch('audienceSize', n)}
            help="Default 500. Each record over 500 adds an additional-contact line."
          />
          <NumberField
            name="eventDays"
            label="Event days"
            value={inputs.eventDays}
            min={1}
            onChange={(n) => patch('eventDays', Math.max(1, n))}
            help="Each day beyond day one adds an additional-day line."
          />

          <div className="grid grid-cols-3 gap-2">
            <NumberField
              name="bdcCallCount"
              label="BDC calls"
              value={inputs.bdcCallCount}
              min={0}
              onChange={(n) => patch('bdcCallCount', n)}
            />
            <NumberField
              name="letterCount"
              label="Letters"
              value={inputs.letterCount}
              min={0}
              onChange={(n) => patch('letterCount', n)}
            />
            <NumberField
              name="digitalCount"
              label="Digital"
              value={inputs.digitalCount}
              min={0}
              onChange={(n) => patch('digitalCount', n)}
            />
          </div>

          <fieldset className={fieldClass}>
            <legend className={labelClass}>Record retrieval bracket</legend>
            <div className="mt-1 flex flex-wrap items-center gap-1">
              {RETRIEVAL_BRACKETS.map((amount) => {
                const active = inputs.recordRetrievalAmount === amount;
                return (
                  <button
                    key={amount}
                    type="button"
                    aria-pressed={active}
                    onClick={() => patch('recordRetrievalAmount', amount)}
                    className={
                      active
                        ? 'rounded-full border border-accent bg-accent/15 px-3 py-1 text-xs font-semibold text-accent'
                        : 'rounded-full border border-stone-200 bg-white px-3 py-1 text-xs font-medium text-stone-600 transition hover:border-navy hover:text-navy'
                    }
                  >
                    {amount === 0 ? 'None' : `$${amount}`}
                  </button>
                );
              })}
            </div>
          </fieldset>

          <NumberField
            name="travelAmount"
            label="Travel ($)"
            value={inputs.travelAmount}
            min={0}
            step="0.01"
            onChange={(n) => patch('travelAmount', n)}
            help="Hotel + mileage + air. Coach-typed dollar amount."
          />
          <TextAreaField
            name="travelNotes"
            label="Travel notes"
            value={inputs.travelNotes}
            onChange={(v) => patch('travelNotes', v)}
            placeholder="Hotel 2 nights + flight + mileage"
          />

          <TextAreaField
            name="quoteNotes"
            label="Quote notes (rendered on PDF)"
            value={inputs.quoteNotes}
            onChange={(v) => patch('quoteNotes', v)}
            placeholder="Anything the dealer should see in the quote PDF."
          />
        </div>
      </section>

      <section className="flex flex-col gap-4 rounded-2xl border border-stone-200 bg-white p-5 shadow-[0_1px_4px_rgba(15,30,60,0.08)]">
        <h2 className="font-display text-xl text-navy">Line items (computed)</h2>
        {display.ok ? (
          <div className="overflow-hidden rounded-xl border border-stone-200">
            <table className="w-full text-sm">
              <thead className="bg-stone-50 text-xs text-stone-500">
                <tr>
                  <th className="px-3 py-2 text-left">Item</th>
                  <th className="px-3 py-2 text-right">Qty</th>
                  <th className="px-3 py-2 text-right">Unit</th>
                  <th className="px-3 py-2 text-right">Line total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {display.lines.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-3 py-6 text-center text-xs text-stone-500">
                      No lines yet. Set inputs on the left.
                    </td>
                  </tr>
                ) : (
                  display.lines.map((l) => (
                    <tr key={l.code}>
                      <td className="px-3 py-2 align-top text-stone-800">
                        <div className="font-medium">{l.label}</div>
                        <div className="text-[10px] uppercase tracking-wide text-stone-400">
                          {l.code} <span className="ml-2">ⓘ auto</span>
                        </div>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{l.qty}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmtMoney(l.unitPrice)}</td>
                      <td className="px-3 py-2 text-right font-medium tabular-nums">
                        {fmtMoney(l.lineTotal)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
              <tfoot>
                <tr className="border-t border-stone-200 bg-stone-50/60 text-sm">
                  <td colSpan={3} className="px-3 py-2 text-right text-stone-500">
                    Subtotal
                  </td>
                  <td className="px-3 py-2 text-right font-semibold tabular-nums">
                    {fmtMoney(display.subtotal)}
                  </td>
                </tr>
                <tr className="text-sm">
                  <td colSpan={2} />
                  <td className="px-3 py-2 text-right text-stone-500">Tax override</td>
                  <td className="px-3 py-2 text-right">
                    {isReadOnly && initial ? (
                      <span className="tabular-nums">{fmtMoney(initial.tax)}</span>
                    ) : (
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        value={taxOverride}
                        onChange={(e) => setTaxOverride(Number(e.currentTarget.value) || 0)}
                        className="w-28 rounded border border-stone-200 bg-white px-2 py-1 text-right text-sm tabular-nums focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
                      />
                    )}
                  </td>
                </tr>
                <tr className="border-t border-stone-200 bg-navy text-sm text-white">
                  <td colSpan={3} className="px-3 py-2 text-right">
                    Total
                  </td>
                  <td className="px-3 py-2 text-right font-bold tabular-nums">
                    {fmtMoney(display.total)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        ) : (
          <div className="rounded-xl border border-status-red/40 bg-status-red/5 px-3 py-2 text-xs text-status-red">
            {display.error}
          </div>
        )}

        {!isReadOnly && (
          <div className="mt-2 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onSaveDraft}
              disabled={pending || !computed.ok}
              className="rounded-lg bg-navy px-4 py-1.5 text-xs font-semibold text-white transition hover:bg-navy-light disabled:cursor-not-allowed disabled:opacity-60"
            >
              {pending ? 'Saving…' : isEdit ? 'Save Quote' : 'Save Draft'}
            </button>
          </div>
        )}
      </section>
      </div>
    </fieldset>
  );
}

function dealerLabel(d: Dealer): string {
  if (d.status === 'prospect') return `${d.name} (prospect)`;
  return d.name;
}

function NumberField({
  name,
  label,
  value,
  onChange,
  min,
  step,
  help,
}: {
  name: string;
  label: string;
  value: number;
  onChange: (n: number) => void;
  min?: number;
  step?: string;
  help?: string;
}) {
  return (
    <label className={fieldClass} htmlFor={`qf-${name}`}>
      <span className={labelClass}>{label}</span>
      <input
        id={`qf-${name}`}
        type="number"
        min={min ?? 0}
        step={step ?? '1'}
        value={Number.isFinite(value) ? value : 0}
        onChange={(e) => onChange(Number(e.currentTarget.value) || 0)}
        className={inputClass}
      />
      {help ? <span className="text-[11px] text-stone-500">{help}</span> : null}
    </label>
  );
}

function TextAreaField({
  name,
  label,
  value,
  onChange,
  placeholder,
}: {
  name: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <label className={fieldClass} htmlFor={`qf-${name}`}>
      <span className={labelClass}>{label}</span>
      <textarea
        id={`qf-${name}`}
        value={value}
        onChange={(e) => onChange(e.currentTarget.value)}
        placeholder={placeholder}
        rows={2}
        className={`${inputClass} resize-y`}
      />
    </label>
  );
}
