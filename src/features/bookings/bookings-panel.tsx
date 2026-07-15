'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Badge } from '@/components/catalyst/badge';
import { Button } from '@/components/catalyst/button';
import { Input } from '@/components/catalyst/input';
import { Select } from '@/components/catalyst/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/catalyst/table';
import { Section } from '@/components/app/section';
import { toast } from '@/components/ui/toaster';
import { toLegacyResult } from '@/lib/actions/legacy-result';
import { saveCampaignBookingSettings, type SaveBookingSettingsResult } from './actions';
import { formatSlotDate, formatSlotTime, SLOT_LENGTH_MINUTES } from './slots';

// Client half of the staff booking surface (0108 Phase 4). Read-first: the
// grid and appointment list are server-serialized; the one mutation is the
// settings save (enable/edit + token mint), same action-call shape as SmsPanel.

export type BookingsPanelProps = {
  campaignId: number;
  settings: { dayStartMinute: number; dayEndMinute: number; slotCapacity: number } | null;
  tokensMinted: number;
  totalRecipients: number;
  slots: Array<{
    date: string;
    startMinute: number;
    capacity: number;
    booked: number;
    isFull: boolean;
  }>;
  appointments: Array<{
    id: number;
    slotDate: string;
    slotStartMinute: number;
    firstName: string | null;
    lastName: string | null;
    phone: string;
    status: 'booked' | 'cancelled';
    createdAtIso: string;
  }>;
  recipientLinks: Array<{
    recipientId: number;
    firstName: string | null;
    lastName: string | null;
    phone: string;
    bookingPath: string;
  }>;
};

const HALF_HOURS = Array.from({ length: 1440 / SLOT_LENGTH_MINUTES + 1 }, (_, i) => i * 30);

