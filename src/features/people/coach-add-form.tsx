'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Field, FieldGroup, Label } from '@/components/catalyst/fieldset';
import { FieldError } from '@/components/catalyst/field-compat';
import { Input } from '@/components/catalyst/input';
import { Button } from '@/components/catalyst/button';
import { toast } from '@/components/ui/toaster';
import { toLegacyResult } from '@/lib/actions/legacy-result';
import type { DuplicateResult } from '@/features/dealers/duplicate-types';
import { DuplicateNotice, duplicateMessage } from '@/features/dealers/duplicate-notice';
import { createPerson } from './actions';
import {
  coachFormSchema,
  coachValuesToFormData,
  type CoachFormValues,
} from './coach-add-schema';

// Focused coach quick-add for the booking dialog (chunk 0056). Deliberately NOT
// the full PersonForm (people-admin.tsx:336) — booking-time coach creation only
// needs a name + contact email/phone; the coach role and app access are forced.
// Reuses the `createPerson` Server Action (the single source for person-creation
// validation + auth/identifier wiring), so this component owns only the minimal
// UI. Schema + wire-format live in `coach-add-schema.ts` (pure, unit-tested).
// Mirrors DealerForm's RHF + zodResolver + toLegacyResult shape.

export function CoachAddForm({
  onCreated,
  onCancel,
}: {
  /** Fired after a coach is created so the caller can append + select the new
   *  option in the picker. `id` matches the coach picker's value
   *  (`Coach.id === contacts.id`); the name fields let the caller render the
   *  option label without waiting for a refetch. */
  onCreated?: (coach: { id: number; firstName: string; lastName: string }) => void;
  onCancel?: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  // 0085: an email/phone already held by another contact — surfaced
  // informationally (a coach IS a contact, so no create-anyway / re-link).
  const [duplicate, setDuplicate] = useState<DuplicateResult | null>(null);
  const form = useForm<CoachFormValues>({
    resolver: zodResolver(coachFormSchema),
    defaultValues: { firstName: '', lastName: '', email: '', phone: '' },
    mode: 'onTouched',
  });
  const { register, handleSubmit, formState, setFocus } = form;
  const { errors } = formState;

  useEffect(() => {
    setFocus('firstName');
  }, [setFocus]);

  const onSubmit = handleSubmit((values) => {
    setDuplicate(null);
    startTransition(async () => {
      const result = toLegacyResult<
        { ok: true; contactId?: number; warning?: string } | { duplicate: DuplicateResult }
      >(await createPerson(coachValuesToFormData(values)));
      if ('ok' in result) {
        if (result.warning) toast.error(result.warning);
        else toast.success('Coach added');
        router.refresh();
        if (result.contactId != null) {
          onCreated?.({
            id: result.contactId,
            firstName: values.firstName,
            lastName: values.lastName,
          });
        }
      } else if ('duplicate' in result) {
        setDuplicate(result.duplicate);
      } else {
        toast.error(result.error);
      }
    });
  });

  return (
    <form onSubmit={onSubmit} className="mt-4 flex flex-col gap-3">
      <FieldGroup>
        <div className="grid grid-cols-2 gap-2">
          <Field>
            <Label htmlFor="coach-firstName">First name</Label>
            <Input
              id="coach-firstName"
              type="text"
              aria-invalid={!!errors.firstName || undefined}
              {...register('firstName')}
            />
            {errors.firstName && <FieldError>{errors.firstName.message}</FieldError>}
          </Field>
          <Field>
            <Label htmlFor="coach-lastName">Last name</Label>
            <Input
              id="coach-lastName"
              type="text"
              aria-invalid={!!errors.lastName || undefined}
              {...register('lastName')}
            />
            {errors.lastName && <FieldError>{errors.lastName.message}</FieldError>}
          </Field>
        </div>
        <Field>
          <Label htmlFor="coach-email">Email</Label>
          <Input
            id="coach-email"
            type="email"
            aria-invalid={!!errors.email || undefined}
            {...register('email')}
          />
          {errors.email && <FieldError>{errors.email.message}</FieldError>}
        </Field>
        <Field>
          <Label htmlFor="coach-phone">Phone</Label>
          <Input id="coach-phone" type="tel" {...register('phone')} />
        </Field>
      </FieldGroup>
      {duplicate && (
        <DuplicateNotice message={duplicateMessage(duplicate)}>
          <Button type="button" outline compact onClick={() => setDuplicate(null)}>
            Dismiss
          </Button>
        </DuplicateNotice>
      )}
      <div className="mt-2 flex justify-end gap-2">
        <Button type="button" outline onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" color="brand" disabled={pending}>
          {pending ? 'Adding…' : 'Add Coach'}
        </Button>
      </div>
    </form>
  );
}
