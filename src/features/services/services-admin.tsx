'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Can } from '@/components/auth/can';
import { toast } from '@/components/ui/toaster';
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { toLegacyResult } from '@/lib/actions/legacy-result';
import {
  archiveServiceItem,
  createServiceItem,
  updateServiceItem,
} from '@/features/services/actions';
import type { ServiceItem, ServiceItemUnit } from '@/features/services/queries';
import {
  SERVICE_UNITS,
  serviceItemFormSchema,
  type ServiceItemFormValues,
} from './service-schema';

const UNIT_LABEL: Record<ServiceItemUnit, string> = {
  flat: 'Flat',
  'per-record': 'Per record',
  'per-touch': 'Per touch',
  'per-day': 'Per day',
  range: 'Range',
};

const selectClass =
  'h-9 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm';

const buttonClass =
  'rounded-lg border border-border bg-white px-3 py-2 text-xs font-semibold text-foreground transition hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-50';

const submitClass =
  'rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-white transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60';

function formatPrice(item: ServiceItem): string {
  if (item.unit === 'range') {
    if (item.unitPriceMin != null && item.unitPriceMax != null) {
      return `$${item.unitPriceMin}–$${item.unitPriceMax}`;
    }
    return '—';
  }
  return item.unitPrice == null ? 'variable' : `$${item.unitPrice}`;
}

export function ServicesAdmin({ items }: { items: ServiceItem[] }) {
  const router = useRouter();
  const rows = useMemo(() => items, [items]);

  return (
    <section className="rounded-2xl border border-border bg-white p-5 shadow-[0_1px_4px_rgba(15,30,60,0.08)]">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="font-sans font-bold tracking-tight text-2xl text-primary">Services</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Catalog the quote composer reads. Codes are immutable; archive instead of renaming.
          </p>
        </div>
        <span className="rounded-full bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary">
          {rows.length}
        </span>
      </div>

      <Can capability="lookup:edit">
        <div className="mt-4 rounded-xl border border-border bg-muted p-4">
          <ServiceForm
            mode="create"
            defaultSortOrder={rows.length}
            onSuccess={() => router.refresh()}
          />
        </div>
      </Can>

      <div className="mt-4 flex flex-col divide-y divide-stone-100">
        {rows.length === 0 ? (
          <div className="rounded-lg bg-muted px-3 py-6 text-center text-sm text-muted-foreground">
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
          <span className="font-mono text-xs text-muted-foreground">{item.code}</span>
          <span className="text-sm font-medium text-foreground">{item.label}</span>
          <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            {UNIT_LABEL[item.unit]}
          </span>
          <span className="text-sm tabular-nums text-foreground">{formatPrice(item)}</span>
        </div>
        {item.description ? (
          <p className="mt-0.5 text-xs text-muted-foreground">{item.description}</p>
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
          className="rounded-lg border border-border bg-white px-3 py-2 text-xs font-bold text-status-red transition hover:border-status-red hover:bg-status-red/10 disabled:cursor-not-allowed disabled:opacity-50"
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
        unit: props.item.unit,
        description: props.item.description ?? '',
        sortOrder: String(props.item.sortOrder),
        unitPrice: props.item.unitPrice ?? '',
        unitPriceMin: props.item.unitPriceMin ?? '',
        unitPriceMax: props.item.unitPriceMax ?? '',
      };
    }
    return {
      code: '',
      label: '',
      unit: 'flat',
      description: '',
      sortOrder: String(props.defaultSortOrder),
      unitPrice: '',
      unitPriceMin: '',
      unitPriceMax: '',
    };
  }, [isEdit, props]);

  const form = useForm<ServiceItemFormValues>({
    resolver: zodResolver(serviceItemFormSchema),
    defaultValues,
    mode: 'onTouched',
  });
  const { register, handleSubmit, watch, reset, formState } = form;
  const { errors, isSubmitting } = formState;
  const unit = watch('unit');

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
            <FieldLabel>Code</FieldLabel>
            <div className="flex h-9 items-center rounded-lg border border-border bg-muted px-3 font-mono text-xs text-muted-foreground">
              {props.item.code}
            </div>
          </Field>
        ) : (
          <Field data-invalid={!!errors.code || undefined} className="md:col-span-2">
            <FieldLabel htmlFor="svc-code">Code</FieldLabel>
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

        <Field data-invalid={!!errors.label || undefined} className="md:col-span-2">
          <FieldLabel htmlFor="svc-label">Label</FieldLabel>
          <Input
            id="svc-label"
            type="text"
            maxLength={120}
            aria-invalid={!!errors.label || undefined}
            {...register('label')}
          />
          {errors.label && <FieldError>{errors.label.message}</FieldError>}
        </Field>

        <Field data-invalid={!!errors.unit || undefined}>
          <FieldLabel htmlFor="svc-unit">Unit</FieldLabel>
          <select id="svc-unit" className={selectClass} {...register('unit')}>
            {SERVICE_UNITS.map((u) => (
              <option key={u} value={u}>
                {UNIT_LABEL[u]}
              </option>
            ))}
          </select>
          {errors.unit && <FieldError>{errors.unit.message}</FieldError>}
        </Field>

        <Field data-invalid={!!errors.sortOrder || undefined}>
          <FieldLabel htmlFor="svc-sort">Sort</FieldLabel>
          <Input
            id="svc-sort"
            type="number"
            min={0}
            aria-invalid={!!errors.sortOrder || undefined}
            {...register('sortOrder')}
          />
          {errors.sortOrder && <FieldError>{errors.sortOrder.message}</FieldError>}
        </Field>

        {unit === 'range' ? (
          <>
            <Field data-invalid={!!errors.unitPriceMin || undefined}>
              <FieldLabel htmlFor="svc-min">Min $</FieldLabel>
              <Input
                id="svc-min"
                type="number"
                step="0.01"
                min={0}
                aria-invalid={!!errors.unitPriceMin || undefined}
                {...register('unitPriceMin')}
              />
              {errors.unitPriceMin && (
                <FieldError>{errors.unitPriceMin.message}</FieldError>
              )}
            </Field>
            <Field data-invalid={!!errors.unitPriceMax || undefined}>
              <FieldLabel htmlFor="svc-max">Max $</FieldLabel>
              <Input
                id="svc-max"
                type="number"
                step="0.01"
                min={0}
                aria-invalid={!!errors.unitPriceMax || undefined}
                {...register('unitPriceMax')}
              />
              {errors.unitPriceMax && (
                <FieldError>{errors.unitPriceMax.message}</FieldError>
              )}
            </Field>
          </>
        ) : (
          <Field data-invalid={!!errors.unitPrice || undefined} className="md:col-span-2">
            <FieldLabel htmlFor="svc-price">Unit $ (blank = variable)</FieldLabel>
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
        )}

        <Field
          data-invalid={!!errors.description || undefined}
          className="md:col-span-4"
        >
          <FieldLabel htmlFor="svc-desc">Description (optional)</FieldLabel>
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
  fd.set('unit', values.unit);
  fd.set('description', values.description ?? '');
  fd.set('sortOrder', values.sortOrder ?? '');
  if (values.unit === 'range') {
    fd.set('unitPriceMin', values.unitPriceMin ?? '');
    fd.set('unitPriceMax', values.unitPriceMax ?? '');
  } else {
    fd.set('unitPrice', values.unitPrice ?? '');
  }
  return fd;
}
