'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogDescription,
  DialogTitle,
} from '@/components/catalyst/dialog';
import { toLegacyResult } from '@/lib/actions/legacy-result';
import { createMsaDraft, sendMsaEnvelope } from './actions';

export type MsaCreateDialogProps = {
  open: boolean;
  onClose: (next: false) => void;
  dealerId: number;
  dealerName: string;
  /** Pre-resolved recipient. When `{ error }`, the dialog renders the error
   *  instead of the action surface — the bundled-envelope flow has no
   *  sensible fallback without a customer-contact primary email. */
  recipient: { email: string; firstName: string } | { error: string };
  /** Id of the dealer's first draft Quote. When `null`, the dialog renders
   *  the "create a draft Quote first" guidance. */
  firstDraftQuoteId: number | null;
};

// Single-click "create MSA + send envelope" flow. Two-step action sequence:
//   1. `createMsaDraft(dealerId)` inserts the `pending` row + emits
//      `msa.created` audit.
//   2. `sendMsaEnvelope(msaId, firstDraftQuoteId)` renders both PDFs, uploads
//      the draft to GCS, posts the envelope to Dropbox Sign, and persists
//      the returned `dropboxSignDocumentId` + emits `msa.sent`.
//
// On step-2 failure the `pending` row stays put — a follow-up "Resend" surface
// would re-invoke `sendMsaEnvelope` against the same id (idempotency lives in
// the action). That follow-up is out of scope for 0041 v1; for now a failed
// send surfaces a toast and the operator can either re-open the dialog (the
// `dropboxSignDocumentId IS NULL` guard makes the action safely re-runnable)
// or chase Dropbox-Sign creds out-of-band.
export function MsaCreateDialog(props: MsaCreateDialogProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [lastError, setLastError] = useState<string | null>(null);

  const noRecipient = 'error' in props.recipient;
  const noDraftQuote = props.firstDraftQuoteId == null;
  const canSubmit = !noRecipient && !noDraftQuote;

  function onSubmit() {
    if (!canSubmit) return;
    setLastError(null);
    startTransition(async () => {
      const createFd = new FormData();
      createFd.set('dealerId', String(props.dealerId));
      const createResult = toLegacyResult<{ ok: true; msaId: number }>(
        await createMsaDraft(createFd),
      );
      if (!('ok' in createResult)) {
        setLastError(createResult.error);
        toast.error(createResult.error);
        return;
      }

      const sendFd = new FormData();
      sendFd.set('msaId', String(createResult.msaId));
      sendFd.set('firstQuoteId', String(props.firstDraftQuoteId));
      const sendResult = toLegacyResult(await sendMsaEnvelope(sendFd));
      if (!('ok' in sendResult)) {
        setLastError(sendResult.error);
        toast.error(sendResult.error);
        return;
      }

      toast.success('MSA sent for signature');
      props.onClose(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={props.open} onClose={() => props.onClose(false)}>
      <DialogTitle>Send MSA + first Quote for signature</DialogTitle>
        <DialogDescription>
          A bundled envelope is sent to the Client via Dropbox Sign. The Client
          signs once and both documents take effect.
        </DialogDescription>

        <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
          <dt className="text-zinc-500">Dealer</dt>
          <dd className="font-medium text-zinc-900">{props.dealerName}</dd>
          <dt className="text-zinc-500">Recipient</dt>
          <dd className="text-zinc-900">
            {'error' in props.recipient ? (
              <span className="text-status-red">{props.recipient.error}</span>
            ) : (
              `${props.recipient.firstName} <${props.recipient.email}>`
            )}
          </dd>
          <dt className="text-zinc-500">First Quote</dt>
          <dd className="text-zinc-900">
            {props.firstDraftQuoteId == null ? (
              <span className="text-status-red">
                No draft Quote yet —{' '}
                <a
                  href={`/quotes/new?dealerId=${props.dealerId}`}
                  className="font-medium underline hover:text-brand-700"
                >
                  create one first
                </a>
                .
              </span>
            ) : (
              <a
                href={`/quotes/${props.firstDraftQuoteId}`}
                className="font-medium text-brand-700 underline"
              >
                Quote #{props.firstDraftQuoteId}
              </a>
            )}
          </dd>
        </dl>

        {lastError && (
          <p className="mt-3 rounded-lg bg-status-red/10 px-3 py-2 text-xs text-status-red">
            {lastError}
          </p>
        )}

        <div className="mt-6 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => props.onClose(false)}
            className="rounded-lg border border-zinc-300 bg-white px-4 py-1.5 text-xs font-semibold text-zinc-900 transition hover:border-brand-500 hover:text-brand-700"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onSubmit}
            disabled={pending || !canSubmit}
            className="rounded-lg bg-status-green px-4 py-1.5 text-xs font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {pending ? 'Sending…' : 'Send for signature'}
          </button>
        </div>
    </Dialog>
  );
}
