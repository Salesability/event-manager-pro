import Link from 'next/link';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

type IconTone = 'green' | 'blue' | 'amber' | 'stone';

type RowIdentityCellProps = {
  /** Leading rounded-square icon. Pass a lucide icon (`<MailIcon />`),
   *  an emoji span, or any other 14–16px element. Pass nothing for a
   *  label-only cell (the leading slot collapses). */
  icon?: ReactNode;
  /** Background tone for the icon's rounded-square chip. Defaults to
   *  `stone` (zinc-100 chip). Pick `green` / `blue` / `amber` for
   *  semantic emphasis tied to the row's domain (e.g. quote = blue). */
  iconTone?: IconTone;
  /** Primary identifier text. Rendered with a dotted underline that
   *  resolves to a solid-zinc hover — communicates "click to open"
   *  without the heaviness of a blue link. */
  label: string;
  /** Edit-default destination — the single editable detail page for
   *  the record (no separate View surface; field-level disabled
   *  handles read-only viewers). */
  href: string;
  /** Optional muted second line for context (e.g. dealer city, role,
   *  archived state). Sits below the dotted label in zinc-500. */
  sublabel?: ReactNode;
};

const iconToneClass: Record<IconTone, string> = {
  green: 'bg-emerald-100 text-emerald-700',
  blue: 'bg-brand-100 text-brand-700',
  amber: 'bg-amber-100 text-amber-700',
  stone: 'bg-zinc-100 text-zinc-600',
};

/**
 * Identity cell for `<DataTable>` rows (0050). Renders the row's primary
 * identifier as a dotted-underline `<Link>` to its edit-default detail
 * page, with an optional tinted-square leading icon and optional muted
 * sublabel. Pairs with `<RowOverflowMenu>` at the row end.
 *
 * The dotted underline (vs. a solid blue link) is the visual cue that
 * differentiates this from generic body links — every row's identity
 * cell carries it, and only identity cells carry it, so a reader can
 * scan a grid and locate the click-through affordance at a glance.
 */
export function RowIdentityCell({
  icon,
  iconTone = 'stone',
  label,
  href,
  sublabel,
}: RowIdentityCellProps) {
  return (
    <div className="flex items-center gap-3">
      {icon != null && (
        <span
          aria-hidden
          className={cn(
            'inline-flex size-7 shrink-0 items-center justify-center rounded-md',
            iconToneClass[iconTone],
          )}
        >
          {icon}
        </span>
      )}
      <span className="flex min-w-0 flex-col">
        <Link
          href={href}
          className="truncate text-sm font-semibold text-zinc-900 underline decoration-dotted decoration-zinc-400 underline-offset-4 transition-colors hover:decoration-zinc-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500"
        >
          {label}
        </Link>
        {sublabel != null && (
          <span className="truncate text-xs text-zinc-500">{sublabel}</span>
        )}
      </span>
    </div>
  );
}