export function BookingsPanel({
  campaignId,
  settings,
  tokensMinted,
  totalRecipients,
  slots,
  appointments,
  recipientLinks,
}: BookingsPanelProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [dayStart, setDayStart] = useState(settings?.dayStartMinute ?? 540);
  const [dayEnd, setDayEnd] = useState(settings?.dayEndMinute ?? 1020);
  const [capacity, setCapacity] = useState(settings ? String(settings.slotCapacity) : '');

  function onSave() {
    startTransition(async () => {
      const fd = new FormData();
      fd.set('campaignId', String(campaignId));
      fd.set('slotCapacity', capacity);
      fd.set('dayStartMinute', String(dayStart));
      fd.set('dayEndMinute', String(dayEnd));
      const result = toLegacyResult<Extract<SaveBookingSettingsResult, { ok: true }>>(
        await saveCampaignBookingSettings(fd),
      );
      if ('ok' in result) {
        const mintNote = result.tokensMinted
          ? ` — ${result.tokensMinted} booking link(s) created`
          : '';
        toast.success(`Booking settings saved${mintNote}`);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  const liveCount = appointments.filter((a) => a.status === 'booked').length;
  const days = new Map<string, BookingsPanelProps['slots']>();
  for (const slot of slots) {
    const list = days.get(slot.date) ?? [];
    list.push(slot);
    days.set(slot.date, list);
  }

  async function copyLink(path: string) {
    await navigator.clipboard.writeText(`${window.location.origin}${path}`);
    toast.success('Booking link copied');
  }

  return (
    <div className="flex flex-col gap-6">
      <Section title="Booking settings" variant="card">
        <p className="text-sm text-zinc-600">
          {settings
            ? 'Half-hour appointment slots across the event days. Capacity is how many customers the event can host at once (coach + the dealer’s sales staff).'
            : 'Booking is not enabled for this event yet. Set the daily window and per-slot capacity to enable it — saving also creates each recipient’s personal booking link.'}
        </p>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <label className="block text-sm">
            <span className="mb-1 block text-zinc-600">Day starts</span>
            <Select
              value={String(dayStart)}
              onChange={(e) => setDayStart(Number(e.target.value))}
              disabled={pending}
            >
              {HALF_HOURS.slice(0, -1).map((m) => (
                <option key={m} value={m}>
                  {formatSlotTime(m)}
                </option>
              ))}
            </Select>
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-zinc-600">Day ends</span>
            <Select
              value={String(dayEnd)}
              onChange={(e) => setDayEnd(Number(e.target.value))}
              disabled={pending}
            >
              {HALF_HOURS.slice(1).map((m) => (
                <option key={m} value={m}>
                  {m === 1440 ? '12:00 AM (midnight)' : formatSlotTime(m)}
                </option>
              ))}
            </Select>
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-zinc-600">Capacity per slot</span>
            <Input
              type="number"
              min={1}
              max={50}
              value={capacity}
              onChange={(e) => setCapacity(e.target.value)}
              placeholder="e.g. 3"
              disabled={pending}
              className="w-28"
            />
          </label>
          <Button color="brand" compact type="button" onClick={onSave} disabled={pending || !capacity}>
            {settings ? 'Save settings' : 'Enable booking'}
          </Button>
        </div>
        {settings ? (
          <p className="mt-3 text-xs text-zinc-500">
            {tokensMinted} of {totalRecipients} imported recipient(s) hold a booking link.
            Saving mints links for any new recipients; existing links never change.
          </p>
        ) : null}
      </Section>

      {settings ? (
        <Section
          title={
            <span className="flex items-center gap-2">
              Slot grid
              <Badge color="zinc">{liveCount} booked</Badge>
            </span>
          }
          variant="card"
        >
          {slots.length === 0 ? (
            <p className="text-sm text-zinc-600">
              The window leaves no bookable slots — widen it above.
            </p>
          ) : (
            [...days.entries()].map(([date, daySlots]) => (
              <div key={date} className="mt-3 first:mt-0">
                <h4 className="text-sm font-medium text-zinc-900">{formatSlotDate(date)}</h4>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {daySlots.map((slot) => (
                    <span
                      key={`${slot.date}#${slot.startMinute}`}
                      className={
                        slot.isFull
                          ? 'rounded-md bg-amber-100 px-2 py-1 text-xs font-medium text-amber-900'
                          : slot.booked > 0
                            ? 'rounded-md bg-brand-100 px-2 py-1 text-xs text-brand-900'
                            : 'rounded-md bg-zinc-100 px-2 py-1 text-xs text-zinc-600'
                      }
                      title={slot.isFull ? 'Slot full' : undefined}
                    >
                      {formatSlotTime(slot.startMinute)} · {slot.booked}/{slot.capacity}
                    </span>
                  ))}
                </div>
              </div>
            ))
          )}
        </Section>
      ) : null}

      {settings ? (
        <Section title="Appointments" variant="card">
          {appointments.length === 0 ? (
            <p className="text-sm text-zinc-600">
              No appointments yet — they appear here the moment a customer books.
            </p>
          ) : (
            <Table dense>
              <TableHead>
                <TableRow>
                  <TableHeader>When</TableHeader>
                  <TableHeader>Customer</TableHeader>
                  <TableHeader>Phone</TableHeader>
                  <TableHeader>Status</TableHeader>
                  <TableHeader>Booked at</TableHeader>
                </TableRow>
              </TableHead>
              <TableBody>
                {appointments.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell>
                      {formatSlotDate(a.slotDate)} · {formatSlotTime(a.slotStartMinute)}
                    </TableCell>
                    <TableCell>
                      {[a.firstName, a.lastName].filter(Boolean).join(' ') || '—'}
                    </TableCell>
                    <TableCell className="tabular-nums">{a.phone}</TableCell>
                    <TableCell>
                      <Badge color={a.status === 'booked' ? 'green' : 'zinc'}>{a.status}</Badge>
                    </TableCell>
                    <TableCell className="text-zinc-500">
                      {new Date(a.createdAtIso).toLocaleString('en-CA', {
                        month: 'short',
                        day: 'numeric',
                        hour: 'numeric',
                        minute: '2-digit',
                      })}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Section>
      ) : null}

      {settings && recipientLinks.length > 0 ? (
        <Section title="Booking links" variant="card">
          <p className="text-sm text-zinc-600">
            Each recipient&apos;s personal link — share it manually for now (the SMS{' '}
            <code className="text-xs">{'{{booking_link}}'}</code> send token is the next
            chunk). A link books one appointment for that person only.
          </p>
          <div className="mt-2 max-h-72 overflow-y-auto">
            <Table dense>
              <TableHead>
                <TableRow>
                  <TableHeader>Recipient</TableHeader>
                  <TableHeader>Phone</TableHeader>
                  <TableHeader className="w-24">Link</TableHeader>
                </TableRow>
              </TableHead>
              <TableBody>
                {recipientLinks.map((r) => (
                  <TableRow key={r.recipientId}>
                    <TableCell>
                      {[r.firstName, r.lastName].filter(Boolean).join(' ') || '—'}
                    </TableCell>
                    <TableCell className="tabular-nums">{r.phone}</TableCell>
                    <TableCell>
                      <Button plain compact type="button" onClick={() => copyLink(r.bookingPath)}>
                        Copy
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </Section>
      ) : null}
    </div>
  );
}
