'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogDescription,
  DialogTitle,
} from '@/components/catalyst/dialog';
import { Button } from '@/components/catalyst/button';
import { toLegacyResult } from '@/lib/actions/legacy-result';
import { createMsaDraft, sendMsaEnvelope } from './actions';

export type MsaCreateDialogProps = {
  open: boolean;
  onClose: (next: false) => void;
  dealerId: number;
  dealerName: string;
  /** Pre-resolved recipient. When `{ error }`, the dialog renders the error
   *  instead of the action surface — the MSA envelope has no sensible fallback
   *  without a customer-contact primary email. */
  recipient: { email: string; firstName: string } | { error: string };
};

// Single-click "create MSA + send envelope" flow (0082: MSA-only — the quote is
// no longer bundled in). Two-step action sequence:
//   1. `createMsaDraft(dealerId)` inserts the `pending` row + emits
//      `msa.created` audit.
//   2. `sendMsaEnvelope(msaId)` renders the MSA PDF, uploads the draft to GCS,
//      posts the MSA-only envelope to BoldSign, and persists the returned
//      `providerDocumentId` + emits `msa.sent`.
//
// On step-2 failure the `pending` row stays put — re-opening the dialog
// re-invokes `sendMsaEnvelope` against the same id (the `providerDocumentId IS
// NULL` guard makes the action safely re-runnable).
export function MsaCreateDialog(props: MsaCreateDialogProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [lastError, setLastError] = useState<string | null>(null);

  const noRecipient = 'error' in props.recipient;
  const canSubmit = !noRecipient;

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
      <DialogTitle>Send MSA for signature</DialogTitle>
        <DialogDescription>
          The Master Service Agreement is sent to the Client via BoldSign. Once
          signed it takes effect, and the dealer&apos;s quotes can be accepted.
        </DialogDescription>

        <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
          <dt className="text-zinc-500">Dealer</dt>
          <dd className="font-medium text-zinc-900">{props.dealerName}</dd>
          <dt className="text-zinc-500">Recipient</dt>
          <dd className="text-zinc-900">
            {'error' in props.recipient ? (
              <span className="text-red-700">{props.recipient.error}</span>
            ) : (
              `${props.recipient.firstName} <${props.recipient.email}>`
            )}
          </dd>
        </dl>

        {lastError && (
          <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
            {lastError}
          </p>
        )}

        <div className="mt-6 flex items-center justify-end gap-2">
          <Button type="button" outline onClick={() => props.onClose(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            color="brand"
            onClick={onSubmit}
            disabled={pending || !canSubmit}
          >
            {pending ? 'Sending…' : 'Send for signature'}
          </Button>
        </div>
    </Dialog>
  );
}
