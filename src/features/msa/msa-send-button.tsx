'use client';

import { useState } from 'react';
import { Button } from '@/components/catalyst/button';
import { MsaCreateDialog } from './msa-create-dialog';

export type MsaSendForSignatureButtonProps = {
  dealerId: number;
  dealerName: string;
  recipient: { email: string; firstName: string } | { error: string };
  /** Disable while another action is in flight. */
  disabled?: boolean;
  /** Tooltip explaining the disabled state. */
  title?: string;
  /** 0104: originating event (from `?returnEvent=`) — a successful send returns
   *  to that event's dialog rather than refreshing the dealer page. */
  returnEventId?: number | null;
};

// "Send MSA for signature" CTA on the per-dealer MSA panel (`/dealerships/[id]`,
// 0082). Clicking opens the MSA-only confirm dialog (MsaCreateDialog), which
// runs the two-step createMsaDraft → sendMsaEnvelope flow. 0082 moved this
// action off the quote composer (where 0061 had bundled it with the quote) back
// to a dealer-centric surface — the quote now has its own send→accept lifecycle
// and the MSA signs on its own envelope.
export function MsaSendForSignatureButton(props: MsaSendForSignatureButtonProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        type="button"
        color="brand"
        onClick={() => setOpen(true)}
        disabled={props.disabled}
        title={props.title}
      >
        Send for signature
      </Button>
      <MsaCreateDialog
        open={open}
        onClose={() => setOpen(false)}
        dealerId={props.dealerId}
        dealerName={props.dealerName}
        recipient={props.recipient}
        returnEventId={props.returnEventId}
      />
    </>
  );
}
