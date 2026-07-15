// Pure slot-grid derivation (0108). Slots are DERIVED, never materialized:
// the grid is (every campaign day) × (half-hour marks inside the campaign's
// booking window). Dates are the campaign's local `date` strings and minutes
// are wall-clock offsets from midnight — no timezone math here, matching the
// app-wide local-date pattern.

/** Fixed slot length — the owner call is half-hour slots; only the day window
 * and capacity vary per campaign (`campaign_booking_settings`). */
export const SLOT_LENGTH_MINUTES = 30;

// A campaign spanning more days than this is malformed input (real events run
// a few days); the cap bounds the derived grid rather than trusting the range.
const MAX_GRID_DAYS = 62;

export type SlotRef = {
  /** YYYY-MM-DD, local to the event. */
  date: string;
  /** Minutes from midnight, half-hour aligned. */
  startMinute: number;
};

export type BookingWindow = {
  startDate: string;
  endDate: string;
  dayStartMinute: number;
  dayEndMinute: number;
};

/** Every bookable slot for the campaign, in chronological order. Returns []
 * for an inverted range or window (defensive — both are CHECK-guarded). */
export function deriveSlotGrid(window: BookingWindow): SlotRef[] {
  const slots: SlotRef[] = [];
  for (const date of eachDate(window.startDate, window.endDate)) {
    for (
      let minute = window.dayStartMinute;
      minute + SLOT_LENGTH_MINUTES <= window.dayEndMinute;
      minute += SLOT_LENGTH_MINUTES
    ) {
      slots.push({ date, startMinute: minute });
    }
  }
  return slots;
}

/** Membership check the book action gates on — the slot must fall on the
 * derived grid, not merely parse. */
export function isSlotInGrid(window: BookingWindow, slot: SlotRef): boolean {
  return (
    slot.startMinute % SLOT_LENGTH_MINUTES === 0 &&
    slot.startMinute >= window.dayStartMinute &&
    slot.startMinute + SLOT_LENGTH_MINUTES <= window.dayEndMinute &&
    eachDate(window.startDate, window.endDate).includes(slot.date)
  );
}

/** 540 → "9:00 AM", 990 → "4:30 PM". */
export function formatSlotTime(startMinute: number): string {
  const hour24 = Math.floor(startMinute / 60);
  const minute = startMinute % 60;
  const meridiem = hour24 < 12 ? 'AM' : 'PM';
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return `${hour12}:${String(minute).padStart(2, '0')} ${meridiem}`;
}

/** "2026-08-14" → "Friday, August 14" (UTC-anchored so the local `date`
 * string renders as itself regardless of host timezone). */
export function formatSlotDate(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString('en-CA', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

function eachDate(startDate: string, endDate: string): string[] {
  const dates: string[] = [];
  const cursor = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  if (Number.isNaN(cursor.getTime()) || Number.isNaN(end.getTime())) return dates;
  while (cursor <= end && dates.length < MAX_GRID_DAYS) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}
