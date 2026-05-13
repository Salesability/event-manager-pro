'use client';

import { useEffect, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Dialog } from '@/components/ui/dialog';
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from '@/components/ui/toaster';
import { toLegacyResult } from '@/lib/actions/legacy-result';
import { createDealer, updateDealer } from '@/features/schedule/actions';
import type { Dealer } from '@/features/schedule/queries';

// 0042 Phase 4 — ported off Radix Form + useActionState onto RHF + shadcn
// Field primitives. The hand-rolled `useTouched` hook is gone; RHF's
// `mode: 'onTouched'` covers the blur-then-empty inline-error path. Email
// shape validation moved off `<Form.Message match="typeMismatch">` to zod.
// Server Action submission target unchanged (`createDealer` / `updateDealer`
// via `toLegacyResult`); the form constructs FormData from RHF values at
// submit time so the action layer stays stable.

type Mode = 'create' | 'edit';

const dealerFormSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Dealership name is required.'),
  contactFirst: z.string().trim().optional(),
  contactLast: z.string().trim().optional(),
  contactEmail: z
    .string()
    .trim()
    .refine(
      (v) => v === '' || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v),
      'Email looks invalid.',
    )
    .optional(),
  contactPhone: z.string().trim().optional(),
  address: z.string().trim().optional(),
  status: z.enum(['active', 'prospect']),
  acquiredVia: z.string().trim().max(200).optional(),
});
type DealerFormValues = z.infer<typeof dealerFormSchema>;

const submitClass =
  'rounded-lg bg-navy px-3 py-2 text-xs font-semibold text-white transition hover:bg-navy-light disabled:cursor-not-allowed disabled:opacity-60';

const cancelClass =
  'rounded border border-stone-200 bg-white px-2 py-0.5 text-xs font-medium text-stone-600 transition hover:border-navy hover:text-navy';

function valuesToFormData(values: DealerFormValues, id?: number): FormData {
  const fd = new FormData();
  if (id != null) fd.set('id', String(id));
  fd.set('name', values.name);
  fd.set('contactFirst', values.contactFirst ?? '');
  fd.set('contactLast', values.contactLast ?? '');
  fd.set('contactEmail', values.contactEmail ?? '');
  fd.set('contactPhone', values.contactPhone ?? '');
  fd.set('address', values.address ?? '');
  fd.set('status', values.status);
  fd.set('acquiredVia', values.acquiredVia ?? '');
  return fd;
}

export function DealerForm({
  mode,
  dealer,
  onSuccess,
  defaultStatus,
}: {
  mode: Mode;
  dealer?: Dealer;
  onSuccess: () => void;
  /** When set, hides the status select and submits this value. Used by the
   *  composer's inline "Add new prospect" flow (defaultStatus='prospect') so
   *  the back-office UI choice doesn't pollute the prospect-create path. */
  defaultStatus?: 'prospect' | 'active';
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

  // Match the original auto-focus on the name input.
  useEffect(() => {
    setFocus('name');
  }, [setFocus]);

  const onSubmit = handleSubmit((values) => {
    startTransition(async () => {
      const action = mode === 'create' ? createDealer : updateDealer;
      const fd = valuesToFormData(values, mode === 'edit' ? dealer?.id : undefined);
      const result = toLegacyResult(await action(fd));
      if ('ok' in result) {
        toast.success(mode === 'create' ? 'Dealer added' : 'Dealer saved');
        router.refresh();
        onSuccess();
      } else {
        toast.error(result.error);
      }
    });
  });

  const hideStatusSelect = defaultStatus != null && mode === 'create';

  return (
    <form onSubmit={onSubmit} className="mt-4 flex flex-col gap-3">
      <FieldGroup>
        <Field data-invalid={!!errors.name || undefined}>
          <FieldLabel htmlFor="df-name">Dealership name</FieldLabel>
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
            <FieldLabel htmlFor="df-contactFirst">Contact first</FieldLabel>
            <Input id="df-contactFirst" type="text" {...register('contactFirst')} />
          </Field>
          <Field>
            <FieldLabel htmlFor="df-contactLast">Contact last</FieldLabel>
            <Input id="df-contactLast" type="text" {...register('contactLast')} />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <Field data-invalid={!!errors.contactEmail || undefined}>
            <FieldLabel htmlFor="df-contactEmail">Email</FieldLabel>
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
            <FieldLabel htmlFor="df-contactPhone">Phone</FieldLabel>
            <Input id="df-contactPhone" type="tel" {...register('contactPhone')} />
          </Field>
        </div>

        <Field>
          <FieldLabel htmlFor="df-address">Address</FieldLabel>
          <Input id="df-address" type="text" {...register('address')} />
        </Field>

        {!hideStatusSelect && (
          <Field>
            <FieldLabel htmlFor="df-status">Status</FieldLabel>
            {/* Native select — shadcn's <Select> is a Base UI dropdown
                composition that adds layout complexity for a 2-option toggle.
                Keep the native <select> until a clear UX win surfaces. */}
            <select
              id="df-status"
              className="h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm"
              {...register('status')}
            >
              <option value="active">Active</option>
              <option value="prospect">Prospect</option>
            </select>
          </Field>
        )}

        <Field>
          <FieldLabel htmlFor="df-acquiredVia">
            How did this dealer find us? (optional)
          </FieldLabel>
          <Input
            id="df-acquiredVia"
            type="text"
            maxLength={200}
            placeholder="Book Your Event form / referral / outbound / trade show"
            {...register('acquiredVia')}
          />
          <FieldDescription>Up to 200 characters.</FieldDescription>
        </Field>
      </FieldGroup>

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

// Re-export Label so callers that previously imported from this file keep working.
export { Label };
