'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Can } from '@/components/auth/can';
import { toast } from '@/components/ui/toaster';
import { Field, FieldGroup, Label } from '@/components/catalyst/fieldset';
import { FieldError } from '@/components/catalyst/field-compat';
import { Input } from '@/components/catalyst/input';
import { toLegacyResult } from '@/lib/actions/legacy-result';
import {
  archiveServiceItem,
  createServiceItem,
  updateServiceItem,
} from '@/features/services/actions';
import type { ServiceItem } from '@/features/services/queries';
import { serviceItemFormSchema, type ServiceItemFormValues } from './service-schema';

const buttonClass =
  'rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs font-semibold text-zinc-900 transition hover:border-brand-500 hover:text-brand-700 disabled:cursor-not-allowed disabled:opacity-50';

const submitClass =
  'rounded-lg bg-brand-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60';

function formatPrice(item: ServiceItem): string {
  return item.unitPrice == null ? 'variable' : `$${item.unitPrice}`;
}

export function ServicesAdmin({ items }: { items: ServiceItem[] }) {
  const router = useRouter();
  const rows = useMemo(() => items, [items]);

  return (
    <section className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-[0_1px_4px_rgba(15,30,60,0.08)]">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="font-sans font-bold tracking-tight text-2xl text-brand-700">Services</h2>
          <p className="mt-1 text-sm text-zinc-500">
            Catalog the quote composer reads. Codes are immutable; archive instead of renaming.
          </p>
        </div>
        <span className="rounded-full bg-brand-50 px-2.5 py-1 text-xs font-semibold text-brand-700">
          {rows.length}
        </span>
      </div>

      <Can capability="lookup:edit">
        <div className="mt-4 rounded-xl border border-zinc-200 bg-zinc-100 p-4">
          <ServiceForm
            mode="create"
            defaultSortOrder={rows.length}
            onSuccess={() => router.refresh()}
          />
        </div>
      </Can>

      <div className="mt-4 flex flex-col divide-y divide-zinc-200">
        {rows.length === 0 ? (
          <div className="rounded-lg bg-zinc-100 px-3 py-6 text-center text-sm text-zinc-500">
            No service items yet.
          </div>
        ) : (
          rows.map((item) => (
            <ServiceRow key={item.id} item={item} onChanged={() => router.refresh()} />
          ))
        )}
      </div>
    </section>
  );
}

function ServiceRow({ item, onChanged }: { item: ServiceItem; onChanged: () => void }) {
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();

  if (editing) {
    return (
      <ServiceForm
        mode="edit"
        item={item}
        onSuccess={() => {
          setEditing(false);
          onChanged();
        }}
        onCancel={() => setEditing(false)}
      />
    );
  }

  return (
    <div className="flex min-h-14 items-center gap-3 py-3">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-2">
          <span className="font-mono text-xs text-zinc-500">{item.code}</span>
          <span className="text-sm font-medium text-zinc-900">{item.label}</span>
          <span className="text-sm tabular-nums text-zinc-900">{formatPrice(item)}</span>
        </div>
        {item.description ? (
          <p className="mt-0.5 text-xs text-zinc-500">{item.description}</p>
        ) : null}
      </div>
      <Can capability="lookup:edit">
        <button type="button" onClick={() => setEditing(true)} className={buttonClass}>
          Edit
        </button>
        <button
          type="button"
          disabled={pending}
          aria-label={`Archive ${item.label}`}
          onClick={() => {
            if (
              !confirm(
                `Archive ${item.label}? Active quotes already referencing this catalog row are unaffected.`,
              )
            )
              return;
            startTransition(async () => {
              const fd = new FormData();
              fd.set('id', String(item.id));
              const result = toLegacyResult(await archiveServiceItem(fd));
              if ('ok' in result) {
                toast.success('Service item archived');
                onChanged();
              } else {
                toast.error(result.error);
              }
            });
          }}
          className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs font-bold text-red-700 transition hover:border-red-500 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          x
        </button>
      </Can>
    </div>
  );
}

type ServiceFormProps =
  | {
      mode: 'create';
      defaultSortOrder: number;
      onSuccess: () => void;
      onCancel?: undefined;
      item?: undefined;
    }
  | {
      mode: 'edit';
      item: ServiceItem;
      onSuccess: () => void;
      onCancel: () => void;
      defaultSortOrder?: undefined;
    };

