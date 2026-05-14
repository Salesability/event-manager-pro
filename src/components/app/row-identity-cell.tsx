import Link from 'next/link';
import type { ComponentProps, ReactNode } from 'react';
import { Badge } from '@/components/catalyst/badge';

type BadgeColor = NonNullable<ComponentProps<typeof Badge>['color']>;

type SharedRowIdentityCellProps = {
  /** Leading rounded-square icon. Pass a lucide icon (`<MailIcon />`),
   *  an emoji span, or any other 14–16px element. Pass nothing for a
   *  label-only cell (the leading slot collapses). */
  icon?: ReactNode;
  /** Catalyst `<Badge>` color name driving the icon-chip tone. Defaults
   *  to `'zinc'` (Catalyst Badge's own default). Pick `'brand'` for
   *  primary-domain rows (dealers, quotes), `'emerald'` for success-y
   *  rows, `'amber'` for warning-y rows, etc. Aligns with the post-
   *  0049 Badge doctrine — Catalyst owns the bg/text/dark-mode classes,
   *  this primitive just supplies the shape. */
  iconTone?: BadgeColor;
  /** Primary identifier text. Rendered with a dotted underline that
   *  resolves to a solid-zinc hover — communicates "click to open"
   *  without the heaviness of a blue link. */
  label: string;
  /** Optional muted second line for context (e.g. dealer city, role,
   *  archived state). Sits below the dotted label in zinc-500. */
  sublabel?: ReactNode;
};

type RowIdentityCellLinkProps = SharedRowIdentityCellProps & {
  /** Edit-default destination — the single editable detail page for
   *  the record (no separate View surface; field-level disabled
   *  handles read-only viewers). */
  href: string;
  onClick?: never;
};

type RowIdentityCellButtonProps = SharedRowIdentityCellProps & {
  /** Button-shape variant for surfaces whose canonical editor is a
   *  dialog rather than a detail page (e.g. `/admin/people` —
   *  edit-default fires the Edit dialog). Use sparingly; a detail
   *  page is the doctrine, and this variant is the stopgap. */
  onClick: () => void;
  href?: never;
};

type RowIdentityCellProps = RowIdentityCellLinkProps | RowIdentityCellButtonProps;

/**
 * Identity cell for `<DataTable>` rows (0050). Renders the row's primary
 * identifier as a dotted-underline `<Link>` to its edit-default detail
 * page, with an optional tinted-square leading icon (Catalyst `<Badge>`
 * under the hood) and optional muted sublabel. Pairs with
 * `<RowOverflowMenu>` at the row end.
 *
 * The dotted underline (vs. a solid blue link) is the visual cue that
 * differentiates this from generic body links — every row's identity
 * cell carries it, and only identity cells carry it, so a reader can
 * scan a grid and locate the click-through affordance at a glance.
 */
export function RowIdentityCell(props: RowIdentityCellProps) {
  const { icon, iconTone = 'zinc', label, sublabel } = props;
  const labelClass =
    'truncate text-left text-sm font-semibold text-zinc-900 underline decoration-dotted decoration-zinc-400 underline-offset-4 transition-colors hover:decoration-zinc-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500';
  return (
    <div className="flex items-center gap-3">
      {icon != null && (
        // Badge supplies the bg/text + dark-mode classes; `!` overrides
        // its default rectangular padding so the chip reads as a 28×28
        // square centered on the icon glyph.
        <Badge
          color={iconTone}
          aria-hidden
          className="size-7! shrink-0 justify-center px-0! py-0!"
        >
          {icon}
        </Badge>
      )}
      <span className="flex min-w-0 flex-col">
        {props.href != null ? (
          <Link href={props.href} className={labelClass}>
            {label}
          </Link>
        ) : (
          <button type="button" onClick={props.onClick} className={labelClass}>
            {label}
          </button>
        )}
        {sublabel != null && (
          <span className="truncate text-xs text-zinc-500">{sublabel}</span>
        )}
      </span>
    </div>
  );
}
