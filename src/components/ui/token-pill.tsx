import { cn } from '@/lib/utils';

type TokenPillProps = {
  /** Opaque token value (e.g. an API-key prefix, a short hash, a quote id
   *  tail). Rendered in monospace inside a tinted pill. */
  value: string;
  /** Optional max character count before the value is truncated with a
   *  trailing ellipsis. Defaults to **20**, matching Resend's API-key
   *  table treatment of `re_5wj99ctm…`. Pass a smaller value (e.g. 8)
   *  for tighter cells. */
  maxChars?: number;
  /** Optional className extension for layout-specific overrides at the
   *  callsite (e.g. extra margin in a wide column). The pill chrome
   *  itself stays consistent across surfaces. */
  className?: string;
};

/**
 * Monospace token pill (0050). Renders an opaque value inside a tinted
 * rounded-md chip with monospace font and a length-bounded truncation.
 * Resend's API-keys table is the visual reference; this primitive lands
 * for use on any future grid that has a short opaque identifier column.
 *
 * Not a sweep target today — no current grid surfaces a column whose
 * value is purely opaque. Lands so it's ready when one shows up
 * (e.g. an `id` column on a future token / webhook / share-link table).
 */
export function TokenPill({ value, maxChars = 20, className }: TokenPillProps) {
  const truncated =
    value.length > maxChars ? `${value.slice(0, maxChars)}…` : value;
  return (
    <span
      title={value}
      className={cn(
        'inline-flex max-w-full items-center rounded-md bg-zinc-100 px-2 py-0.5 font-mono text-xs text-zinc-700',
        className,
      )}
    >
      <span className="truncate">{truncated}</span>
    </span>
  );
}
