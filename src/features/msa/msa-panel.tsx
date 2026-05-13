'use client';

import { useState } from 'react';
import { MsaCreateDialog } from './msa-create-dialog';

export type MsaPanelTriggerProps = {
  dealerId: number;
  dealerName: string;
  recipient: { email: string; firstName: string } | { error: string };
  firstDraftQuoteId: number | null;
};

// Client-side trigger button + dialog wrapper. The dealership page renders
// the rest of the panel server-side (status pill, signed date, download link);
// only the "Create MSA" button needs hydration since opening the dialog is
// stateful.
export function MsaCreateTrigger(props: MsaPanelTriggerProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-lg border border-accent/40 bg-white px-3 py-1 text-xs font-semibold text-accent transition hover:border-accent hover:bg-accent/10"
      >
        Create MSA + send for signature
      </button>
      <MsaCreateDialog
        open={open}
        onClose={() => setOpen(false)}
        dealerId={props.dealerId}
        dealerName={props.dealerName}
        recipient={props.recipient}
        firstDraftQuoteId={props.firstDraftQuoteId}
      />
    </>
  );
}
