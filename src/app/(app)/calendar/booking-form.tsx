'use client';

import { useActionState, useEffect, useMemo, useState } from 'react';
import {
  Dialog,
  DialogDescription,
  DialogTitle,
} from '@/components/catalyst/dialog';
import {
  Field as CatalystField,
  FieldGroup,
  Label,
} from '@/components/catalyst/fieldset';
import { Button } from '@/components/catalyst/button';
import { Input } from '@/components/catalyst/input';
import { Textarea } from '@/components/catalyst/textarea';
import { toast } from '@/components/ui/toaster';
import { toLegacyResult } from '@/lib/actions/legacy-result';
import { createCampaign, updateCampaign } from '@/features/schedule/actions';
import { LookupAdmin } from '@/features/schedule/lookup-admin';
import { DealerForm } from '@/features/dealers/dealer-form';
import { CoachAddForm } from '@/features/people/coach-add-form';
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
// 0093: create returns the new campaign so the dialog can hand off into
// "Create quote now?" (prefill the composer with this event + its dealer).
type State = { ok: true; campaignId?: number; dealerId?: number } | { error: string } | null;

/** Passed to `onSuccess` on a create — present only in create-mode. */
export type BookedEvent = { campaignId: number; dealerId: number };

type BookingFormProps = {
  mode: Mode;
  campaign?: Campaign;
  dealers: Dealer[];
  coaches: Coach[];
  styles: LookupOption[];
  sources: LookupOption[];
  defaultStartDate?: string;
  /** Called on save. On a create, receives the new event so the caller can
   *  open the "Create quote now?" hand-off; on edit/cancel it's called with no
   *  argument (caller just closes). */
  onSuccess: (booked?: BookedEvent) => void;
};

