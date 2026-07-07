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
import type { QuoteStatus } from '@/features/quotes/queries';
import { acceptQuote, declineQuote } from './actions';

type Mode = 'accept' | 'decline';

export type QuoteStatusActionsProps = {
  quoteId: number;
  status: QuoteStatus;
  /** The dealer has an active MSA — required before a quote can be accepted
   *  (0082 D3): the accepted quote IS the contract, so the master agreement
   *  must be signed first. When false, Accept is disabled with explanatory copy. */
  hasActiveMsa: boolean;
  /** 0100: the quote's event opts out of the MSA (`campaigns.msa_waived`). When
   *  true it satisfies the MSA gate exactly like an active MSA would — Accept is
   *  enabled and the "sign the MSA first" copy is suppressed. */
  msaWaived: boolean;
  /** Sent-but-past-validity — `acceptQuote` rejects an expired quote server-side,
   *  so disable Accept rather than fire-then-toast the expiry error. */
  isExpired: boolean;
};

// Staff "Mark accepted" / "Decline" control for a SENT quote (0082). v1 has no
// self-serve customer accept — the customer relays their decision by phone/email
// and a coach flips the quote through the existing `acceptQuote`/`declineQuote`
// Server Actions. Accept is gated on the dealer's active MSA. Renders nothing for
// non-`sent` quotes (a draft can't be accepted; accepted/declined are terminal).
// Each action confirms first — both transitions are terminal.
export function QuoteStatusActions(props: QuoteStatusActionsProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [confirm, setConfirm] = useState<Mode | null>(null);

  if (props.status !== 'sent') return null;

  // 0100: a waived event satisfies the MSA gate exactly like an active MSA.
  const msaSatisfied = props.hasActiveMsa || props.msaWaived;
  const acceptDisabled = pending || !msaSatisfied || props.isExpired;
  const acceptTitle = !msaSatisfied
    ? 'Sign the master agreement first — a quote can only be accepted once the dealer has an active MSA.'
    : props.isExpired
      ? 'This quote has expired — re-issue a new one before it can be accepted.'
      : undefined;

  function run(mode: Mode) {
    startTransition(async () => {
      const action = mode === 'accept' ? acceptQuote : declineQuote;
      const f = new FormData();
      f.set('quoteId', String(props.quoteId));
      const res = toLegacyResult(await action(f));
      if (!('ok' in res)) {
        toast.error(res.error);
        return;
      }
      toast.success(mode === 'accept' ? 'Quote accepted' : 'Quote declined');
      setConfirm(null);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        type="button"
        color="brand"
        onClick={() => setConfirm('accept')}
        disabled={acceptDisabled}
        title={acceptTitle}
      >
        Mark accepted
      </Button>
      <Button
        type="button"
        destructive
        onClick={() => setConfirm('decline')}
        disabled={pending}
      >
        Decline
      </Button>
      {!msaSatisfied && (
        <p className="text-[11px] text-zinc-500">
          Sign the master agreement first to accept this quote.
        </p>
      )}

      <Dialog open={confirm != null} onClose={() => setConfirm(null)}>
        <DialogTitle>
          {confirm === 'decline' ? 'Decline this quote?' : 'Accept this quote?'}
        </DialogTitle>
        <DialogDescription>
          {confirm === 'decline'
            ? 'Marks the quote declined. This can’t be undone — issue a new quote if the customer changes their mind.'
            : 'Marks the quote accepted — the accepted quote becomes the contract, and a prospect dealer is promoted to active. This can’t be undone.'}
        </DialogDescription>
        <div className="mt-6 flex items-center justify-end gap-2">
          <Button type="button" outline onClick={() => setConfirm(null)} disabled={pending}>
            Cancel
          </Button>
          <Button
            type="button"
            {...(confirm === 'decline'
              ? ({ destructive: true } as const)
              : ({ color: 'brand' } as const))}
            onClick={() => confirm && run(confirm)}
            disabled={pending}
          >
            {pending ? 'Working…' : confirm === 'decline' ? 'Decline quote' : 'Mark accepted'}
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
