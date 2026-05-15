'use client';

import { useMemo, useState, useTransition, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { KeyValueStrip, type KeyValueItem } from '@/components/app/key-value-strip';
import { PageHeader } from '@/components/app/page-header';
import {
  Controller,
  useForm,
  useWatch,
  type UseFormRegisterReturn,
} from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Combobox, ComboboxOption, ComboboxLabel } from '@/components/catalyst/combobox';
import {
  Dialog,
  DialogDescription,
  DialogTitle,
} from '@/components/catalyst/dialog';
import {
  Field,
  FieldGroup,
  Label,
  Description,
  Legend,
  Fieldset,
} from '@/components/catalyst/fieldset';
import { FieldError } from '@/components/catalyst/field-compat';
import { Button } from '@/components/catalyst/button';
import { Input } from '@/components/catalyst/input';
import { Textarea } from '@/components/catalyst/textarea';
import { ToggleGroup, ToggleGroupItem } from '@/components/catalyst/toggle-group';
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
  /** Derived at read time — `status='sent' && sentAt + quoteValidDays < now()`.
   *  Underlying lifecycle gates still switch on `status`, but the read-only
   *  banner copy surfaces "Expired" when this is true (0044 Phase 3 Option B). */
  isExpired: boolean;
  /** Most-recent `sentAt` for the underlying row. `null` on drafts. Drives
   *  the 0046 "Send Quote" → "Re-send Quote" label flip + the validity-
   *  reset banner copy on edit of an already-sent quote. */
  sentAt: Date | null;
  /** Per-row validity window (default 30). Used by the re-send confirm
   *  dialog to show the post-send "new deadline" date. */
  quoteValidDays: number;
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
  /** Re-send only. True when the dealer's MSA is `pending` with an envelope
   *  posted to BoldSign — `sendQuote` will refuse re-send until the
   *  envelope resolves. The UI gates the button to match the server.
   *  Always false on first-send (the MSA gate only fires on re-send). */
  msaEnvelopeInFlight?: boolean;
  /** Page-level title rendered inside the sticky `<PageHeader>` the composer
   *  owns. Owned by the composer (not the page) so the composer's action
   *  buttons can ride in the same actions slot as the status badge — one
   *  row, sticky at `top-16`. */
  pageTitle: ReactNode;
  /** Optional `<PageHeader>` description (1-line summary under the title).
   *  Used on create-mode to surface the "Build a quote against the service
   *  catalog…" copy. */
  pageDescription?: ReactNode;
  /** Status badge rendered after the action buttons inside the PageHeader
   *  actions slot. Omitted on create-mode (no row, no status yet). */
  pageStatusBadge?: ReactNode;
  /** Detail-page key-value strip rendered just below the PageHeader.
   *  Omitted on create-mode. */
  keyValueItems?: KeyValueItem[];
  /** Send-history `<Section>` (server-rendered list of `quote.sent` audit
   *  rows). Rendered between the KeyValueStrip and the form body. Omitted
   *  on create-mode and on drafts. */
  sendHistorySlot?: ReactNode;
};

