'use client';

import { useMemo, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Can } from '@/components/auth/can';
import { toast } from '@/components/ui/toaster';
import { toLegacyResult } from '@/lib/actions/legacy-result';
import {
  archiveServiceItem,
  createServiceItem,
  updateServiceItem,
} from '@/features/services/actions';
import type { ServiceItem, ServiceItemUnit } from '@/features/services/queries';

const UNITS: ServiceItemUnit[] = ['flat', 'per-record', 'per-touch', 'per-day', 'range'];

const UNIT_LABEL: Record<ServiceItemUnit, string> = {
  flat: 'Flat',
  'per-record': 'Per record',
  'per-touch': 'Per touch',
  'per-day': 'Per day',
  range: 'Range',
};

const inputClass =
  'min-w-0 rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm text-stone-800 outline-none transition focus:border-accent focus:ring-3 focus:ring-accent/20';

const buttonClass =
  'rounded-lg border border-stone-200 bg-white px-3 py-2 text-xs font-semibold text-stone-700 transition hover:border-navy hover:text-navy disabled:cursor-not-allowed disabled:opacity-50';

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
  const formRef = useRef<HTMLFormElement>(null);
  const [unit, setUnit] = useState<ServiceItemUnit>('flat');
  const [pending, startTransition] = useTransition();

  const rows = useMemo(() => items, [items]);

  function handleAdd(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      const result = toLegacyResult(await createServiceItem(fd));
      if ('ok' in result) {
        toast.success('Service item added');
        formRef.current?.reset();
        setUnit('flat');
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <section className="rounded-2xl border border-stone-200 bg-white p-5 shadow-[0_1px_4px_rgba(15,30,60,0.08)]">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-2xl text-navy">Services</h2>
          <p className="mt-1 text-sm text-stone-600">
            Catalog the quote composer reads. Codes are immutable; archive instead of renaming.
          </p>
        </div>
        <span className="rounded-full bg-navy-pale px-2.5 py-1 text-xs font-semibold text-navy">
          {rows.length}
        </span>
      </div>

      <Can capability="lookup:edit">
        <form
          ref={formRef}
          onSubmit={handleAdd}
          className="mt-4 grid grid-cols-1 gap-2 rounded-xl border border-stone-100 bg-stone-50 p-4 md:grid-cols-6"
        >
          <input
            name="code"
            placeholder="code (kebab-case)"
            className={`${inputClass} md:col-span-2`}
            maxLength={60}
            required
          />
          <input
            name="label"
            placeholder="Label"
            className={`${inputClass} md:col-span-2`}
            maxLength={120}
            required
          />
          <select
            name="unit"
            value={unit}
            onChange={(e) => setUnit(e.target.value as ServiceItemUnit)}
            className={inputClass}
          >
            {UNITS.map((u) => (
              <option key={u} value={u}>
                {UNIT_LABEL[u]}
              </option>
            ))}
          </select>
          <input
            name="sortOrder"
            type="number"
            min={0}
            placeholder="Sort"
            defaultValue={rows.length}
            className={inputClass}
          />
          {unit === 'range' ? (
            <>
              <input
                name="unitPriceMin"
                type="number"
                step="0.01"
                min={0}
                placeholder="Min $"
                className={inputClass}
              />
              <input
                name="unitPriceMax"
                type="number"
                step="0.01"
                min={0}
                placeholder="Max $"
                className={inputClass}
              />
            </>
          ) : (
            <input
              name="unitPrice"
              type="number"
              step="0.01"
              min={0}
              placeholder="Unit $ (blank = variable)"
              className={`${inputClass} md:col-span-2`}
            />
          )}
          <input
            name="description"
            placeholder="Description (optional)"
            className={`${inputClass} md:col-span-3`}
            maxLength={500}
          />
          <button
            type="submit"
            disabled={pending}
            className="rounded-lg bg-navy px-3 py-2 text-xs font-semibold text-white transition hover:bg-navy-light disabled:cursor-not-allowed disabled:opacity-60"
          >
            Add
          </button>
        </form>
      </Can>

      <div className="mt-4 flex flex-col divide-y divide-stone-100">
        {rows.length === 0 ? (
          <div className="rounded-lg bg-stone-50 px-3 py-6 text-center text-sm text-stone-500">
            No service items yet.
          </div>
        ) : (
          rows.map((item) => <ServiceRow key={item.id} item={item} onChanged={() => router.refresh()} />)
        )}
      </div>
    </section>
  );
}

