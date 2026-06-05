'use client';

import { useMemo, useState, useTransition, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { KeyValueStrip, type KeyValueItem } from '@/components/app/key-value-strip';
import { PageHeader } from '@/components/app/page-header';
import {
  Controller,
  useFieldArray,
  useForm,
  useWatch,
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
  Label,
} from '@/components/catalyst/fieldset';
import { FieldError } from '@/components/catalyst/field-compat';
import { Button } from '@/components/catalyst/button';
import { Textarea } from '@/components/catalyst/textarea';
import { toast } from '@/components/ui/toaster';
import { toLegacyResult } from '@/lib/actions/legacy-result';
import {
  createQuote,
  previewQuotePdf,
  sendQuote,
  setQuoteInputs,
} from '@/features/quotes/actions';
import { MsaSendForSignatureButton } from '@/features/msa/msa-send-button';
import type { Dealer } from '@/features/schedule/queries';
import type { QuoteStatus } from '@/features/quotes/queries';
import type { ServiceItem } from '@/features/services/queries';
import {
  computePickedTotals,
  effectiveUnit,
  MAX_DOLLARS,
  QuoteInputsError,
  type PickedLine,
} from '@/lib/quotes/pricing';
import { rateForProvince, type TaxRate } from '@/lib/tax-rates';
import { CA_PROVINCE_NAMES } from '@/lib/ca-provinces';

// Quote composer — SKU line-item picker (0062, reversing the 0035 calculator).
// The coach assembles the quote by picking services from the catalogue, each
// with a quantity and a per-quote price (catalogue-seeded, editable). Saving a
// fresh quote creates a draft row and routes to `/quotes/<id>` (edit-mode
// home); saving from edit-mode hits `setQuoteInputs` (atomic guarded UPDATE)
// and stays put. Terminal statuses (accepted/declined) render read-only —
// the server-side guard is the real defence.

export type InitialQuote = {
  quoteId: number;
  dealerId: number;
  dealerName: string;
  /** Free-text notes rendered on the PDF. The one structured field the picker
   *  composer still owns. */
  quoteNotes: string;
  /** Persisted line rows (0062). Rehydrates the picker; read-only mode renders
   *  these directly. */
  pickedLines: PickedLine[];
  subtotal: number;
  /** Tax dollar amount (not %). Matches the `tax` FormData field consumed by
   *  `setQuoteInputs`/`createQuote`. */
  tax: number;
  /** Coach's manual tax override, or null when tax is auto from the province (0065). */
  taxOverride: number | null;
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
  /** Province → sales-tax rates (0065). Drives the live tax preview + label. */
  taxRates: TaxRate[];
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
  /** Dealer's MSA standing for the bundled-envelope action (0061). Drives the
   *  toolbar: `bundleEligible` (no usable MSA — none/expired/terminated, the
   *  states where `createMsaDraft` succeeds) → "Send for signature" is the
   *  primary CTA and "Send Quote" demotes to secondary; `active` → plain
   *  "Send Quote" + an "MSA active — expires …" indicator. Omitted on
   *  create-mode (no dealer/quote yet). */
  msaState?: {
    active: boolean;
    expiresAt: Date | null;
    bundleEligible: boolean;
  };
  /** The quote's `createdAt` — drives the bundled-envelope dialog's
   *  `quote-<timestamp>` display name. Edit-mode only. */
  quoteCreatedAt?: Date;
  /** Page-level title rendered inside the sticky `<PageHeader>` the composer
   *  owns. Owned by the composer (not the page) so the composer's action
   *  buttons can ride in the same actions slot as the status badge — one
   *  row, sticky at `top-16`. */
  pageTitle: ReactNode;
  /** Optional `<PageHeader>` description (1-line summary under the title).
   *  Used on create-mode to surface the "Build a quote from the catalogue…"
   *  copy. */
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

// Form schema. `lines` is the picked-SKU array (RHF field array); `dealerId`
// is create-mode chrome; `taxOverride` + `quoteNotes` ride alongside. The
// server (`setQuoteInputs`/`createQuote`) receives `lines` as a JSON string +
// `tax` / `quoteNotes` / `dealerId` as separate FormData entries.
const lineFieldSchema = z.object({
  serviceItemId: z.number().int().positive(),
  qty: z.number().int().min(1).max(1_000_000),
  price: z.number().min(0).max(MAX_DOLLARS),
});
type LineFieldValue = z.infer<typeof lineFieldSchema>;

const quoteFormSchema = z.object({
  dealerId: z.number().int().positive().nullable(),
  // 0065: nullable — null means "auto" (derive tax from the dealer's province).
  taxOverride: z.number().min(0).max(MAX_DOLLARS).nullable(),
  quoteNotes: z.string().max(1000),
  lines: z.array(lineFieldSchema),
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

// Catalogue seed price for a SKU (numeric string → number; null → 0).
function seedPrice(item: ServiceItem | undefined): number {
  return item && item.unitPrice != null ? Number(item.unitPrice) : 0;
}

// Map editable form lines → `PickedLine[]` for live totals + display, resolving
// each `serviceItemId` against the catalogue. Mirrors the server's
// `buildPickedLines` so the on-screen totals match what gets persisted.
function toPickedLines(
  lines: LineFieldValue[],
  catalogById: Map<number, ServiceItem>,
): PickedLine[] {
  return lines.map((l) => {
    const item = catalogById.get(l.serviceItemId);
    const seed = seedPrice(item);
    const price = Number.isFinite(l.price) ? l.price : seed;
    return {
      serviceItemId: l.serviceItemId,
      code: item?.code ?? String(l.serviceItemId),
      label: item?.label ?? 'Unknown item',
      description: item?.description ?? undefined,
      qty: l.qty,
      unitPrice: seed,
      overrideUnitPrice: price !== seed ? price : undefined,
      lineTotal: 0,
    };
  });
}

export function QuoteComposer({
  dealers,
  taxRates,
  catalog,
  initialDealerId,
  initialCampaignId,
  initial,
  recipient,
  msaEnvelopeInFlight = false,
  msaState,
  quoteCreatedAt,
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
  // 0061: MSA-aware send. `bundleEligible` (no usable MSA — page-computed from
  // none/expired/terminated) means this first/renewal deal must ship as the
  // signed MSA+Quote bundle, so "Send for signature" becomes the primary CTA
  // and plain "Send Quote" demotes to a secondary review-email button.
  // `canSend` already gates to non-terminal (draft|sent) quotes.
  const showBundle = canSend && (msaState?.bundleEligible ?? false);
  const hasActiveMsa = msaState?.active ?? false;

  const catalogById = useMemo(
    () => new Map(catalog.map((c) => [c.id, c])),
    [catalog],
  );
  const catalogByCode = useMemo(
    () => new Map(catalog.map((c) => [c.code, c])),
    [catalog],
  );

  const defaultValues = useMemo<QuoteFormValues>(() => {
    // Rehydrate the field array from the persisted picked lines. The price is
    // the effective (override-or-catalogue) value. `serviceItemId` falls back
    // to a catalogue code-match for legacy lines backfilled from the old JSONB
    // snapshot (which carry no service-item id).
    const lines = (initial?.pickedLines ?? []).map((l) => ({
      serviceItemId: l.serviceItemId ?? catalogByCode.get(l.code)?.id ?? 0,
      qty: l.qty,
      price: effectiveUnit(l),
    }));
    return {
      dealerId: initial?.dealerId ?? initialDealerId,
      taxOverride: initial?.taxOverride ?? null,
      quoteNotes: initial?.quoteNotes ?? '',
      lines,
    };
  }, [initial, initialDealerId, catalogByCode]);

  const form = useForm<QuoteFormValues>({
    resolver: zodResolver(quoteFormSchema),
    defaultValues,
    mode: 'onChange',
  });
  const { register, control, handleSubmit, formState, reset } = form;
  const { errors, isDirty } = formState;
  const { fields, append, remove } = useFieldArray({ control, name: 'lines' });

  // Local (non-form) state for the add-line picker so it resets to empty after
  // each append.
  const [addSelection, setAddSelection] = useState<{
    value: string;
    label: string;
  } | null>(null);

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
  const catalogOptions = useMemo(
    () => catalog.map((c) => ({ value: String(c.id), label: c.label })),
    [catalog],
  );

  // Subscribe to all form values so the totals update live as the coach edits.
  const watched = useWatch({ control, defaultValue: defaultValues });

  // Live totals — uses the same pure function the server runs at save time, so
  // the on-screen subtotal/total never drift from what gets persisted. Catches
  // validation errors so a mid-keystroke out-of-range value doesn't crash the
  // render.
  // 0065: the selected dealer's province sales-tax rate drives the live tax
  // preview + label. 0 when the dealer has no province set.
  const selectedDealer = useMemo(
    () => dealers.find((d) => d.id === watched.dealerId) ?? null,
    [dealers, watched.dealerId],
  );
  const ratePct = useMemo(
    () => rateForProvince(taxRates, selectedDealer?.province ?? null) ?? 0,
    [taxRates, selectedDealer],
  );

  const computed = useMemo(() => {
    try {
      const picked = toPickedLines((watched.lines ?? []) as LineFieldValue[], catalogById);
      // 0065: tax = the manual override if typed, else subtotal × province rate.
      return {
        ok: true as const,
        out: computePickedTotals(picked, { ratePct, override: watched.taxOverride ?? null }),
      };
    } catch (err) {
      const msg = err instanceof QuoteInputsError ? err.message : 'Invalid lines.';
      return { ok: false as const, error: msg };
    }
  }, [watched, catalogById, ratePct]);

  const display = isReadOnly && initial
    ? {
        ok: true as const,
        lines: initial.pickedLines,
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
        fd.set(
          'lines',
          JSON.stringify(
            (values.lines ?? []).map((l) => ({
              serviceItemId: l.serviceItemId,
              qty: l.qty,
              price: l.price,
            })),
          ),
        );
        // 0065: blank → auto (server derives tax from the dealer's province).
        fd.set('tax', values.taxOverride != null ? String(values.taxOverride) : '');
        fd.set('quoteNotes', values.quoteNotes ?? '');
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
      // Resolver-rejected submit — surface a toast so a user who tabs past
      // inline errors still sees feedback.
      toast.error('Fix the highlighted fields before saving.');
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
  // computed ones — `sendQuote` emits from the saved snapshot, so live numbers
  // would lie to the coach when the form is dirty.
  const persistedLineCount = initial?.pickedLines.length ?? 0;
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
          // 0061: when the bundle is the primary CTA, the plain quote email
          // demotes to a secondary (outline) review-send; otherwise it stays
          // the green primary.
          {...(showBundle ? ({ outline: true } as const) : ({ color: 'green' } as const))}
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
      {showBundle && initial && quoteCreatedAt && (
        <MsaSendForSignatureButton
          dealerId={initial.dealerId}
          dealerName={initial.dealerName}
          recipient={recipient ?? { error: 'No recipient resolved for this dealer.' }}
          quote={{ id: initial.quoteId, createdAt: quoteCreatedAt }}
          // Same guard as Send Quote: the envelope renders the SAVED snapshot,
          // so block on unsaved edits (else the signed bundle carries stale
          // pricing) or an in-flight action.
          disabled={isDirty || pending || sendPending}
          title={
            isDirty
              ? 'Save changes before sending for signature — the envelope renders the saved quote, not the unsaved edits.'
              : undefined
          }
        />
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
      {showBundle && (
        <p className="text-right text-[11px] text-amber-700">
          No active MSA — acceptance requires the signed MSA&nbsp;+&nbsp;Quote
          bundle (&ldquo;Send for signature&rdquo;).
        </p>
      )}
      {canSend && hasActiveMsa && (
        <p className="text-right text-[11px] text-zinc-500">
          MSA active
          {msaState?.expiresAt
            ? ` — expires ${msaState.expiresAt.toISOString().slice(0, 10)}`
            : ''}
          .
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
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
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
          <h2 className="font-sans font-bold tracking-tight text-xl text-brand-700">Notes &amp; tax</h2>
          <Field>
            <Label htmlFor="qf-quoteNotes">Quote notes (rendered on PDF)</Label>
            <Textarea
              id="qf-quoteNotes"
              placeholder="Anything the dealer should see in the quote PDF."
              rows={3}
              className="resize-y"
              aria-invalid={!!errors.quoteNotes?.message || undefined}
              {...register('quoteNotes')}
            />
            {errors.quoteNotes?.message ? (
              <FieldError>{errors.quoteNotes.message}</FieldError>
            ) : null}
          </Field>
          <Field>
            <Label htmlFor="qf-tax">Tax</Label>
            {!selectedDealer?.province ? (
              // No province → nothing to compute; point the coach at the fix.
              <span className={labelClass}>
                Set the dealer’s province to calculate sales tax.
              </span>
            ) : watched.taxOverride != null ? (
              // Override mode: an editable amount, seeded from the auto value,
              // with an explicit path back to the province rate.
              <div className="flex flex-col gap-1">
                <input
                  id="qf-tax"
                  type="number"
                  min={0}
                  step="0.01"
                  className="w-40 rounded border border-zinc-200 bg-white px-2 py-1 text-right text-sm tabular-nums focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                  {...register('taxOverride', {
                    setValueAs: (v) => (v === '' || v == null ? null : Number(v)),
                  })}
                />
                <span className={labelClass}>
                  Manual override.{' '}
                  <button
                    type="button"
                    className="font-medium text-brand-600 underline hover:text-brand-700"
                    onClick={() =>
                      form.setValue('taxOverride', null, {
                        shouldDirty: true,
                        shouldValidate: true,
                      })
                    }
                  >
                    Use {CA_PROVINCE_NAMES[selectedDealer.province]} {ratePct}% (
                    {fmtMoney(computed.ok ? computed.out.tax : 0)})
                  </button>
                </span>
              </div>
            ) : (
              // Auto mode: show the computed tax as a real value (not a ghost
              // placeholder) + an explicit Override affordance that seeds the
              // input with the current amount.
              <div className="flex items-center gap-2">
                <span
                  id="qf-tax"
                  className="text-sm font-semibold tabular-nums text-zinc-800"
                >
                  {fmtMoney(computed.ok ? computed.out.tax : 0)}
                </span>
                <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-500">
                  auto · {CA_PROVINCE_NAMES[selectedDealer.province]} {ratePct}%
                </span>
                <button
                  type="button"
                  className="text-xs font-medium text-brand-600 underline hover:text-brand-700"
                  onClick={() =>
                    form.setValue(
                      'taxOverride',
                      computed.ok ? computed.out.tax : 0,
                      { shouldDirty: true, shouldValidate: true },
                    )
                  }
                >
                  Override
                </button>
              </div>
            )}
            {errors.taxOverride?.message ? (
              <FieldError>{errors.taxOverride.message}</FieldError>
            ) : null}
          </Field>
        </div>
      </section>

      <section className="flex flex-col gap-4 rounded-2xl border border-zinc-200 bg-white p-5 shadow-[0_1px_4px_rgba(15,30,60,0.08)]">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="font-sans font-bold tracking-tight text-xl text-brand-700">Line items</h2>
        </div>

        {!isReadOnly && (
          // Add-line picker — choosing a SKU appends a line prefilled with the
          // catalogue price, then resets the picker to empty.
          <div className={fieldClass}>
            <span className={labelClass}>Add a service from the catalogue</span>
            <Combobox
              options={catalogOptions}
              displayValue={(item) => item?.label ?? ''}
              value={addSelection}
              onChange={(item) => {
                if (!item) return;
                const id = Number(item.value);
                append({ serviceItemId: id, qty: 1, price: seedPrice(catalogById.get(id)) });
                setAddSelection(null);
              }}
              placeholder="Pick a service to add…"
              aria-label="Add line item"
            >
              {(item) => (
                <ComboboxOption value={item}>
                  <ComboboxLabel>{item.label}</ComboboxLabel>
                </ComboboxOption>
              )}
            </Combobox>
          </div>
        )}

        {display.ok ? (
          <div className="overflow-hidden rounded-xl border border-zinc-200">
            <table className="w-full text-sm">
              <thead className="bg-zinc-100 text-xs text-zinc-500">
                <tr>
                  <th className="px-3 py-2 text-left">Item</th>
                  <th className="px-3 py-2 text-right">Qty</th>
                  <th className="px-3 py-2 text-right">Unit price</th>
                  <th className="px-3 py-2 text-right">Line total</th>
                  {!isReadOnly && <th className="px-2 py-2" />}
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200">
                {isReadOnly
                  ? renderReadOnlyRows(display.lines)
                  : fields.length === 0
                    ? (
                      <tr>
                        <td colSpan={5} className="px-3 py-6 text-center text-xs text-zinc-500">
                          No lines yet. Add a service from the catalogue above.
                        </td>
                      </tr>
                    )
                    : fields.map((fieldRow, index) => {
                        const line = (watched.lines ?? [])[index] as LineFieldValue | undefined;
                        const sid = line?.serviceItemId ?? fieldRow.serviceItemId;
                        const item = catalogById.get(sid);
                        const qty = line?.qty ?? fieldRow.qty;
                        const price = line?.price ?? fieldRow.price;
                        const lineTotal =
                          Number.isFinite(price * qty) ? price * qty : 0;
                        const seed = seedPrice(item);
                        const isTuned = Number.isFinite(price) && price !== seed;
                        return (
                          <tr key={fieldRow.id}>
                            <td className="px-3 py-2 align-top text-zinc-900">
                              <div className="font-medium">{item?.label ?? 'Removed item'}</div>
                              {item?.description ? (
                                <div className="text-[11px] text-zinc-500">{item.description}</div>
                              ) : null}
                            </td>
                            <td className="px-3 py-2 text-right align-top">
                              <input
                                type="number"
                                min={1}
                                step="1"
                                aria-label="Quantity"
                                className="w-20 rounded border border-zinc-200 bg-white px-2 py-1 text-right text-sm tabular-nums focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                                {...register(`lines.${index}.qty` as const, { valueAsNumber: true })}
                              />
                            </td>
                            <td className="px-3 py-2 text-right align-top">
                              <div className="flex flex-col items-end gap-1">
                                <input
                                  type="number"
                                  min={0}
                                  step="0.01"
                                  aria-label="Unit price"
                                  className="w-28 rounded border border-zinc-200 bg-white px-2 py-1 text-right text-sm tabular-nums focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                                  {...register(`lines.${index}.price` as const, { valueAsNumber: true })}
                                />
                                {isTuned ? (
                                  <span className="text-[10px] text-zinc-400">
                                    Catalogue: {fmtMoney(seed)}
                                  </span>
                                ) : null}
                              </div>
                            </td>
                            <td className="px-3 py-2 text-right font-medium tabular-nums align-top">
                              {fmtMoney(lineTotal)}
                            </td>
                            <td className="px-2 py-2 text-right align-top">
                              <button
                                type="button"
                                onClick={() => remove(index)}
                                aria-label="Remove line"
                                className="rounded px-2 py-1 text-xs text-zinc-400 transition hover:bg-red-50 hover:text-red-700"
                              >
                                ✕
                              </button>
                            </td>
                          </tr>
                        );
                      })}
              </tbody>
              <tfoot>
                <tr className="border-t border-zinc-200 bg-zinc-100/60 text-sm">
                  <td colSpan={isReadOnly ? 3 : 3} className="px-3 py-2 text-right text-zinc-500">
                    Subtotal
                  </td>
                  <td className="px-3 py-2 text-right font-semibold tabular-nums">
                    {fmtMoney(display.subtotal)}
                  </td>
                  {!isReadOnly && <td />}
                </tr>
                <tr className="text-sm">
                  <td colSpan={isReadOnly ? 2 : 2} />
                  <td className="px-3 py-2 text-right text-zinc-500">Tax</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtMoney(display.tax)}</td>
                  {!isReadOnly && <td />}
                </tr>
                <tr className="border-t border-zinc-200 bg-brand-600 text-sm text-white">
                  <td colSpan={isReadOnly ? 3 : 3} className="px-3 py-2 text-right">
                    Total
                  </td>
                  <td className="px-3 py-2 text-right font-bold tabular-nums">
                    {fmtMoney(display.total)}
                  </td>
                  {!isReadOnly && <td />}
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

// Read-only line rows (terminal-status quote): the persisted picked lines as
// plain text, no inputs.
function renderReadOnlyRows(lines: PickedLine[]) {
  if (lines.length === 0) {
    return (
      <tr>
        <td colSpan={4} className="px-3 py-6 text-center text-xs text-zinc-500">
          No line items.
        </td>
      </tr>
    );
  }
  return lines.map((l) => (
    <tr key={l.code}>
      <td className="px-3 py-2 align-top text-zinc-900">
        <div className="font-medium">{l.label}</div>
        {l.description ? (
          <div className="text-[11px] text-zinc-500">{l.description}</div>
        ) : null}
      </td>
      <td className="px-3 py-2 text-right tabular-nums align-top">{l.qty}</td>
      <td className="px-3 py-2 text-right tabular-nums align-top">
        {fmtMoney(effectiveUnit(l))}
      </td>
      <td className="px-3 py-2 text-right font-medium tabular-nums align-top">
        {fmtMoney(l.lineTotal)}
      </td>
    </tr>
  ));
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