function ServiceForm(props: ServiceFormProps) {
  const isEdit = props.mode === 'edit';
  const defaultValues: ServiceItemFormValues = useMemo(() => {
    if (isEdit) {
      return {
        code: props.item.code,
        label: props.item.label,
        description: props.item.description ?? '',
        sortOrder: String(props.item.sortOrder),
        unitPrice: props.item.unitPrice ?? '',
      };
    }
    return {
      code: '',
      label: '',
      description: '',
      sortOrder: String(props.defaultSortOrder),
      unitPrice: '',
    };
  }, [isEdit, props]);

  const form = useForm<ServiceItemFormValues>({
    resolver: zodResolver(serviceItemFormSchema),
    defaultValues,
    mode: 'onTouched',
  });
  const { register, handleSubmit, reset, formState } = form;
  const { errors, isSubmitting } = formState;

  const onSubmit = handleSubmit(async (values) => {
    const fd = valuesToFormData(values, isEdit ? props.item.id : undefined);
    const action = isEdit ? updateServiceItem : createServiceItem;
    const result = toLegacyResult(await action(fd));
    if ('ok' in result) {
      toast.success(isEdit ? 'Service item updated' : 'Service item added');
      if (!isEdit) reset(defaultValues);
      props.onSuccess();
    } else if (result.fieldErrors) {
      for (const [name, messages] of Object.entries(result.fieldErrors)) {
        const msg = messages?.[0];
        if (msg) form.setError(name as keyof ServiceItemFormValues, { type: 'server', message: msg });
      }
    } else {
      toast.error(result.error);
    }
  });

  return (
    <form onSubmit={onSubmit} className="grid grid-cols-1 gap-3 md:grid-cols-6">
      <FieldGroup className="md:col-span-6 md:grid md:grid-cols-6 md:gap-3 md:space-y-0">
        {isEdit ? (
          <Field className="md:col-span-2">
            <Label>Code</Label>
            <div className="flex h-9 items-center rounded-lg border border-zinc-200 bg-zinc-100 px-3 font-mono text-xs text-zinc-500">
              {props.item.code}
            </div>
          </Field>
        ) : (
          <Field className="md:col-span-2">
            <Label htmlFor="svc-code">Code</Label>
            <Input
              id="svc-code"
              type="text"
              placeholder="code (kebab-case)"
              maxLength={60}
              aria-invalid={!!errors.code || undefined}
              {...register('code')}
            />
            {errors.code && <FieldError>{errors.code.message}</FieldError>}
          </Field>
        )}

        <Field className="md:col-span-2">
          <Label htmlFor="svc-label">Label</Label>
          <Input
            id="svc-label"
            type="text"
            maxLength={120}
            aria-invalid={!!errors.label || undefined}
            {...register('label')}
          />
          {errors.label && <FieldError>{errors.label.message}</FieldError>}
        </Field>

        <Field>
          <Label htmlFor="svc-sort">Sort</Label>
          <Input
            id="svc-sort"
            type="number"
            min={0}
            aria-invalid={!!errors.sortOrder || undefined}
            {...register('sortOrder')}
          />
          {errors.sortOrder && <FieldError>{errors.sortOrder.message}</FieldError>}
        </Field>

        <Field className="md:col-span-2">
          <Label htmlFor="svc-price">Unit $ (blank = variable)</Label>
          <Input
            id="svc-price"
            type="number"
            step="0.01"
            min={0}
            aria-invalid={!!errors.unitPrice || undefined}
            {...register('unitPrice')}
          />
          {errors.unitPrice && <FieldError>{errors.unitPrice.message}</FieldError>}
        </Field>

        <Field className="md:col-span-4">
          <Label htmlFor="svc-desc">Description (optional)</Label>
          <Input
            id="svc-desc"
            type="text"
            maxLength={500}
            aria-invalid={!!errors.description || undefined}
            {...register('description')}
          />
          {errors.description && <FieldError>{errors.description.message}</FieldError>}
        </Field>
      </FieldGroup>

      <div className="flex items-end justify-end gap-2 md:col-span-2">
        {isEdit && (
          <button type="button" onClick={props.onCancel} className={buttonClass}>
            Cancel
          </button>
        )}
        <button type="submit" disabled={isSubmitting} className={submitClass}>
          {isEdit ? 'Save' : 'Add Service'}
        </button>
      </div>
    </form>
  );
}

function valuesToFormData(values: ServiceItemFormValues, id?: number): FormData {
  const fd = new FormData();
  if (id != null) fd.set('id', String(id));
  if (values.code) fd.set('code', values.code);
  fd.set('label', values.label);
  fd.set('description', values.description ?? '');
  fd.set('sortOrder', values.sortOrder ?? '');
  fd.set('unitPrice', values.unitPrice ?? '');
  return fd;
}
