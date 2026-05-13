'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  Controller,
  useForm,
  useWatch,
  type UseFormRegisterReturn,
} from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Combobox } from '@/components/ui/combobox';
import { Dialog } from '@/components/ui/dialog';
import { toast } from '@/components/ui/toaster';
import { toLegacyResult } from '@/lib/actions/legacy-result';
import {
  createQuote,
  previewQuotePdf,
  sendQuote,
  setQuoteInputs,
} from '@/features/quotes/actions';
import type { Dealer } from '@/features/schedule/queries';
import type { QuoteStatus } from '@/features/quotes/queries';
import type { ServiceItem } from '@/features/services/queries';
import {
  computeQuote,
  DEFAULT_QUOTE_INPUTS,
  MAX_DOLLARS,
  QuoteInputsError,
  quoteInputsSchema,
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

/** Resolved Quote recipient for the Send confirm dialog (edit-mode only).
 *  Pre-resolved server-side so the dialog can render the recipient email
 *  without a round-trip; `error` is forwarded into the disabled-Send copy. */
export type Recipient = { email: string; firstName: string } | { error: string };

type Props = {
  dealers: Dealer[];
  catalog: ServiceItem[];
  initialDealerId: number | null;
  initialCampaignId: number | null;
  /** When set, the composer hydrates from this row and saves through
   *  `setQuoteInputs` (UPDATE) instead of `createQuote` (INSERT). */
  initial?: InitialQuote;
  /** Edit-mode only. Drives the Send confirm dialog. */
  recipient?: Recipient;
};

const inputClass =
  'w-full min-w-0 rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm text-stone-800 outline-none transition focus:border-accent focus:ring-3 focus:ring-accent/20';
const labelClass = 'text-xs font-medium text-stone-600';
const fieldClass = 'flex flex-col gap-1';

const RETRIEVAL_BRACKETS = [0, 100, 200, 300, 400] as const;

// Form-only schema: wraps the persisted `quoteInputsSchema` with the two
// fields that exist only in the composer (`dealerId` for create-mode, plus
// the tax override). Server-side `setQuoteInputs` / `createQuote` still
// receive `inputs` as a JSON string and `tax` / `dealerId` as separate
// FormData entries — the schema split here just keeps RHF honest about
// what's a Quote field vs. what's composer chrome.
const quoteFormSchema = quoteInputsSchema.extend({
  dealerId: z.number().int().positive().nullable(),
  taxOverride: z.number().min(0).max(MAX_DOLLARS),
});
type QuoteFormValues = z.infer<typeof quoteFormSchema>;

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
  recipient,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [sendPending, startSendTransition] = useTransition();
  const [previewPending, startPreviewTransition] = useTransition();

  const isEdit = initial != null;
  const isReadOnly = isEdit && initial.status !== 'draft';
  const canSend = isEdit && initial.status === 'draft';

  const defaultValues = useMemo<QuoteFormValues>(
    () => ({
      ...(initial?.inputs ?? DEFAULT_QUOTE_INPUTS),
      dealerId: initial?.dealerId ?? initialDealerId,
      taxOverride: initial?.tax ?? 0,
    }),
    [initial, initialDealerId],
  );

  const form = useForm<QuoteFormValues>({
    resolver: zodResolver(quoteFormSchema),
    defaultValues,
    mode: 'onChange',
  });
  const { register, control, handleSubmit, formState, reset } = form;
  const { errors, isDirty } = formState;

  // Preview state. `pdfUrl` cleared on every open so the user always sees the
  // latest persisted snapshot — stale state would be worse than a half-second
  // load shimmer.
  const [previewOpen, setPreviewOpen] = useState(false);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [confirmSendOpen, setConfirmSendOpen] = useState(false);

  const dealerOptions = useMemo(
    () => dealers.map((d) => ({ value: String(d.id), label: dealerLabel(d) })),
    [dealers],
  );

  // Subscribe to all form values so the computed table updates live as the
  // coach edits. `useWatch` (not `watch()`) is the subscription-based variant
  // — it plays well with the React Compiler and only re-renders this hook's
  // scope, not the entire form tree.
  const watched = useWatch({ control, defaultValue: defaultValues });

  // Live computation — uses the same pure function the server runs at
  // setQuoteInputs / createQuote time, so the UI never drifts from what
  // gets persisted. Catches validation errors so adversarial input doesn't
  // crash the render. `quoteFormSchema` already validates inputs at submit
  // time; this catch handles the keystroke window where the form value is
  // briefly out of range.
  const computed = useMemo(() => {
    try {
      return {
        ok: true as const,
        out: computeQuote(
          extractInputs(watched),
          catalog,
          watched.taxOverride ?? 0,
        ),
      };
    } catch (err) {
      const msg = err instanceof QuoteInputsError ? err.message : 'Invalid inputs.';
      return { ok: false as const, error: msg };
    }
  }, [watched, catalog]);
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

  const onSaveDraft = handleSubmit(
    (values) => {
      if (isReadOnly) return;
      if (!values.dealerId) {
        toast.error('Pick a dealer first.');
        return;
      }
      if (!computed.ok) {
        toast.error(computed.error);
        return;
      }
      startTransition(async () => {
        const fd = new FormData();
        fd.set('inputs', JSON.stringify(extractInputs(values)));
        fd.set('tax', String(values.taxOverride));
        if (initial?.quoteId) {
          fd.set('quoteId', String(initial.quoteId));
          const result = toLegacyResult(await setQuoteInputs(fd));
          if ('ok' in result) {
            toast.success('Quote saved');
            // Reset defaultValues to the just-saved snapshot so RHF's
            // `isDirty` flips back to false until the next edit. Send
            // gating relies on this — otherwise the very next render
            // would still see `isDirty=true` against the old defaults.
            reset(values);
            router.refresh();
          } else {
            toast.error(result.error);
          }
          return;
        }
        fd.set('dealerId', String(values.dealerId));
        const result = toLegacyResult<{ ok: true; quoteId: number }>(await createQuote(fd));
        if ('ok' in result) {
          toast.success(`Draft saved (quote #${result.quoteId})`);
          router.push(`/quotes/${result.quoteId}`);
        } else {
          toast.error(result.error);
        }
      });
    },
    () => {
      // Resolver-rejected submit — surface the first field error as a toast
      // so a user who tabs past inline errors still sees feedback. Inline
      // per-field messages stay visible alongside.
      const firstError = Object.values(errors).find((e) => e?.message)?.message;
      toast.error(typeof firstError === 'string' ? firstError : 'Fix the highlighted fields.');
    },
  );

  function onPreview() {
    if (!initial?.quoteId) return;
    setPreviewOpen(true);
    setPdfUrl(null);
    setPreviewError(null);
    startPreviewTransition(async () => {
      const fd = new FormData();
      fd.set('quoteId', String(initial.quoteId));
      const result = toLegacyResult<{ ok: true; dataUrl: string }>(await previewQuotePdf(fd));
      if ('ok' in result) {
        setPdfUrl(result.dataUrl);
      } else {
        setPreviewError(result.error);
      }
    });
  }

  function onSend() {
    if (!canSend || !initial?.quoteId) return;
    startSendTransition(async () => {
      const fd = new FormData();
      fd.set('quoteId', String(initial.quoteId));
      const result = toLegacyResult(await sendQuote(fd));
      if ('ok' in result) {
        setConfirmSendOpen(false);
        toast.success('Quote sent');
        // router.refresh() re-hydrates the page with the new `sent` status,
        // which flips `isReadOnly=true` and hides the Save / Send buttons.
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  const recipientEmail =
    recipient && 'email' in recipient ? recipient.email : null;
  const recipientErrorMessage =
    recipient && 'error' in recipient ? recipient.error : null;
  // Confirm dialog must show the persisted-snapshot numbers, not the live
  // computed ones — `sendQuote` emits from the saved jsonb, so live numbers
  // would lie to the coach when the form is dirty.
  const persistedLineCount = initial?.lineItems.length ?? 0;
  const persistedTotal = initial?.total ?? 0;

  return (
    <>
      {isReadOnly && initial && (
        <div className="rounded-xl border border-stone-200 bg-stone-50 px-4 py-3 text-sm text-stone-700">
          This quote is <span className="font-semibold capitalize">{initial.status}</span> and can
          no longer be edited.
        </div>
      )}
      <fieldset disabled={isReadOnly} className="contents">
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
              <Controller
                control={control}
                name="dealerId"
                render={({ field }) => (
                  <Combobox
                    options={dealerOptions}
                    value={field.value ? String(field.value) : ''}
                    onChange={(v) => field.onChange(v ? Number(v) : null)}
                    placeholder="Pick a dealer…"
                    ariaLabel="Dealer"
                  />
                )}
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
            label="Audience size"
            min={0}
            registration={register('audienceSize', { valueAsNumber: true })}
            error={errors.audienceSize?.message}
            help="Default 500. Each record over 500 adds an additional-contact line."
          />
          <NumberField
            label="Event days"
            min={1}
            registration={register('eventDays', { valueAsNumber: true })}
            error={errors.eventDays?.message}
            help="Each day beyond day one adds an additional-day line."
          />

          <div className="grid grid-cols-3 gap-2">
            <NumberField
              label="BDC calls"
              min={0}
              registration={register('bdcCallCount', { valueAsNumber: true })}
              error={errors.bdcCallCount?.message}
            />
            <NumberField
              label="Letters"
              min={0}
              registration={register('letterCount', { valueAsNumber: true })}
              error={errors.letterCount?.message}
            />
            <NumberField
              label="Digital"
              min={0}
              registration={register('digitalCount', { valueAsNumber: true })}
              error={errors.digitalCount?.message}
            />
          </div>

          <Controller
            control={control}
            name="recordRetrievalAmount"
            render={({ field }) => (
              <fieldset className={fieldClass}>
                <legend className={labelClass}>Record retrieval bracket</legend>
                <div className="mt-1 flex flex-wrap items-center gap-1">
                  {RETRIEVAL_BRACKETS.map((amount) => {
                    const active = field.value === amount;
                    return (
                      <button
                        key={amount}
                        type="button"
                        aria-pressed={active}
                        onClick={() => field.onChange(amount)}
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
            )}
          />

          <NumberField
            label="Travel ($)"
            min={0}
            step="0.01"
            registration={register('travelAmount', { valueAsNumber: true })}
            error={errors.travelAmount?.message}
            help="Hotel + mileage + air. Coach-typed dollar amount."
          />
          <TextAreaField
            label="Travel notes"
            registration={register('travelNotes')}
            error={errors.travelNotes?.message}
            placeholder="Hotel 2 nights + flight + mileage"
          />

          <TextAreaField
            label="Quote notes (rendered on PDF)"
            registration={register('quoteNotes')}
            error={errors.quoteNotes?.message}
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
                        className="w-28 rounded border border-stone-200 bg-white px-2 py-1 text-right text-sm tabular-nums focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
                        {...register('taxOverride', { valueAsNumber: true })}
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
      </section>
      </div>
      </fieldset>

      {/* Buttons row lives OUTSIDE the disabled fieldset so Preview stays
       *  clickable on sent (read-only) quotes — `<fieldset disabled>` would
       *  otherwise cascade through the browser and disable any descendant
       *  <button>. Save / Send still gate themselves via `!isReadOnly` and
       *  `canSend`, so they correctly hide when the quote isn't a draft. */}
      <div className="mt-2 flex flex-wrap items-center justify-end gap-2">
        {isEdit && (
          <button
            type="button"
            onClick={onPreview}
            disabled={previewPending}
            className="rounded-lg border border-stone-300 bg-white px-4 py-1.5 text-xs font-semibold text-navy transition hover:border-navy disabled:cursor-not-allowed disabled:opacity-60"
          >
            {previewPending ? 'Loading…' : 'Preview PDF'}
          </button>
        )}
        {!isReadOnly && (
          <button
            type="button"
            onClick={onSaveDraft}
            disabled={pending || !computed.ok}
            className="rounded-lg bg-navy px-4 py-1.5 text-xs font-semibold text-white transition hover:bg-navy-light disabled:cursor-not-allowed disabled:opacity-60"
          >
            {pending ? 'Saving…' : isEdit ? 'Save Quote' : 'Save Draft'}
          </button>
        )}
        {canSend && (
          <button
            type="button"
            onClick={() => setConfirmSendOpen(true)}
            disabled={!recipientEmail || isDirty || pending || sendPending}
            title={
              isDirty
                ? 'Save changes before sending — the email emits the saved quote, not the unsaved edits.'
                : recipientErrorMessage ??
                  (recipientEmail ? `Send Quote to ${recipientEmail}` : undefined)
            }
            className="rounded-lg bg-status-green px-4 py-1.5 text-xs font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Send Quote
          </button>
        )}
      </div>
      {canSend && isDirty && (
        <p className="mt-1 text-right text-[11px] text-stone-500">
          You have unsaved changes — save before sending.
        </p>
      )}
      {canSend && !isDirty && recipientErrorMessage && (
        <p className="mt-1 text-right text-[11px] text-status-red">
          Send disabled: {recipientErrorMessage}
        </p>
      )}

      <PreviewDialog
        open={previewOpen}
        onClose={setPreviewOpen}
        loading={previewPending}
        pdfUrl={pdfUrl}
        error={previewError}
      />

      <ConfirmSendDialog
        open={confirmSendOpen}
        onClose={setConfirmSendOpen}
        pending={sendPending}
        recipientEmail={recipientEmail}
        lineCount={persistedLineCount}
        total={persistedTotal}
        onConfirm={onSend}
      />
    </>
  );
}

function PreviewDialog({
  open,
  onClose,
  loading,
  pdfUrl,
  error,
}: {
  open: boolean;
  onClose: (next: false) => void;
  loading: boolean;
  pdfUrl: string | null;
  error: string | null;
}) {
  return (
    <Dialog.Root open={open} onClose={onClose}>
      <Dialog.Backdrop />
      <Dialog.Panel className="w-full max-w-4xl">
        <Dialog.Title>Quote preview</Dialog.Title>
        <Dialog.Description>
          PDF rendered from the saved snapshot. Matches what gets emailed on
          Send.
        </Dialog.Description>
        <div className="mt-4 h-[70vh] overflow-hidden rounded-lg border border-stone-200 bg-stone-50">
          {error ? (
            <div className="flex h-full items-center justify-center px-6 text-center text-sm text-status-red">
              {error}
            </div>
          ) : loading || !pdfUrl ? (
            <div className="flex h-full items-center justify-center text-sm text-stone-500">
              Rendering PDF…
            </div>
          ) : (
            <iframe
              title="Quote PDF preview"
              src={pdfUrl}
              className="h-full w-full"
            />
          )}
        </div>
      </Dialog.Panel>
    </Dialog.Root>
  );
}

function ConfirmSendDialog({
  open,
  onClose,
  pending,
  recipientEmail,
  lineCount,
  total,
  onConfirm,
}: {
  open: boolean;
  onClose: (next: false) => void;
  pending: boolean;
  recipientEmail: string | null;
  lineCount: number;
  total: number;
  onConfirm: () => void;
}) {
  return (
    <Dialog.Root open={open} onClose={onClose}>
      <Dialog.Backdrop />
      <Dialog.Panel>
        <Dialog.Title>Send this quote?</Dialog.Title>
        <Dialog.Description>
          Once sent, the quote is locked and cannot be edited.
        </Dialog.Description>
        <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
          <dt className="text-stone-500">Recipient</dt>
          <dd className="font-medium text-stone-800">
            {recipientEmail ?? <span className="text-status-red">none</span>}
          </dd>
          <dt className="text-stone-500">Line items</dt>
          <dd className="tabular-nums text-stone-800">{lineCount}</dd>
          <dt className="text-stone-500">Total</dt>
          <dd className="font-semibold tabular-nums text-stone-800">
            {fmtMoney(total)}
          </dd>
        </dl>
        <div className="mt-6 flex items-center justify-end gap-2">
          <Dialog.Close className="rounded-lg border border-stone-300 bg-white px-4 py-1.5 text-xs font-semibold text-stone-700 transition hover:border-navy hover:text-navy">
            Cancel
          </Dialog.Close>
          <button
            type="button"
            onClick={onConfirm}
            disabled={pending || !recipientEmail}
            className="rounded-lg bg-status-green px-4 py-1.5 text-xs font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {pending ? 'Sending…' : 'Send'}
          </button>
        </div>
      </Dialog.Panel>
    </Dialog.Root>
  );
}

function dealerLabel(d: Dealer): string {
  if (d.status === 'prospect') return `${d.name} (prospect)`;
  return d.name;
}

/** Project the form's `QuoteInputs` subset — drops the composer-only
 *  `dealerId` and `taxOverride` fields so the result lines up with the
 *  jsonb shape `setQuoteInputs` / `createQuote` persist. Tolerates the
 *  `Partial` shape RHF's `useWatch` returns mid-reset by falling back to
 *  `DEFAULT_QUOTE_INPUTS` per-field — the next render resolves. */
function extractInputs(values: Partial<QuoteFormValues>): QuoteInputs {
  return {
    audienceSize: values.audienceSize ?? DEFAULT_QUOTE_INPUTS.audienceSize,
    eventDays: values.eventDays ?? DEFAULT_QUOTE_INPUTS.eventDays,
    bdcCallCount: values.bdcCallCount ?? DEFAULT_QUOTE_INPUTS.bdcCallCount,
    letterCount: values.letterCount ?? DEFAULT_QUOTE_INPUTS.letterCount,
    digitalCount: values.digitalCount ?? DEFAULT_QUOTE_INPUTS.digitalCount,
    recordRetrievalAmount:
      values.recordRetrievalAmount ?? DEFAULT_QUOTE_INPUTS.recordRetrievalAmount,
    travelAmount: values.travelAmount ?? DEFAULT_QUOTE_INPUTS.travelAmount,
    travelNotes: values.travelNotes ?? DEFAULT_QUOTE_INPUTS.travelNotes,
    quoteNotes: values.quoteNotes ?? DEFAULT_QUOTE_INPUTS.quoteNotes,
  };
}

function NumberField({
  label,
  registration,
  min,
  step,
  help,
  error,
}: {
  label: string;
  registration: UseFormRegisterReturn;
  min?: number;
  step?: string;
  help?: string;
  error?: string;
}) {
  const id = `qf-${registration.name}`;
  return (
    <label className={fieldClass} htmlFor={id}>
      <span className={labelClass}>{label}</span>
      <input
        id={id}
        type="number"
        min={min ?? 0}
        step={step ?? '1'}
        className={inputClass}
        {...registration}
      />
      {error ? (
        <span className="text-[11px] text-status-red">{error}</span>
      ) : help ? (
        <span className="text-[11px] text-stone-500">{help}</span>
      ) : null}
    </label>
  );
}

function TextAreaField({
  label,
  registration,
  placeholder,
  error,
}: {
  label: string;
  registration: UseFormRegisterReturn;
  placeholder?: string;
  error?: string;
}) {
  const id = `qf-${registration.name}`;
  return (
    <label className={fieldClass} htmlFor={id}>
      <span className={labelClass}>{label}</span>
      <textarea
        id={id}
        placeholder={placeholder}
        rows={2}
        className={`${inputClass} resize-y`}
        {...registration}
      />
      {error ? <span className="text-[11px] text-status-red">{error}</span> : null}
    </label>
  );
}
