'use client';

import { useActionState, useEffect, useMemo, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Field as CatalystField,
  FieldGroup,
  Label,
} from '@/components/catalyst/fieldset';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/components/ui/toaster';
import { toLegacyResult } from '@/lib/actions/legacy-result';
import { createCampaign, updateCampaign } from '@/features/schedule/actions';
import { LookupAdmin } from '@/features/schedule/lookup-admin';
import type { Campaign, Coach, Dealer, LookupOption } from '@/features/schedule/queries';

// 0042 Phase 4 — partial port. Swapped raw primitives for shadcn (Input,
// Textarea, Field, FieldLabel) but kept `useActionState` + the native
// `<form action={formAction}>` shape because the auto-fill UX (dealer-pick
// → populate contact/phone/email unless the user has already touched them)
// uses raw `useState` rather than RHF's form state, and a full RHF migration
// would mean restructuring that auto-fill into `watch(dealerId)` +
// `setValue` calls + an external touched-fields tracker. Tradeoff captured
// in the plan body; the dealer-form sibling does the full RHF port for
// reference.
//
// Native `<select>` kept (not swapped for shadcn `<Select>` — Base UI's Select
// is a dropdown composition that adds layout complexity for these
// straightforward option lists; the Phase 5 primitive sweep can revisit if
// the UX clearly wins from the swap).

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

// Native-select styling mirrors shadcn's <Input> chrome so the form reads as
// a single visual family. Kept inline rather than extracted because there are
// only ~8 selects in this file and a one-off util doesn't earn its keep.
const selectClass =
  'h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 md:text-sm';

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

      <FieldGroup>

      <div className="grid grid-cols-3 gap-3">
        <Field label="Start Date" htmlFor="bk-start" required>
          <Input
            id="bk-start"
            name="startDate"
            type="date"
            required
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            autoFocus
          />
        </Field>
        <Field label="Duration" htmlFor="bk-duration">
          <select
            id="bk-duration"
            value={duration}
            onChange={(e) => setDuration(Number(e.target.value))}
            className={selectClass}
          >
            {[1, 2, 3, 4, 5].map((n) => (
              <option key={n} value={n}>
                {n} day{n === 1 ? '' : 's'}
              </option>
            ))}
          </select>
        </Field>
        <Field label="End Date" htmlFor="bk-end">
          <Input
            id="bk-end"
            type="date"
            value={endDate}
            readOnly
            tabIndex={-1}
            className="bg-muted text-muted-foreground"
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
          className={selectClass}
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
          <Input
            id="bk-contact"
            name="contact"
            type="text"
            value={contact}
            onChange={(e) => {
              setContact(e.target.value);
              setTouched((t) => ({ ...t, contact: true }));
            }}
          />
        </Field>
        <Field label="Phone" htmlFor="bk-phone">
          <Input
            id="bk-phone"
            name="phone"
            type="tel"
            value={phone}
            onChange={(e) => {
              setPhone(e.target.value);
              setTouched((t) => ({ ...t, phone: true }));
            }}
          />
        </Field>
        <Field label="Email" htmlFor="bk-email">
          <Input
            id="bk-email"
            name="email"
            type="email"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              setTouched((t) => ({ ...t, email: true }));
            }}
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
              className="text-xs font-semibold normal-case text-accent transition hover:text-primary"
            >
              Manage
            </button>
          }
        >
          <select
            id="bk-style"
            name="styleId"
            defaultValue={campaign?.styleId ?? ''}
            className={selectClass}
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
              className="text-xs font-semibold normal-case text-accent transition hover:text-primary"
            >
              Manage
            </button>
          }
        >
          <select
            id="bk-source"
            name="audienceSourceId"
            defaultValue={campaign?.audienceSourceId ?? ''}
            className={selectClass}
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
          <Input
            id="bk-qty"
            name="qtyRecords"
            type="number"
            min={0}
            defaultValue={campaign?.qtyRecords ?? ''}
          />
        </Field>
        <Field label="SMS/Email" htmlFor="bk-sms">
          <Input
            id="bk-sms"
            name="smsEmail"
            type="number"
            min={0}
            defaultValue={campaign?.smsEmail ?? ''}
          />
        </Field>
        <Field label="Letters" htmlFor="bk-letters">
          <Input
            id="bk-letters"
            name="letters"
            type="number"
            min={0}
            defaultValue={campaign?.letters ?? ''}
          />
        </Field>
        <Field label="BDC" htmlFor="bk-bdc">
          <Input
            id="bk-bdc"
            name="bdc"
            type="number"
            min={0}
            defaultValue={campaign?.bdc ?? ''}
          />
        </Field>
      </div>

      <Field label="Sales Coach" htmlFor="bk-coach">
        <select
          id="bk-coach"
          name="coachId"
          defaultValue={campaign?.coachId ?? ''}
          className={selectClass}
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
        <Textarea
          id="bk-notes"
          name="notes"
          rows={3}
          defaultValue={campaign?.notes ?? ''}
          className="resize-y"
        />
      </Field>

      </FieldGroup>

      <div className="mt-2 flex justify-end gap-2">
        <button
          type="button"
          onClick={onSuccess}
          className="rounded-lg border border-border bg-white px-4 py-2 text-sm font-medium text-muted-foreground transition hover:border-input hover:text-primary"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pending ? 'Saving…' : mode === 'create' ? 'Book Event' : 'Save'}
        </button>
      </div>
    </form>
      <Dialog open={stylesOpen} onOpenChange={setStylesOpen}>
        <DialogContent>
          <DialogTitle>Manage Event Styles</DialogTitle>
          <DialogDescription>
            Add, rename, or archive event formats used by bookings.
          </DialogDescription>
          {stylesOpen && <LookupAdmin kind="styles" items={styles} compact />}
        </DialogContent>
      </Dialog>
      <Dialog open={sourcesOpen} onOpenChange={setSourcesOpen}>
        <DialogContent>
          <DialogTitle>Manage Data Sources</DialogTitle>
          <DialogDescription>
            Add, rename, or archive campaign data-source labels.
          </DialogDescription>
          {sourcesOpen && <LookupAdmin kind="sources" items={sources} compact />}
        </DialogContent>
      </Dialog>
    </>
  );
}

// Local Field-shape helper: wraps shadcn's <Field> + <FieldLabel> with an
// optional inline "action" slot (the "Manage" button next to Event Format /
// Data Source). Native `<select>` + `<input>` types both work as children
// since Field is a layout-only primitive.
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
    <CatalystField>
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor={htmlFor}>
          {label}
          {required && <span className="ml-1 text-status-red">*</span>}
        </Label>
        {action}
      </div>
      {children}
    </CatalystField>
  );
}