const labelClass = 'text-xs font-medium text-zinc-500';
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
  msaEnvelopeInFlight = false,
  pageTitle,
  pageDescription,
  pageStatusBadge,
  keyValueItems,
  sendHistorySlot,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [sendPending, startSendTransition] = useTransition();
  const [previewPending, startPreviewTransition] = useTransition();

  const isEdit = initial != null;
  // 0046: only the terminal contract artifacts lock the composer. `sent`
  // (and the derived `expired` presentation) stay editable so coaches can
  // fix pricing typos + re-send.
  const isReadOnly =
    isEdit && (initial.status === 'accepted' || initial.status === 'declined');
  // Send / Re-send is available on any non-terminal status. On `draft` it
  // reads "Send Quote"; on `sent`/`expired` it reads "Re-send Quote".
  const canSend =
    isEdit && initial.status !== 'accepted' && initial.status !== 'declined';
  const isResend = isEdit && initial.sentAt != null;

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

  // 0043 follow-up (a): composer renders the page header itself so the
  // action buttons can ride in the same `<PageHeader actions>` slot as the
  // status badge — one row, sticky at `top-16`. The buttons sit OUTSIDE the
  // disabled `<fieldset>` below by virtue of being in the actions slot
  // (which is sibling-of, not descendant-of, the fieldset); Preview / Close
  // stay clickable on read-only quotes, and Save / Send still self-gate via
  // `!isReadOnly` / `canSend`.
  const composerActions = (
    <>
      {isEdit && (
        <Button
          type="button"
          outline
          onClick={onPreview}
          disabled={previewPending}
          className="text-brand-700"
        >
          {previewPending ? 'Loading…' : 'Preview PDF'}
        </Button>
      )}
      {!isReadOnly && (
        <Button
          type="button"
          color="brand"
          onClick={onSaveDraft}
          disabled={pending || !computed.ok}
        >
          {pending ? 'Saving…' : isEdit ? 'Save Quote' : 'Save Draft'}
        </Button>
      )}
      {canSend && (
        <Button
          type="button"
          color="green"
          onClick={() => setConfirmSendOpen(true)}
          disabled={
            !recipientEmail ||
            isDirty ||
            pending ||
            sendPending ||
            (isResend && msaEnvelopeInFlight)
          }
          title={
            isResend && msaEnvelopeInFlight
              ? 'MSA envelope is in flight — finish signing or terminate before re-sending this quote.'
              : isDirty
                ? 'Save changes before sending — the email emits the saved quote, not the unsaved edits.'
                : recipientErrorMessage ??
                  (recipientEmail
                    ? `${isResend ? 'Re-send Quote' : 'Send Quote'} to ${recipientEmail}`
                    : undefined)
          }
        >
          {isResend ? 'Re-send Quote' : 'Send Quote'}
        </Button>
      )}
    </>
  );

  return (
    <>
      <PageHeader
        title={
          pageStatusBadge ? (
            <span className="inline-flex items-center gap-3">
              {pageTitle}
              {pageStatusBadge}
            </span>
          ) : (
            pageTitle
          )
        }
        description={pageDescription}
        actions={composerActions}
        sticky
      />
      {keyValueItems && keyValueItems.length > 0 ? (
        <KeyValueStrip items={keyValueItems} />
      ) : null}
      {canSend && isDirty && (
        <p className="text-right text-[11px] text-zinc-500">
          You have unsaved changes — save before sending.
        </p>
      )}
      {canSend && !isDirty && recipientErrorMessage && (
        <p className="text-right text-[11px] text-red-700">
          Send disabled: {recipientErrorMessage}
        </p>
      )}
      {canSend && isResend && msaEnvelopeInFlight && (
        <p className="text-right text-[11px] text-amber-700">
          Re-send disabled: MSA envelope awaiting signature.
        </p>
      )}
      {isReadOnly && initial && (
        <div className="rounded-xl border border-zinc-200 bg-zinc-100 px-4 py-3 text-sm text-zinc-900">
          This quote has been{' '}
          <span className="font-semibold">{initial.status}</span> — make a new
          quote to revise it.
        </div>
      )}
      {!isReadOnly && initial && initial.sentAt && (
        <div className="rounded-xl border border-zinc-200 bg-zinc-100 px-4 py-3 text-sm text-zinc-900">
          {initial.isExpired ? 'Expired — last sent ' : 'Sent '}
          <span className="font-medium">{formatSentRelative(initial.sentAt)}</span>
          {'. Editing here updates the staff record; clicking '}
          <span className="font-semibold">Re-send Quote</span>
          {' replaces the recipient’s copy and resets the validity window.'}
        </div>
      )}

      <fieldset disabled={isReadOnly} className="contents">
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <section className="flex flex-col gap-4 rounded-2xl border border-zinc-200 bg-white p-5 shadow-[0_1px_4px_rgba(15,30,60,0.08)]">
        <div className="flex flex-col gap-3">
          <h2 className="font-sans font-bold tracking-tight text-xl text-brand-700">Quote header</h2>
          <div className={fieldClass}>
            <span className={labelClass}>Dealer</span>
            {isEdit ? (
              // The composer wires `setQuoteInputs` only; dealer swap on an
              // existing quote routes through `setQuoteDealer` (separate
              // setter, not surfaced in this phase). Render a static label
              // so a user can't think they're editing the dealer mid-save.
              <div className="rounded-lg border border-zinc-200 bg-zinc-100 px-3 py-2 text-sm text-zinc-900">
                {initial.dealerName}
              </div>
            ) : (
              <Controller
                control={control}
                name="dealerId"
                render={({ field }) => {
                  const selected = field.value
                    ? dealerOptions.find((o) => o.value === String(field.value)) ?? null
                    : null;
                  return (
                    <Combobox
                      options={dealerOptions}
                      displayValue={(item) => item?.label ?? ''}
                      value={selected}
                      onChange={(item) =>
                        field.onChange(item ? Number(item.value) : null)
                      }
                      placeholder="Pick a dealer…"
                      aria-label="Dealer"
                    >
                      {(item) => (
                        <ComboboxOption value={item}>
                          <ComboboxLabel>{item.label}</ComboboxLabel>
                        </ComboboxOption>
                      )}
                    </Combobox>
                  );
                }}
              />
            )}
          </div>
          {initialCampaignId ? (
            <p className="text-xs text-zinc-500">
              Tied to campaign #{initialCampaignId}. Full campaign-linkage wiring lands later.
            </p>
          ) : null}
        </div>

        <div className="flex flex-col gap-3">
          <h2 className="font-sans font-bold tracking-tight text-xl text-brand-700">Inputs</h2>

          <FieldGroup>
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
            spinner
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
              <Fieldset>
                <Legend>Record retrieval bracket</Legend>
                <ToggleGroup
                  value={String(field.value)}
                  onValueChange={(v) => field.onChange(Number(v))}
                  className="flex-wrap"
                >
                  {RETRIEVAL_BRACKETS.map((amount) => (
                    <ToggleGroupItem key={amount} value={String(amount)}>
                      {amount === 0 ? 'None' : `$${amount}`}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
              </Fieldset>
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
          </FieldGroup>
        </div>
      </section>

      <section className="flex flex-col gap-4 rounded-2xl border border-zinc-200 bg-white p-5 shadow-[0_1px_4px_rgba(15,30,60,0.08)]">
        <h2 className="font-sans font-bold tracking-tight text-xl text-brand-700">Summary</h2>
        {display.ok ? (
          <div className="overflow-hidden rounded-xl border border-zinc-200">
            <table className="w-full text-sm">
              <thead className="bg-zinc-100 text-xs text-zinc-500">
                <tr>
                  <th className="px-3 py-2 text-left">Item</th>
                  <th className="px-3 py-2 text-right">Qty</th>
                  <th className="px-3 py-2 text-right">Unit</th>
                  <th className="px-3 py-2 text-right">Line total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200">
                {display.lines.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-3 py-6 text-center text-xs text-zinc-500">
                      No lines yet. Set inputs on the left.
                    </td>
                  </tr>
                ) : (
                  display.lines.map((l) => (
                    <tr key={l.code}>
                      <td className="px-3 py-2 align-top text-zinc-900">
                        <div className="font-medium">{l.label}</div>
                        <div className="text-[10px] uppercase tracking-wide text-zinc-500/70">
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
                <tr className="border-t border-zinc-200 bg-zinc-100/60 text-sm">
                  <td colSpan={3} className="px-3 py-2 text-right text-zinc-500">
                    Subtotal
                  </td>
                  <td className="px-3 py-2 text-right font-semibold tabular-nums">
                    {fmtMoney(display.subtotal)}
                  </td>
                </tr>
                <tr className="text-sm">
                  <td colSpan={2} />
                  <td className="px-3 py-2 text-right text-zinc-500">Tax override</td>
                  <td className="px-3 py-2 text-right">
                    {isReadOnly && initial ? (
                      <span className="tabular-nums">{fmtMoney(initial.tax)}</span>
                    ) : (
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        className="w-28 rounded border border-zinc-200 bg-white px-2 py-1 text-right text-sm tabular-nums focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                        {...register('taxOverride', { valueAsNumber: true })}
                      />
                    )}
                  </td>
                </tr>
                <tr className="border-t border-zinc-200 bg-brand-600 text-sm text-white">
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
          <div className="rounded-xl border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700">
            {display.error}
          </div>
        )}
      </section>
      </div>
      </fieldset>

      {sendHistorySlot}

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
        isResend={isResend}
        quoteValidDays={initial?.quoteValidDays ?? 30}
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
    <Dialog open={open} onClose={() => onClose(false)} size="4xl">
      <DialogTitle>Quote preview</DialogTitle>
      <DialogDescription>
        PDF rendered from the saved snapshot. Matches what gets emailed on
        Send.
      </DialogDescription>
      <div className="mt-4 h-[70vh] overflow-hidden rounded-lg border border-zinc-200 bg-zinc-100">
        {error ? (
          <div className="flex h-full items-center justify-center px-6 text-center text-sm text-red-700">
            {error}
          </div>
        ) : loading || !pdfUrl ? (
          <div className="flex h-full items-center justify-center text-sm text-zinc-500">
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
      <div className="mt-4 flex items-center justify-end">
        <Button type="button" outline onClick={() => onClose(false)}>
          Close
        </Button>
      </div>
    </Dialog>
  );
}

function ConfirmSendDialog({
  open,
  onClose,
  pending,
  recipientEmail,
  lineCount,
  total,
  isResend,
  quoteValidDays,
  onConfirm,
}: {
  open: boolean;
  onClose: (next: false) => void;
  pending: boolean;
  recipientEmail: string | null;
  lineCount: number;
  total: number;
  isResend: boolean;
  quoteValidDays: number;
  onConfirm: () => void;
}) {
  // Re-send variant surfaces the new validity deadline so the coach sees
  // exactly what the dealer's "Valid until" line will say after re-send.
  const newValidUntil = isResend ? formatValidUntil(quoteValidDays) : null;
  return (
    <Dialog open={open} onClose={() => onClose(false)}>
      <DialogTitle>
        {isResend ? 'Re-send this quote?' : 'Send this quote?'}
      </DialogTitle>
      <DialogDescription>
        {isResend
          ? `The recipient will receive a new PDF; the validity window resets to ${newValidUntil}.`
          : 'The recipient will receive a PDF by email. Accepted/declined quotes are locked — edits up to that point are allowed.'}
      </DialogDescription>
      <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
        <dt className="text-zinc-500">Recipient</dt>
        <dd className="font-medium text-zinc-900">
          {recipientEmail ?? <span className="text-red-700">none</span>}
        </dd>
        <dt className="text-zinc-500">Line items</dt>
        <dd className="tabular-nums text-zinc-900">{lineCount}</dd>
        <dt className="text-zinc-500">Total</dt>
        <dd className="font-semibold tabular-nums text-zinc-900">
          {fmtMoney(total)}
        </dd>
      </dl>
      <div className="mt-6 flex items-center justify-end gap-2">
        <Button type="button" outline onClick={() => onClose(false)}>
          Cancel
        </Button>
        <Button
          type="button"
          color="green"
          onClick={onConfirm}
          disabled={pending || !recipientEmail}
        >
          {pending ? 'Sending…' : isResend ? 'Re-send' : 'Send'}
        </Button>
      </div>
    </Dialog>
  );
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function formatValidUntil(quoteValidDays: number): string {
  const d = new Date(Date.now() + quoteValidDays * MS_PER_DAY);
  return d.toLocaleDateString('en-CA', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

// Absolute "Sent on …" date for the banner. Avoids relative-time SSR/CSR
// hydration drift (server's `Date.now()` differs from client's by a few
// hundred ms, which can cross a "1 minute ago / 2 minutes ago" boundary
// at the worst moment). A formatted date renders identically on both.
function formatSentRelative(sentAt: Date): string {
  return `on ${sentAt.toLocaleDateString('en-CA', { year: 'numeric', month: 'short', day: 'numeric' })}`;
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
  spinner,
}: {
  label: string;
  registration: UseFormRegisterReturn;
  min?: number;
  step?: string;
  help?: string;
  error?: string;
  /** Opt back into native +/- spin buttons. Off everywhere by default (see
   *  globals.css); flip on for small-range day-count style fields. */
  spinner?: boolean;
}) {
  const id = `qf-${registration.name}`;
  return (
    <Field>
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type="number"
        min={min ?? 0}
        step={step ?? '1'}
        aria-invalid={!!error || undefined}
        {...(spinner ? { 'data-spinner': '' } : {})}
        {...registration}
      />
      {error ? (
        <FieldError>{error}</FieldError>
      ) : help ? (
        <Description>{help}</Description>
      ) : null}
    </Field>
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
    <Field>
      <Label htmlFor={id}>{label}</Label>
      <Textarea
        id={id}
        placeholder={placeholder}
        rows={2}
        className="resize-y"
        aria-invalid={!!error || undefined}
        {...registration}
      />
      {error ? <FieldError>{error}</FieldError> : null}
    </Field>
  );
}