// Native-select styling mirrors shadcn's <Input> chrome so the form reads as
// a single visual family. Kept inline rather than extracted because there are
// only ~8 selects in this file and a one-off util doesn't earn its keep.
const selectClass =
  'h-8 w-full min-w-0 rounded-lg border border-zinc-300 bg-transparent px-2.5 py-1 text-sm outline-none focus-visible:border-zinc-400 focus-visible:ring-3 focus-visible:ring-zinc-400/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-zinc-50 disabled:opacity-50 md:text-sm';

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
    async (_prev, fd) =>
      toLegacyResult<{ ok: true; campaignId?: number; dealerId?: number }>(await action(fd)),
    null,
  );

  const initialStart = campaign?.startDate ?? defaultStartDate ?? '';
  const initialEnd = campaign?.endDate ?? defaultStartDate ?? '';
  const initialDuration = initialStart && initialEnd ? dayDiffInclusive(initialStart, initialEnd) : 1;

  const [startDate, setStartDate] = useState(initialStart);
  const [duration, setDuration] = useState(Math.min(Math.max(initialDuration, 1), 5));
  const [stylesOpen, setStylesOpen] = useState(false);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [dealerAddOpen, setDealerAddOpen] = useState(false);
  const [coachAddOpen, setCoachAddOpen] = useState(false);
  // Coaches created inline are appended locally so the new option appears (and
  // can be auto-selected) immediately, before `router.refresh()` repopulates the
  // `coaches` prop. Deduped against the prop list once the refresh lands.
  const [extraCoaches, setExtraCoaches] = useState<Coach[]>([]);
  const [extraDealers, setExtraDealers] = useState<{ id: number; name: string }[]>([]);
  const endDate = useMemo(
    () => (startDate ? addDays(startDate, duration - 1) : ''),
    [startDate, duration],
  );

  const dealersById = useMemo(() => new Map(dealers.map((d) => [d.id, d])), [dealers]);
  const allCoaches = useMemo(() => {
    const seen = new Set<number>();
    const out: Coach[] = [];
    for (const c of [...coaches, ...extraCoaches]) {
      if (!seen.has(c.id)) {
        seen.add(c.id);
        out.push(c);
      }
    }
    return out;
  }, [coaches, extraCoaches]);
  // Dealer picker options as {id, name} so inline-created dealers can be added
  // (and auto-selected) before router.refresh repopulates the `dealers` prop.
  const dealerOptions = useMemo(() => {
    const seen = new Set<number>();
    const out: { id: number; name: string }[] = [];
    for (const d of [
      ...dealers.map((x) => ({ id: x.id, name: x.name })),
      ...extraDealers,
    ]) {
      if (!seen.has(d.id)) {
        seen.add(d.id);
        out.push(d);
      }
    }
    return out;
  }, [dealers, extraDealers]);

  const [dealerId, setDealerId] = useState<string>(campaign?.dealerId ? String(campaign.dealerId) : '');
  const [coachId, setCoachId] = useState<string>(campaign?.coachId ? String(campaign.coachId) : '');
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
    // Phone: prefer the contact's own number, fall back to the dealership
    // rooftop line (`dealers.phone`, 0086) — many imported contacts carry only
    // an email, so without the fallback the Phone field stays blank.
    const phoneVal = dealer.primaryPhone ?? dealer.phone ?? null;
    if (!touched.contact && fullName) setContact(fullName);
    if (!touched.phone && phoneVal) setPhone(phoneVal);
    if (!touched.email && dealer.primaryEmail) setEmail(dealer.primaryEmail);
  }

  function onDealerCreated(created: { id: number; name: string }) {
    setExtraDealers((prev) =>
      prev.some((d) => d.id === created.id) ? prev : [...prev, created],
    );
    setDealerId(String(created.id));
    setDealerAddOpen(false);
  }

  function onCoachCreated(coach: { id: number; firstName: string; lastName: string }) {
    setExtraCoaches((prev) =>
      prev.some((c) => c.id === coach.id)
        ? prev
        : [
            ...prev,
            {
              id: coach.id,
              // optimistic insert — the auth-user link isn't known here; a
              // refetch fills it. Not used as a pipeline-owner from this picker.
              userId: null,
              firstName: coach.firstName,
              lastName: coach.lastName,
              displayName: `${coach.firstName} ${coach.lastName}`.trim(),
              specialty: null,
              primaryEmail: null,
              primaryPhone: null,
            },
          ],
    );
    setCoachId(String(coach.id));
    setCoachAddOpen(false);
  }

  useEffect(() => {
    if (!state) return;
    if ('ok' in state) {
      toast.success(mode === 'create' ? 'Campaign added' : 'Campaign saved');
      // Create → hand the new event back so the caller can prompt "Create quote
      // now?"; edit → plain close (no argument).
      if (mode === 'create' && state.campaignId != null && state.dealerId != null) {
        onSuccess({ campaignId: state.campaignId, dealerId: state.dealerId });
      } else {
        onSuccess();
      }
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
            className="bg-zinc-100 text-zinc-500"
          />
        </Field>
      </div>

      <Field
        label="Dealership"
        htmlFor="bk-dealer"
        required
        action={
          <button
            type="button"
            aria-label="Add dealership"
            onClick={() => setDealerAddOpen(true)}
            className="text-xs font-semibold normal-case text-brand-700 transition hover:text-brand-700"
          >
            + Add
          </button>
        }
      >
        <select
          id="bk-dealer"
          name="dealerId"
          required
          value={dealerId}
          onChange={(e) => onDealerChange(e.target.value)}
          className={selectClass}
        >
          <option value="">Select a dealership…</option>
          {dealerOptions.map((d) => (
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
              className="text-xs font-semibold normal-case text-brand-700 transition hover:text-brand-700"
            >
              Manage
            </button>
          }
        >
          <select
            id="bk-style"
            name="styleId"
            // New event: default to the first (lowest sortOrder) format so a
            // coach doesn't have to pick every time; admins control which is the
            // default via the "Manage" ordering. Edit keeps the campaign's value.
            defaultValue={campaign?.styleId ?? styles[0]?.id ?? ''}
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
              className="text-xs font-semibold normal-case text-brand-700 transition hover:text-brand-700"
            >
              Manage
            </button>
          }
        >
          <select
            id="bk-source"
            name="audienceSourceId"
            // Same as Event Format: new event defaults to the first (lowest
            // sortOrder) data source; admins control the default via "Manage".
            defaultValue={campaign?.audienceSourceId ?? sources[0]?.id ?? ''}
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

      <Field
        label="Sales Coach"
        htmlFor="bk-coach"
        action={
          <button
            type="button"
            aria-label="Add sales coach"
            onClick={() => setCoachAddOpen(true)}
            className="text-xs font-semibold normal-case text-brand-700 transition hover:text-brand-700"
          >
            + Add
          </button>
        }
      >
        <select
          id="bk-coach"
          name="coachId"
          value={coachId}
          onChange={(e) => setCoachId(e.target.value)}
          className={selectClass}
        >
          <option value="">—</option>
          {allCoaches.map((c) => (
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
        <Button outline type="button" onClick={() => onSuccess()}>
          Cancel
        </Button>
        <Button type="submit" color="brand" disabled={pending}>
          {pending ? 'Saving…' : mode === 'create' ? 'Book Event' : 'Save'}
        </Button>
      </div>
    </form>
      <Dialog open={stylesOpen} onClose={setStylesOpen}>
        <DialogTitle>Manage Event Styles</DialogTitle>
        <DialogDescription>
          Add, rename, or archive event formats used by bookings.
        </DialogDescription>
        {stylesOpen && <LookupAdmin kind="styles" items={styles} compact />}
      </Dialog>
      <Dialog open={sourcesOpen} onClose={setSourcesOpen}>
        <DialogTitle>Manage Data Sources</DialogTitle>
        <DialogDescription>
          Add, rename, or archive campaign data-source labels.
        </DialogDescription>
        {sourcesOpen && <LookupAdmin kind="sources" items={sources} compact />}
      </Dialog>
      <Dialog open={dealerAddOpen} onClose={setDealerAddOpen}>
        <DialogTitle>Add Dealership</DialogTitle>
        <DialogDescription>
          Create a new prospect dealership without leaving this booking.
        </DialogDescription>
        {dealerAddOpen && (
          <DealerForm
            mode="create"
            defaultStatus="prospect"
            onSuccess={(created) =>
              created ? onDealerCreated(created) : setDealerAddOpen(false)
            }
            onCancel={() => setDealerAddOpen(false)}
          />
        )}
      </Dialog>
      <Dialog open={coachAddOpen} onClose={setCoachAddOpen}>
        <DialogTitle>Add Sales Coach</DialogTitle>
        <DialogDescription>
          Create a new coach without leaving this booking.
        </DialogDescription>
        {coachAddOpen && (
          <CoachAddForm onCreated={onCoachCreated} onCancel={() => setCoachAddOpen(false)} />
        )}
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
          {required && <span className="ml-1 text-red-700">*</span>}
        </Label>
        {action}
      </div>
      {children}
    </CatalystField>
  );
}
