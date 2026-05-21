'use client';

import { useEffect, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  Field,
  FieldGroup,
  Label,
  Description,
} from '@/components/catalyst/fieldset';
import { FieldError } from '@/components/catalyst/field-compat';
import { Input } from '@/components/catalyst/input';
import { toast } from '@/components/ui/toaster';
import { toLegacyResult } from '@/lib/actions/legacy-result';
import { createDealer, updateDealer } from '@/features/schedule/actions';
import type { Dealer } from '@/features/schedule/queries';
import { dealerFormSchema, type DealerFormValues } from './dealer-schema';

// 0045 Phase 2 — schema-as-contract: `dealerFormSchema` now lives in the
// sibling `dealer-schema.ts` module and is imported by both this component
// (via `zodResolver`) and the Server Action (`createDealer` / `updateDealer`
// in `schedule/actions.ts`, via `safeParse(Object.fromEntries(formData))`).
//
// 0042 Phase 4 history — ported off Radix Form + useActionState onto RHF +
// shadcn Field primitives. The hand-rolled `useTouched` hook is gone; RHF's
// `mode: 'onTouched'` covers the blur-then-empty inline-error path.

type Mode = 'create' | 'edit';

const submitClass =
  'rounded-lg bg-brand-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60';

const cancelClass =
  'rounded border border-zinc-200 bg-white px-2 py-0.5 text-xs font-medium text-zinc-500 transition hover:border-brand-500 hover:text-brand-700';

function valuesToFormData(values: DealerFormValues, id?: number): FormData {
  const fd = new FormData();
  if (id != null) fd.set('id', String(id));
  fd.set('name', values.name);
  fd.set('contactFirst', values.contactFirst ?? '');
  fd.set('contactLast', values.contactLast ?? '');
  fd.set('contactEmail', values.contactEmail ?? '');
  fd.set('contactPhone', values.contactPhone ?? '');
  fd.set('address', values.address ?? '');
  // status is `'active' | 'prospect' | undefined` per the schema, but the form's
  // defaultValues always seed a definite value and the native <select> can't
  // unset it — the `??` keeps TS happy without changing runtime behaviour.
  fd.set('status', values.status ?? 'active');
  fd.set('acquiredVia', values.acquiredVia ?? '');
  return fd;
}

