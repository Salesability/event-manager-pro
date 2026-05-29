'use client';

import { useState } from 'react';
import { Button } from '@/components/catalyst/button';
import { MsaCreateDialog } from './msa-create-dialog';

export type MsaSendForSignatureButtonProps = {
  dealerId: number;
  dealerName: string;
  recipient: { email: string; firstName: string } | { error: string };
  /** The quote to bundle into the signature envelope — the quote currently
   *  open in the composer (0061). Replaces the dealer-page flow's "first draft
   *  quote" guess: the bundle is anchored to the quote the coach is looking at. */
  quote: { id: number; createdAt: Date };
  /** Mirror the Send-Quote button's guard. The envelope renders the *persisted*
   *  quote snapshot (`sendMsaEnvelope` reads `quote.lineItems` from the DB), so
   *  block sending while the composer has unsaved edits — otherwise the signed
   *  bundle would carry stale pricing — or while another action is in flight. */
  disabled?: boolean;
  /** Tooltip explaining the disabled state (e.g. "save first"). */
  title?: string;
};

// Primary toolbar CTA on the quote composer when the dealer has no usable MSA
// (0061). Clicking opens the bundled-envelope confirm dialog (MsaCreateDialog),
// which runs the two-step createMsaDraft → sendMsaEnvelope flow against THIS
// quote — the one open in the composer, not a dealer-wide "first draft" guess.
// 0061 moved this action off the (admin-only) dealer page onto the
// (admin+coach) quote page; the old dealer-page trigger was retired.
export function MsaSendForSignatureButton(props: MsaSendForSignatureButtonProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        type="button"
        color="green"
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
        firstDraftQuote={props.quote}
      />
    </>
  );
}
