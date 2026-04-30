'use client';

import { useState } from 'react';
import { Dialog } from '@/components/ui/dialog';
import { BookingForm } from '@/app/(app)/calendar/booking-form';
import { EventDetail } from '@/app/(app)/calendar/event-detail';
import type { Campaign, Coach, Dealer, LookupOption } from '@/features/schedule/queries';

type DialogState =
  | { kind: 'closed' }
  | { kind: 'detail' }
  | { kind: 'edit' };

type Props = {
  campaign: Campaign;
  dealers: Dealer[];
  coaches: Coach[];
  styles: LookupOption[];
  sources: LookupOption[];
};

export function RowActions({ campaign, dealers, coaches, styles, sources }: Props) {
  const [dialog, setDialog] = useState<DialogState>({ kind: 'closed' });
  const close = () => setDialog({ kind: 'closed' });

  return (
    <div className="flex shrink-0 items-center gap-1">
      <button
        type="button"
        onClick={() => setDialog({ kind: 'detail' })}
        className="rounded border border-stone-200 bg-white px-2 py-0.5 text-xs font-medium text-stone-600 transition hover:border-navy hover:text-navy"
      >
        View
      </button>
      <button
        type="button"
        onClick={() => setDialog({ kind: 'edit' })}
        className="rounded border border-stone-200 bg-white px-2 py-0.5 text-xs font-medium text-stone-600 transition hover:border-navy hover:text-navy"
      >
        Edit
      </button>
      <Dialog.Root open={dialog.kind !== 'closed'} onClose={close}>
        <Dialog.Backdrop />
        <Dialog.Panel>
          {dialog.kind === 'detail' && (
            <>
              <Dialog.Title>Campaign Detail</Dialog.Title>
              <EventDetail
                campaign={campaign}
                onEdit={() => setDialog({ kind: 'edit' })}
                onClose={close}
              />
            </>
          )}
          {dialog.kind === 'edit' && (
            <>
              <Dialog.Title>Edit Campaign</Dialog.Title>
              <BookingForm
                mode="edit"
                campaign={campaign}
                dealers={dealers}
                coaches={coaches}
                styles={styles}
                sources={sources}
                onSuccess={close}
              />
            </>
          )}
        </Dialog.Panel>
      </Dialog.Root>
    </div>
  );
}
