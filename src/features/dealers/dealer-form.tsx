'use client';

import { useActionState, useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import * as Form from '@radix-ui/react-form';
import { Dialog } from '@/components/ui/dialog';
import { toast } from '@/components/ui/toaster';
import { toLegacyResult } from '@/lib/actions/legacy-result';
import { createDealer, updateDealer } from '@/features/schedule/actions';
import type { Dealer } from '@/features/schedule/queries';

// Per-field touched/invalid state for inline required-field messages. Radix
// Form's `<Form.Message match="valueMissing">` only fires on `change` and
// `invalid` events — not blur — so a required field that's tabbed past
// without typing stays silent until submit. This hook adds the blur path:
// onBlur of an empty input flips touched=true; onChange to a non-empty value
// flips it back to false; onInvalid (fires when the form fails native
// validation on submit) catches never-focused fields. Used for required
// text fields only — typeMismatch (email shape) is still wired through
// Radix Form's stock `<Form.Message match="typeMismatch">`.
function useTouched() {
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const fieldHandlers = useCallback(
    (name: string) => ({
      onBlur: (e: React.FocusEvent<HTMLInputElement>) => {
        const empty = !e.currentTarget.value.trim();
        setTouched((t) => (t[name] === empty ? t : { ...t, [name]: empty }));
      },
      onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.currentTarget.value.trim()) {
          setTouched((t) => (t[name] ? { ...t, [name]: false } : t));
        }
      },
      onInvalid: () => {
        setTouched((t) => (t[name] ? t : { ...t, [name]: true }));
      },
    }),
    [],
  );
  return { touched, fieldHandlers };
}

type Mode = 'create' | 'edit';
type DealerFormState = { ok: true } | { error: string } | null;

const inputClass =
  'min-w-0 rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm text-stone-800 outline-none transition focus:border-accent focus:ring-3 focus:ring-accent/20';

const cancelClass =
  'rounded border border-stone-200 bg-white px-2 py-0.5 text-xs font-medium text-stone-600 transition hover:border-navy hover:text-navy';

const submitClass =
  'rounded-lg bg-navy px-3 py-2 text-xs font-semibold text-white transition hover:bg-navy-light disabled:cursor-not-allowed disabled:opacity-60';

const fieldClass = 'flex flex-col gap-1';
const labelClass = 'text-xs font-medium text-stone-600';
const messageClass = 'text-[11px] font-medium text-status-red';

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
  const { touched, fieldHandlers } = useTouched();
  const action = mode === 'create' ? createDealer : updateDealer;
  const [state, formAction, pending] = useActionState<DealerFormState, FormData>(
    async (_prev, fd) => toLegacyResult(await action(fd)),
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
    <Form.Root action={formAction} className="mt-4 flex flex-col gap-3">
      {mode === 'edit' && dealer && (
        <input type="hidden" name="id" value={dealer.id} />
      )}

      <Form.Field name="name" className={fieldClass}>
        <Form.Label className={labelClass}>Dealership name</Form.Label>
        <Form.Control asChild>
          <input
            type="text"
            defaultValue={dealer?.name ?? ''}
            className={inputClass}
            autoFocus
            required
            {...fieldHandlers('name')}
          />
        </Form.Control>
        {touched.name && (
          <span className={messageClass}>Dealership name is required.</span>
        )}
      </Form.Field>

      <div className="grid grid-cols-2 gap-2">
        <Form.Field name="contactFirst" className={fieldClass}>
          <Form.Label className={labelClass}>Contact first</Form.Label>
          <Form.Control asChild>
            <input
              type="text"
              defaultValue={dealer?.contactFirstName ?? ''}
              className={inputClass}
            />
          </Form.Control>
        </Form.Field>
        <Form.Field name="contactLast" className={fieldClass}>
          <Form.Label className={labelClass}>Contact last</Form.Label>
          <Form.Control asChild>
            <input
              type="text"
              defaultValue={dealer?.contactLastName ?? ''}
              className={inputClass}
            />
          </Form.Control>
        </Form.Field>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Form.Field name="contactEmail" className={fieldClass}>
          <Form.Label className={labelClass}>Email</Form.Label>
          <Form.Control asChild>
            <input
              type="email"
              defaultValue={dealer?.primaryEmail ?? ''}
              className={inputClass}
            />
          </Form.Control>
          <Form.Message match="typeMismatch" className={messageClass}>
            Email looks invalid.
          </Form.Message>
        </Form.Field>
        <Form.Field name="contactPhone" className={fieldClass}>
          <Form.Label className={labelClass}>Phone</Form.Label>
          <Form.Control asChild>
            <input
              type="tel"
              defaultValue={dealer?.primaryPhone ?? ''}
              className={inputClass}
            />
          </Form.Control>
        </Form.Field>
      </div>

      <Form.Field name="address" className={fieldClass}>
        <Form.Label className={labelClass}>Address</Form.Label>
        <Form.Control asChild>
          <input
            type="text"
            defaultValue={dealer?.address ?? ''}
            className={inputClass}
          />
        </Form.Control>
      </Form.Field>

      <div className="mt-2 flex justify-end gap-2">
        <Dialog.Close className={cancelClass}>Cancel</Dialog.Close>
        <Form.Submit asChild>
          <button type="submit" disabled={pending} className={submitClass}>
            {pending
              ? mode === 'create'
                ? 'Creating…'
                : 'Saving…'
              : mode === 'create'
                ? 'Add Dealer'
                : 'Save'}
          </button>
        </Form.Submit>
      </div>
    </Form.Root>
  );
}