function ServiceRow({ item, onChanged }: { item: ServiceItem; onChanged: () => void }) {
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();

  if (!editing) {
    return (
      <div className="flex min-h-14 items-center gap-3 py-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-2">
            <span className="font-mono text-xs text-stone-500">{item.code}</span>
            <span className="text-sm font-medium text-stone-800">{item.label}</span>
            <span className="rounded-full bg-stone-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-stone-600">
              {UNIT_LABEL[item.unit]}
            </span>
            <span className="text-sm tabular-nums text-stone-700">{formatPrice(item)}</span>
          </div>
          {item.description ? (
            <p className="mt-0.5 text-xs text-stone-500">{item.description}</p>
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
              if (!confirm(`Archive ${item.label}? Active quotes already referencing this catalog row are unaffected.`)) return;
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
            className="rounded-lg border border-stone-200 bg-white px-3 py-2 text-xs font-bold text-status-red transition hover:border-status-red hover:bg-status-red/10 disabled:cursor-not-allowed disabled:opacity-50"
          >
            x
          </button>
        </Can>
      </div>
    );
  }

  return (
    <ServiceEditForm
      item={item}
      pending={pending}
      onCancel={() => setEditing(false)}
      onSubmit={(fd) =>
        startTransition(async () => {
          const result = toLegacyResult(await updateServiceItem(fd));
          if ('ok' in result) {
            toast.success('Service item updated');
            setEditing(false);
            onChanged();
          } else {
            toast.error(result.error);
          }
        })
      }
    />
  );
}

function ServiceEditForm({
  item,
  pending,
  onCancel,
  onSubmit,
}: {
  item: ServiceItem;
  pending: boolean;
  onCancel: () => void;
  onSubmit: (fd: FormData) => void;
}) {
  const [unit, setUnit] = useState<ServiceItemUnit>(item.unit);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        fd.set('id', String(item.id));
        onSubmit(fd);
      }}
      className="grid grid-cols-1 gap-2 py-3 md:grid-cols-6"
    >
      <div className={`${inputClass} flex items-center bg-stone-50 font-mono text-xs text-stone-600 md:col-span-2`}>
        {item.code}
      </div>
      <input
        name="label"
        defaultValue={item.label}
        className={`${inputClass} md:col-span-2`}
        maxLength={120}
        required
      />
      <select
        name="unit"
        value={unit}
        onChange={(e) => setUnit(e.target.value as ServiceItemUnit)}
        className={inputClass}
      >
        {UNITS.map((u) => (
          <option key={u} value={u}>
            {UNIT_LABEL[u]}
          </option>
        ))}
      </select>
      <input
        name="sortOrder"
        type="number"
        min={0}
        defaultValue={item.sortOrder}
        className={inputClass}
      />
      {unit === 'range' ? (
        <>
          <input
            name="unitPriceMin"
            type="number"
            step="0.01"
            min={0}
            defaultValue={item.unitPriceMin ?? ''}
            placeholder="Min $"
            className={inputClass}
          />
          <input
            name="unitPriceMax"
            type="number"
            step="0.01"
            min={0}
            defaultValue={item.unitPriceMax ?? ''}
            placeholder="Max $"
            className={inputClass}
          />
        </>
      ) : (
        <input
          name="unitPrice"
          type="number"
          step="0.01"
          min={0}
          defaultValue={item.unitPrice ?? ''}
          placeholder="Unit $ (blank = variable)"
          className={`${inputClass} md:col-span-2`}
        />
      )}
      <input
        name="description"
        defaultValue={item.description ?? ''}
        placeholder="Description (optional)"
        className={`${inputClass} md:col-span-4`}
        maxLength={500}
      />
      <button type="submit" disabled={pending} className={buttonClass}>
        Save
      </button>
      <button type="button" onClick={onCancel} className={buttonClass}>
        Cancel
      </button>
    </form>
  );
}