export function DealerForm({
  mode,
  dealer,
  onSuccess,
  onCancel,
  defaultStatus,
  autoFocus = true,
}: {
  mode: Mode;
  dealer?: Dealer;
  /** Fired after a successful save — dialog callers close themselves here.
   *  On create, receives the new dealer's `{ id, name }` so inline-create
   *  callers (the booking dialog's "+ Add", chunk 0056) can auto-select it;
   *  `undefined` on edit. Page-embedded use leaves this off entirely;
   *  `router.refresh()` already runs. */
  onSuccess?: (created?: { id: number; name: string }) => void;
  onCancel?: () => void;
  /** When set, hides the status select and submits this value. Used by the
   *  composer's inline "Add new prospect" flow (defaultStatus='prospect') so
   *  the back-office UI choice doesn't pollute the prospect-create path. */
  defaultStatus?: 'prospect' | 'active';
  /** Auto-focus the name input on mount. Defaults true (dialog UX — the
   *  user opened the form to start typing). Page-embedded use sets false
   *  so navigating to the detail page doesn't steal focus + scroll past
   *  the page header. */
  autoFocus?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const form = useForm<DealerFormValues>({
    resolver: zodResolver(dealerFormSchema),
    defaultValues: {
      name: dealer?.name ?? '',
      contactFirst: dealer?.contactFirstName ?? '',
      contactLast: dealer?.contactLastName ?? '',
      contactEmail: dealer?.primaryEmail ?? '',
      contactPhone: dealer?.primaryPhone ?? '',
      address: dealer?.address ?? '',
      // create-only hint: the composer's inline-prospect path forces
      // 'prospect' here; edit mode honours the existing row's status.
      status:
        defaultStatus && mode === 'create'
          ? defaultStatus
          : (dealer?.status ?? 'active'),
      acquiredVia: dealer?.acquiredVia ?? '',
    },
    mode: 'onTouched',
  });
  const { register, handleSubmit, formState, setFocus } = form;
  const { errors } = formState;

  useEffect(() => {
    if (autoFocus) setFocus('name');
  }, [autoFocus, setFocus]);

  const onSubmit = handleSubmit((values) => {
    startTransition(async () => {
      const action = mode === 'create' ? createDealer : updateDealer;
      const fd = valuesToFormData(values, mode === 'edit' ? dealer?.id : undefined);
      const result = toLegacyResult<{ ok: true; dealerId?: number }>(await action(fd));
      if ('ok' in result) {
        toast.success(mode === 'create' ? 'Dealer added' : 'Dealer saved');
        router.refresh();
        onSuccess?.(
          mode === 'create' && result.dealerId != null
            ? { id: result.dealerId, name: values.name }
            : undefined,
        );
      } else {
        toast.error(result.error);
      }
    });
  });

  const hideStatusSelect = defaultStatus != null && mode === 'create';

  return (
    <form onSubmit={onSubmit} className="mt-4 flex flex-col gap-3">
      <FieldGroup>
        <Field>
          <Label htmlFor="df-name">Dealership name</Label>
          <Input
            id="df-name"
            type="text"
            aria-invalid={!!errors.name || undefined}
            {...register('name')}
          />
          {errors.name && <FieldError>{errors.name.message}</FieldError>}
        </Field>

        <div className="grid grid-cols-2 gap-2">
          <Field>
            <Label htmlFor="df-contactFirst">Contact first</Label>
            <Input id="df-contactFirst" type="text" {...register('contactFirst')} />
          </Field>
          <Field>
            <Label htmlFor="df-contactLast">Contact last</Label>
            <Input id="df-contactLast" type="text" {...register('contactLast')} />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <Field>
            <Label htmlFor="df-contactEmail">Email</Label>
            <Input
              id="df-contactEmail"
              type="email"
              aria-invalid={!!errors.contactEmail || undefined}
              {...register('contactEmail')}
            />
            {errors.contactEmail && (
              <FieldError>{errors.contactEmail.message}</FieldError>
            )}
          </Field>
          <Field>
            <Label htmlFor="df-contactPhone">Phone</Label>
            <Input id="df-contactPhone" type="tel" {...register('contactPhone')} />
          </Field>
        </div>

        <Field>
          <Label htmlFor="df-address">Address</Label>
          <Input id="df-address" type="text" {...register('address')} />
        </Field>

        {!hideStatusSelect && (
          <Field>
            <Label htmlFor="df-status">Status</Label>
            {/* Native select — shadcn's <Select> is a Base UI dropdown
                composition that adds layout complexity for a 2-option toggle.
                Keep the native <select> until a clear UX win surfaces. */}
            <select
              id="df-status"
              className="h-8 w-full min-w-0 rounded-lg border border-zinc-300 bg-transparent px-2.5 py-1 text-sm outline-none focus-visible:border-zinc-400 focus-visible:ring-3 focus-visible:ring-zinc-400/50 md:text-sm"
              {...register('status')}
            >
              <option value="active">Active</option>
              <option value="prospect">Prospect</option>
            </select>
          </Field>
        )}

        <Field>
          <Label htmlFor="df-acquiredVia">
            How did this dealer find us? (optional)
          </Label>
          <Input
            id="df-acquiredVia"
            type="text"
            maxLength={200}
            placeholder="Book Your Event form / referral / outbound / trade show"
            {...register('acquiredVia')}
          />
          <Description>Up to 200 characters.</Description>
        </Field>
      </FieldGroup>

      <div className="mt-2 flex justify-end gap-2">
        {onCancel && (
          <button type="button" onClick={onCancel} className={cancelClass}>
            Cancel
          </button>
        )}
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

// Re-export Label so callers that previously imported from this file keep working.
export { Label };
