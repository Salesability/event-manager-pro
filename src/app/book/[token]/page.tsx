import type { Metadata } from 'next';
import Image from 'next/image';
import { notFound } from 'next/navigation';
import { bookAppointment } from '@/features/bookings/actions';
import { loadBookingContext, type SlotAvailability } from '@/features/bookings/queries';
import { formatSlotDate, formatSlotTime } from '@/features/bookings/slots';

// Per-recipient tokenized page — never index.
export const metadata: Metadata = {
  title: 'Book your appointment',
  robots: { index: false, follow: false },
};

type Props = {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ error?: string }>;
};

// The book action redirects refusals back here as ?error=<code>; the booked
// and event-passed states render from data, not params.
const ERROR_MESSAGES: Record<string, string> = {
  invalid: "That time isn't available for this event — please pick another slot.",
  full: 'That time just filled up — please pick another slot.',
};

export default async function BookingPage({ params, searchParams }: Props) {
  const [{ token }, { error }] = await Promise.all([params, searchParams]);
  if (!token || token.length > 200) notFound();

  const ctx = await loadBookingContext(token);
  // Unknown token or booking never enabled — a 404, never a login redirect.
  if (!ctx) notFound();

  const greetingName = ctx.firstName?.trim() || 'there';
  const errorMessage = error ? ERROR_MESSAGES[error] : undefined;

  return (
    <div className="min-h-screen bg-white">
      <header className="bg-brand-600 px-6 py-4">
        <div className="mx-auto flex max-w-2xl items-center gap-3 text-white">
          <Image
            src="/saledayevents-logo.jpg"
            alt="SaleDay Events — Automotive Marketing"
            width={246}
            height={155}
            priority
            className="h-10 w-auto rounded"
          />
          <span className="ml-2 text-sm text-white/70">{ctx.dealerName}</span>
        </div>
      </header>

      <main className="mx-auto w-full max-w-2xl px-6 py-8">
        {ctx.existingAppointment ? (
          <BookedCard
            dealerName={ctx.dealerName}
            slotDate={ctx.existingAppointment.slotDate}
            slotStartMinute={ctx.existingAppointment.slotStartMinute}
          />
        ) : ctx.eventEnded ? (
          <section className="rounded-xl border border-zinc-200 bg-zinc-50 p-6">
            <h1 className="text-xl font-semibold text-zinc-900">This event has passed</h1>
            <p className="mt-2 text-sm text-zinc-600">
              The event at {ctx.dealerName} has ended, so appointments can no longer be
              booked through this link. Please contact the dealership directly.
            </p>
          </section>
        ) : (
          <>
            <h1 className="text-2xl font-semibold text-zinc-900">
              Hi {greetingName} — pick your time at {ctx.dealerName}
            </h1>
            <p className="mt-2 text-sm text-zinc-600">
              {formatSlotDate(ctx.startDate)}
              {ctx.endDate !== ctx.startDate ? ` – ${formatSlotDate(ctx.endDate)}` : ''} ·
              Choose a time below and confirm — it takes ten seconds.
            </p>

            {errorMessage ? (
              <p
                role="alert"
                className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
              >
                {errorMessage}
              </p>
            ) : null}

            <SlotPicker token={token} slots={ctx.slots} />
          </>
        )}
      </main>
    </div>
  );
}

function BookedCard(props: { dealerName: string; slotDate: string; slotStartMinute: number }) {
  return (
    <section className="rounded-xl border border-green-200 bg-green-50 p-6">
      <h1 className="text-xl font-semibold text-green-900">You&apos;re booked ✓</h1>
      <p className="mt-2 text-sm text-green-900">
        Your appointment at {props.dealerName} is set for{' '}
        <strong>
          {formatSlotDate(props.slotDate)} at {formatSlotTime(props.slotStartMinute)}
        </strong>
        .
      </p>
      <p className="mt-2 text-sm text-green-800">
        Need to change it? Contact the dealership and they&apos;ll take care of you.
      </p>
    </section>
  );
}

function SlotPicker(props: { token: string; slots: SlotAvailability[] }) {
  const days = new Map<string, SlotAvailability[]>();
  for (const slot of props.slots) {
    const list = days.get(slot.date) ?? [];
    list.push(slot);
    days.set(slot.date, list);
  }
  const anyOpen = props.slots.some((s) => !s.isFull);

  if (!anyOpen) {
    return (
      <section className="mt-6 rounded-xl border border-zinc-200 bg-zinc-50 p-6">
        <p className="text-sm text-zinc-700">
          All appointment times are taken. Please contact the dealership directly and
          they&apos;ll fit you in.
        </p>
      </section>
    );
  }

  return (
    <form action={bookAppointment} className="mt-6">
      <input type="hidden" name="token" value={props.token} />
      {[...days.entries()].map(([date, slots]) => (
        <fieldset key={date} className="mt-5 first:mt-0">
          <legend className="text-sm font-medium text-zinc-900">{formatSlotDate(date)}</legend>
          <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-4">
            {slots.map((slot) => (
              <label key={`${slot.date}#${slot.startMinute}`} className="relative block">
                {/* Invisible overlay (not sr-only) so the radio itself takes
                    the tap/click — keeps it reachable for pointer-driven
                    automation and screen readers alike. */}
                <input
                  type="radio"
                  name="slot"
                  value={`${slot.date}#${slot.startMinute}`}
                  required
                  disabled={slot.isFull}
                  className="peer absolute inset-0 cursor-pointer opacity-0 disabled:cursor-not-allowed"
                />
                <span
                  className={
                    slot.isFull
                      ? 'block rounded-lg border border-zinc-200 bg-zinc-100 px-3 py-2 text-center text-sm text-zinc-400 line-through'
                      : 'block cursor-pointer rounded-lg border border-zinc-300 px-3 py-2 text-center text-sm text-zinc-900 hover:border-brand-600 peer-checked:border-brand-600 peer-checked:bg-brand-600 peer-checked:font-medium peer-checked:text-white peer-focus-visible:ring-2 peer-focus-visible:ring-brand-600/50'
                  }
                >
                  {formatSlotTime(slot.startMinute)}
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      ))}
      <button
        type="submit"
        className="mt-6 w-full rounded-lg bg-brand-600 px-4 py-3 text-sm font-semibold text-white hover:bg-brand-700 sm:w-auto sm:px-8"
      >
        Book my appointment
      </button>
      <p className="mt-2 text-xs text-zinc-500">
        One appointment per person — you can&apos;t double-book.
      </p>
    </form>
  );
}
