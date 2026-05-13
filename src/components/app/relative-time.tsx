type RelativeTimeProps = {
  value: Date | string;
  /** Locale for both the relative and the absolute timestamp tooltip. */
  locale?: string;
};

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
const MONTH = 30 * DAY;
const YEAR = 365 * DAY;

/**
 * Renders a relative timestamp ("3 hours ago") with the absolute timestamp
 * carried in `title` so a hover surfaces the exact value (0043 Phase 7 —
 * relative for *recent activity*, absolute for *scheduled facts*).
 *
 * Uses `Intl.RelativeTimeFormat` — no `date-fns` dependency. Computation is
 * one-shot at render; we don't tick it on a timer because Next.js server
 * components re-render on data load (good enough for list-page freshness).
 */
export function RelativeTime({ value, locale = 'en-CA' }: RelativeTimeProps) {
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) {
    return <span>—</span>;
  }
  const now = new Date();
  const diffMs = date.getTime() - now.getTime();
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  const { value: pieces, unit } = pickUnit(diffMs);
  const label = rtf.format(pieces, unit);
  const absolute = date.toLocaleString(locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
  return (
    <time dateTime={date.toISOString()} title={absolute}>
      {label}
    </time>
  );
}

type Picked = {
  value: number;
  unit: Intl.RelativeTimeFormatUnit;
};

function pickUnit(diffMs: number): Picked {
  const abs = Math.abs(diffMs);
  if (abs < MINUTE) return { value: Math.round(diffMs / 1000), unit: 'second' };
  if (abs < HOUR) return { value: Math.round(diffMs / MINUTE), unit: 'minute' };
  if (abs < DAY) return { value: Math.round(diffMs / HOUR), unit: 'hour' };
  if (abs < WEEK) return { value: Math.round(diffMs / DAY), unit: 'day' };
  if (abs < MONTH) return { value: Math.round(diffMs / WEEK), unit: 'week' };
  if (abs < YEAR) return { value: Math.round(diffMs / MONTH), unit: 'month' };
  return { value: Math.round(diffMs / YEAR), unit: 'year' };
}
