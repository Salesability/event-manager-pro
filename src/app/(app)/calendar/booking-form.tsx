'use client';

import { useActionState, useEffect, useMemo, useState } from 'react';
import { Dialog } from '@/components/ui/dialog';
import { toast } from '@/components/ui/toaster';
import { toLegacyResult } from '@/lib/actions/legacy-result';
import { createCampaign, updateCampaign } from '@/features/schedule/actions';
import { LookupAdmin } from '@/features/schedule/lookup-admin';
import type { Campaign, Coach, Dealer, LookupOption } from '@/features/schedule/queries';

type Mode = 'create' | 'edit';
type State = { ok: true } | { error: string } | null;

type BookingFormProps = {
  mode: Mode;
  campaign?: Campaign;
  dealers: Dealer[];
  coaches: Coach[];
  styles: LookupOption[];
  sources: LookupOption[];
  defaultStartDate?: string;
  onSuccess: () => void;
};

const inputClass =
  'rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm text-stone-800 outline-none transition focus:border-accent focus:ring-3 focus:ring-accent/20';

function addDays(iso: string, days: number) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(
    dt.getUTCDate(),
  ).padStart(2, '0')}`;
}

function dayDiffInclusive(start: string, end: string) {
  const [y1, m1, d1] = start.split('-').map(Number);
  const [y2, m2, d2] = end.split('-').map(Number);
  const a = Date.UTC(y1, m1 - 1, d1);
  const b = Date.UTC(y2, m2 - 1, d2);
  return Math.round((b - a) / 86400000) + 1;
}

export function BookingForm({
  mode,
  campaign,
  dealers,
  coaches,
  styles,
  sources,
  defaultStartDate,
  onSuccess,
}: BookingFormProps) {
  const action = mode === 'create' ? createCampaign : updateCampaign;
  const [state, formAction, pending] = useActionState<State, FormData>(
    async (_prev, fd) => toLegacyResult(await action(fd)),
    null,
  );

  const initialStart = campaign?.startDate ?? defaultStartDate ?? '';
  const initialEnd = campaign?.endDate ?? defaultStartDate ?? '';
  const initialDuration = initialStart && initialEnd ? dayDiffInclusive(initialStart, initialEnd) : 1;

  const [startDate, setStartDate] = useState(initialStart);
  const [duration, setDuration] = useState(Math.min(Math.max(initialDuration, 1), 5));
  const [stylesOpen, setStylesOpen] = useState(false);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const endDate = useMemo(
    () => (startDate ? addDays(startDate, duration - 1) : ''),
    [startDate, duration],
  );

  const dealersById = useMemo(() => new Map(dealers.map((d) => [d.id, d])), [dealers]);

  const [dealerId, setDealerId] = useState<string>(campaign?.dealerId ? String(campaign.dealerId) : '');
  const [contact, setContact] = useState(campaign?.contact ?? '');
  const [phone, setPhone] = useState(campaign?.phone ?? '');
  const [email, setEmail] = useState(campaign?.email ?? '');
  const [touched, setTouched] = useState<{ contact: boolean; phone: boolean; email: boolean }>(
    () => ({
      contact: Boolean(campaign?.contact),
      phone: Boolean(campaign?.phone),
      email: Boolean(campaign?.email),
    }),
  );

  function onDealerChange(nextId: string) {
    setDealerId(nextId);
    const dealer = nextId ? dealersById.get(Number(nextId)) : null;
    if (!dealer) return;
    const fullName = [dealer.contactFirstName, dealer.contactLastName].filter(Boolean).join(' ');
    if (!touched.contact && fullName) setContact(fullName);
    if (!touched.phone && dealer.primaryPhone) setPhone(dealer.primaryPhone);
    if (!touched.email && dealer.primaryEmail) setEmail(dealer.primaryEmail);
  }

  useEffect(() => {
    if (!state) return;
    if ('ok' in state) {
      toast.success(mode === 'create' ? 'Campaign added' : 'Campaign saved');
      onSuccess();
    } else {
      toast.error(state.error);
    }
  }, [state, mode, onSuccess]);

  return (
    <>
      <form action={formAction} className="mt-4 flex flex-col gap-4">
      {mode === 'edit' && campaign && <input type="hidden" name="id" value={campaign.id} />}
      <input type="hidden" name="endDate" value={endDate} />

      <div className="grid grid-cols-3 gap-3">
        <Field label="Start Date" htmlFor="bk-start" required>
          <input
            id="bk-start"
            name="startDate"
            type="date"
            required
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            autoFocus
            className={inputClass}
          />
        </Field>
        <Field label="Duration" htmlFor="bk-duration">
          <select
            id="bk-duration"
            value={duration}
            onChange={(e) => setDuration(Number(e.target.value))}
            className={inputClass}
          >
            {[1, 2, 3, 4, 5].map((n) => (
              <option key={n} value={n}>
                {n} day{n === 1 ? '' : 's'}
              </option>
            ))}
          </select>
        </Field>
        <Field label="End Date" htmlFor="bk-end">
          <input
            id="bk-end"
            type="date"
            value={endDate}
            readOnly
            tabIndex={-1}
            className={`${inputClass} bg-stone-100 text-stone-600`}
          />
        </Field>
      </div>

      <Field label="Dealership" htmlFor="bk-dealer" required>
        <select
          id="bk-dealer"
          name="dealerId"
          required
          value={dealerId}
          onChange={(e) => onDealerChange(e.target.value)}
          className={inputClass}
        >
          <option value="">Select a dealership…</option>
          {dealers.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
      </Field>

      <div className="grid grid-cols-3 gap-3">
        <Field label="Contact" htmlFor="bk-contact">
          <input
            id="bk-contact"
            name="contact"
            type="text"
            value={contact}
            onChange={(e) => {
              setContact(e.target.value);
              setTouched((t) => ({ ...t, contact: true }));
            }}
            className={inputClass}
          />
        </Field>
        <Field label="Phone" htmlFor="bk-phone">
          <input
            id="bk-phone"
            name="phone"
            type="tel"
            value={phone}
            onChange={(e) => {
              setPhone(e.target.value);
              setTouched((t) => ({ ...t, phone: true }));
            }}
            className={inputClass}
          />
        </Field>
        <Field label="Email" htmlFor="bk-email">
          <input
            id="bk-email"
            name="email"
            type="email"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              setTouched((t) => ({ ...t, email: true }));
            }}
            className={inputClass}
          />
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field
          label="Event Format"
          htmlFor="bk-style"
          action={
            <button
              type="button"
              onClick={() => setStylesOpen(true)}
              className="text-xs font-semibold normal-case text-accent transition hover:text-navy"
            >
              Manage
            </button>
          }
        >
          <select
            id="bk-style"
            name="styleId"
            defaultValue={campaign?.styleId ?? ''}
            className={inputClass}
          >
            <option value="">—</option>
            {styles.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </Field>
        <Field
          label="Data Source"
          htmlFor="bk-source"
          action={
            <button
              type="button"
              onClick={() => setSourcesOpen(true)}
              className="text-xs font-semibold normal-case text-accent transition hover:text-navy"
            >
              Manage
            </button>
          }
        >
          <select
            id="bk-source"
            name="salesLeadSourceId"
            defaultValue={campaign?.salesLeadSourceId ?? ''}
            className={inputClass}
          >
            <option value="">—</option>
            {sources.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div className="grid grid-cols-4 gap-3">
        <Field label="Qty Records" htmlFor="bk-qty">
          <input
            id="bk-qty"
            name="qtyRecords"
            type="number"
            min={0}
            defaultValue={campaign?.qtyRecords ?? ''}
            className={inputClass}
          />
        </Field>
        <Field label="SMS/Email" htmlFor="bk-sms">
          <input
            id="bk-sms"
            name="smsEmail"
            type="number"
            min={0}
            defaultValue={campaign?.smsEmail ?? ''}
            className={inputClass}
          />
        </Field>
        <Field label="Letters" htmlFor="bk-letters">
          <input
            id="bk-letters"
            name="letters"
            type="number"
            min={0}
            defaultValue={campaign?.letters ?? ''}
            className={inputClass}
          />
        </Field>
        <Field label="BDC" htmlFor="bk-bdc">
          <input
            id="bk-bdc"
            name="bdc"
            type="number"
            min={0}
            defaultValue={campaign?.bdc ?? ''}
            className={inputClass}
          />
        </Field>
      </div>

      <Field label="Sales Coach" htmlFor="bk-coach">
        <select
          id="bk-coach"
          name="coachId"
          defaultValue={campaign?.coachId ?? ''}
          className={inputClass}
        >
          <option value="">—</option>
          {coaches.map((c) => (
            <option key={c.id} value={c.id}>
              {c.firstName} {c.lastName}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Notes" htmlFor="bk-notes">
        <textarea
          id="bk-notes"
          name="notes"
          rows={3}
          defaultValue={campaign?.notes ?? ''}
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
          {pending ? 'Saving…' : mode === 'create' ? 'Book Event' : 'Save'}
        </button>
      </div>
    </form>
      <Dialog.Root open={stylesOpen} onClose={setStylesOpen}>
        <Dialog.Backdrop />
        <Dialog.Panel>
          <Dialog.Title>Manage Event Styles</Dialog.Title>
          <Dialog.Description>
            Add, rename, or archive event formats used by bookings.
          </Dialog.Description>
          {stylesOpen && <LookupAdmin kind="styles" items={styles} compact />}
        </Dialog.Panel>
      </Dialog.Root>
      <Dialog.Root open={sourcesOpen} onClose={setSourcesOpen}>
        <Dialog.Backdrop />
        <Dialog.Panel>
          <Dialog.Title>Manage Data Sources</Dialog.Title>
          <Dialog.Description>
            Add, rename, or archive campaign data-source labels.
          </Dialog.Description>
          {sourcesOpen && <LookupAdmin kind="sources" items={sources} compact />}
        </Dialog.Panel>
      </Dialog.Root>
    </>
  );
}

function Field({
  label,
  htmlFor,
  required,
  action,
  children,
}: {
  label: string;
  htmlFor: string;
  required?: boolean;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <label
          htmlFor={htmlFor}
          className="text-xs font-semibold uppercase tracking-wide text-stone-600"
        >
          {label}
          {required && <span className="ml-1 text-status-red">*</span>}
        </label>
        {action}
      </div>
      {children}
    </div>
  );
}
