'use client';

import { useActionState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Dialog } from '@/components/ui/dialog';
import { toast } from '@/components/ui/toaster';
import { createDealer, updateDealer } from '@/features/schedule/actions';
import type { Dealer } from '@/features/schedule/queries';

type Mode = 'create' | 'edit';
type DealerFormState = { ok: true } | { error: string } | null;

const inputClass =
  'min-w-0 rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm text-stone-800 outline-none transition focus:border-accent focus:ring-3 focus:ring-accent/20';

const cancelClass =
  'rounded border border-stone-200 bg-white px-2 py-0.5 text-xs font-medium text-stone-600 transition hover:border-navy hover:text-navy';

const submitClass =
  'rounded-lg bg-navy px-3 py-2 text-xs font-semibold text-white transition hover:bg-navy-light disabled:cursor-not-allowed disabled:opacity-60';

export function DealerForm({
  mode,
  dealer,
  onSuccess,
}: {
  mode: Mode;
  dealer?: Dealer;
  onSuccess: () => void;
}) {
  const router = useRouter();
  const action = mode === 'create' ? createDealer : updateDealer;
  const [state, formAction, pending] = useActionState<DealerFormState, FormData>(
    async (_prev, fd) => action(fd),
    null,
  );

  useEffect(() => {
    if (!state) return;
    if ('ok' in state) {
      toast.success(mode === 'create' ? 'Dealer added' : 'Dealer saved');
      router.refresh();
      onSuccess();
    } else {
      toast.error(state.error);
    }
  }, [state, mode, router, onSuccess]);

  return (
    <form action={formAction} className="mt-4 flex flex-col gap-3">
      {mode === 'edit' && dealer && (
        <input type="hidden" name="id" value={dealer.id} />
      )}

      <label className="flex flex-col gap-1 text-xs font-medium text-stone-600">
        Dealership name
        <input
          type="text"
          name="name"
          defaultValue={dealer?.name ?? ''}
          className={inputClass}
          autoFocus
          required
        />
      </label>

      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1 text-xs font-medium text-stone-600">
          Contact first
          <input
            type="text"
            name="contactFirst"
            defaultValue={dealer?.contactFirstName ?? ''}
            className={inputClass}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-stone-600">
          Contact last
          <input
            type="text"
            name="contactLast"
            defaultValue={dealer?.contactLastName ?? ''}
            className={inputClass}
          />
        </label>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1 text-xs font-medium text-stone-600">
          Email
          <input
            type="email"
            name="contactEmail"
            defaultValue={dealer?.primaryEmail ?? ''}
            className={inputClass}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-stone-600">
          Phone
          <input
            type="tel"
            name="contactPhone"
            defaultValue={dealer?.primaryPhone ?? ''}
            className={inputClass}
          />
        </label>
      </div>

      <label className="flex flex-col gap-1 text-xs font-medium text-stone-600">
        Address
        <input
          type="text"
          name="address"
          defaultValue={dealer?.address ?? ''}
          className={inputClass}
        />
      </label>

      <div className="mt-2 flex justify-end gap-2">
        <Dialog.Close className={cancelClass}>Cancel</Dialog.Close>
        <button type="submit" disabled={pending} className={submitClass}>
          {pending
            ? mode === 'create'
              ? 'Creating…'
              : 'Saving…'
            : mode === 'create'
              ? 'Add Dealer'
              : 'Save'}
        </button>
      </div>
    </form>
  );
}
