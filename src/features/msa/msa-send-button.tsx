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
};

// Primary toolbar CTA on the quote composer when the dealer has no usable MSA
// (0061). Mirrors the dealer-page `MsaCreateTrigger` shape (button + dialog)
// but bundles the open quote instead of the dealer's first draft. Clicking
// opens the bundled-envelope confirm dialog, which runs the two-step
// createMsaDraft → sendMsaEnvelope flow against THIS quote.
export function MsaSendForSignatureButton(props: MsaSendForSignatureButtonProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" color="green" onClick={() => setOpen(true)}>
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
