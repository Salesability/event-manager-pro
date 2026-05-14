'use client';

import { useState } from 'react';
import {
  Dialog,
  DialogTitle,
} from '@/components/catalyst/dialog';
import { RowActions as RowActionGroup } from '@/components/app/row-actions';
import { BookingForm } from '@/app/(app)/calendar/booking-form';
import type { Campaign, Coach, Dealer, LookupOption } from '@/features/schedule/queries';

type Props = {
  campaign: Campaign;
  dealers: Dealer[];
  coaches: Coach[];
  styles: LookupOption[];
  sources: LookupOption[];
};

// 0043 Phase 6: production rows lock onto **Edit-only** per the canonical
// row-action vocabulary. `/production` has no `/production/[id]` detail page,
// so the View-xor-Edit rule resolves to Edit (the dialog form is the
// canonical editor). The previous "View" button surfaced a read-only
// `EventDetail` dialog that mostly re-stated what the row already shows —
// dropped here so the action vocabulary matches the rest of the app.
export function RowActions({ campaign, dealers, coaches, styles, sources }: Props) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);

  return (
    <>
      <RowActionGroup
        actions={[
          {
            kind: 'edit',
            onClick: () => setOpen(true),
            ariaSuffix: `${campaign.dealerName} campaign`,
          },
        ]}
      />
      <Dialog open={open} onClose={close}>
        <DialogTitle>Edit Campaign</DialogTitle>
        <BookingForm
          mode="edit"
          campaign={campaign}
          dealers={dealers}
          coaches={coaches}
          styles={styles}
          sources={sources}
          onSuccess={close}
        />
      </Dialog>
    </>
  );
}
