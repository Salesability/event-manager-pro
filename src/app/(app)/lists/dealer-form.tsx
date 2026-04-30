'use client';

import { useActionState, useEffect } from 'react';
import { toast } from '@/components/ui/toaster';
import { createDealer, updateDealer } from '@/features/schedule/actions';
import type { Dealer } from '@/features/schedule/queries';

type Mode = 'create' | 'edit';
type State = { ok: true } | { error: string } | null;

type DealerFormProps = {
  mode: Mode;
  dealer?: Dealer;
  onSuccess: () => void;
};

export function DealerForm({ mode, dealer, onSuccess }: DealerFormProps) {
  const action = mode === 'create' ? createDealer : updateDealer;
  const [state, formAction, pending] = useActionState<State, FormData>(
    async (_prev, fd) => action(fd),
    null,
  );

  useEffect(() => {
    if (!state) return;
    if ('ok' in state) {
      toast.success(mode === 'create' ? 'Dealer added' : 'Dealer saved');
      onSuccess();
    } else {
      toast.error(state.error);
    }
  }, [state, mode, onSuccess]);

  return (
    <form action={formAction} className="mt-4 flex flex-col gap-4">
      {mode === 'edit' && dealer && (
        <input type="hidden" name="id" value={dealer.id} />
      )}

      <Field label="Dealership Name" htmlFor="dealer-name" required>
        <input
          id="dealer-name"
          name="name"
          type="text"
          required
          defaultValue={dealer?.name ?? ''}
          autoFocus
          className={inputClass}
        />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Contact First" htmlFor="dealer-contact-first">
          <input
            id="dealer-contact-first"
            name="contactFirst"
            type="text"
            defaultValue={dealer?.contactFirstName ?? ''}
            className={inputClass}
          />
        </Field>
        <Field label="Contact Last" htmlFor="dealer-contact-last">
          <input
            id="dealer-contact-last"
            name="contactLast"
            type="text"
            defaultValue={dealer?.contactLastName ?? ''}
            className={inputClass}
          />
        </Field>
      </div>

      <Field label="Phone" htmlFor="dealer-phone">
        <input
          id="dealer-phone"
          name="contactPhone"
          type="tel"
          defaultValue={dealer?.primaryPhone ?? ''}
          className={inputClass}
        />
      </Field>

      <Field label="Email" htmlFor="dealer-email">
        <input
          id="dealer-email"
          name="contactEmail"
          type="email"
          defaultValue={dealer?.primaryEmail ?? ''}
          className={inputClass}
        />
      </Field>

      <Field label="Address" htmlFor="dealer-address">
        <input
          id="dealer-address"
          name="address"
          type="text"
          defaultValue={dealer?.address ?? ''}
          className={inputClass}
        />
      </Field>

      <div className="mt-2 flex justify-end gap-2">
        <button
          type="button"
          onClick={onSuccess}
          className="rounded-lg border border-stone-200 bg-white px-4 py-2 text-sm font-medium text-stone-600 transition hover:border-stone-400 hover:text-navy"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-navy px-4 py-2 text-sm font-medium text-white transition hover:bg-navy-light disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pending ? 'Saving…' : mode === 'create' ? 'Add Dealer' : 'Save'}
        </button>
      </div>
    </form>
  );
}

const inputClass =
  'rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm text-stone-800 outline-none transition focus:border-accent focus:ring-3 focus:ring-accent/20';

function Field({
  label,
  htmlFor,
  required,
  children,
}: {
  label: string;
  htmlFor: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label
        htmlFor={htmlFor}
        className="text-xs font-semibold uppercase tracking-wide text-stone-600"
      >
        {label}
        {required && <span className="ml-1 text-status-red">*</span>}
      </label>
      {children}
    </div>
  );
}
