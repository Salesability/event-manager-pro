import Link from 'next/link';
import type { ComponentProps, ReactNode } from 'react';
import { ROW_ACTION_ICONS } from '@/lib/ui/icons';
import { ROW_ACTION_LABELS, type RowActionKind } from '@/lib/ui/labels';
import { cn } from '@/lib/utils';

type BaseAction = {
  /** Canonical action vocabulary (see `ROW_ACTION_LABELS`). */
  kind: RowActionKind;
  /** Optional override for the visible label (rarely needed — defaults to
   *  `ROW_ACTION_LABELS[kind]`). Override only when the row's verb genuinely
   *  diverges (e.g. `Mark active` vs `Activate` on a prospect row). */
  label?: string;
  /** Optional row identifier folded into `aria-label`. Recommended on every
   *  callsite so screen readers get "Edit Acme Inc" without each caller
   *  hand-writing it. */
  ariaSuffix?: string;
  /** Visual variant — `subtle` (stone outline) is the default; `danger`
   *  styles archive/destroy with status-red affordance. */
  tone?: 'subtle' | 'danger' | 'accent' | 'success';
};

type LinkAction = BaseAction & {
  href: string;
  onClick?: never;
  disabled?: never;
};

type ButtonAction = BaseAction & {
  href?: never;
  onClick: () => void;
  disabled?: boolean;
};

export type RowAction = LinkAction | ButtonAction;

type RowActionsProps = {
  actions: ReadonlyArray<RowAction | null | false>;
  className?: string;
  /** Optional wrapping element override for caller-specific layout — most
   *  callers just rely on the default flex row. */
  align?: 'start' | 'end';
};

const toneClass: Record<NonNullable<BaseAction['tone']>, string> = {
  subtle:
    'border border-border bg-card text-muted-foreground hover:border-foreground hover:text-foreground',
  accent:
    'border border-accent/40 bg-card text-accent hover:border-accent hover:bg-accent/10',
  success:
    'border border-emerald-200 bg-card text-emerald-700 hover:border-emerald-400 hover:bg-emerald-50',
  danger:
    'border border-border bg-card text-status-red hover:border-status-red hover:bg-status-red/10',
};

const buttonShape =
  'inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-50';

function ariaLabelFor(action: RowAction): string {
  const verb = action.label ?? ROW_ACTION_LABELS[action.kind];
  return action.ariaSuffix ? `${verb} ${action.ariaSuffix}` : verb;
}

/**
 * Canonical per-row action group (0043 Phase 6). Renders each action with the
 * shared label + icon vocabulary from `ROW_ACTION_LABELS` / `ROW_ACTION_ICONS`
 * so every list page reads the same way.
 *
 * Falsy entries (`null` / `false`) are skipped so callers can inline
 * conditional actions without an outer wrapper:
 *
 * ```tsx
 * <RowActions
 *   actions={[
 *     { kind: 'view', href: `/dealerships/${id}` },
 *     showActivate && { kind: 'activate', onClick: () => activate(d) },
 *     { kind: 'edit', onClick: () => edit(d) },
 *     { kind: 'archive', onClick: () => archive(d), tone: 'danger' },
 *   ]}
 * />
 * ```
 */
export function RowActions({ actions, className, align = 'end' }: RowActionsProps) {
  const visible = actions.filter(
    (a): a is RowAction => a !== null && a !== false,
  );
  if (visible.length === 0) return null;
  return (
    <div
      className={cn(
        'flex shrink-0 items-center gap-1',
        align === 'end' && 'justify-end',
        className,
      )}
    >
      {visible.map((action, idx) => {
        const Icon = ROW_ACTION_ICONS[action.kind];
        const label = action.label ?? ROW_ACTION_LABELS[action.kind];
        const tone = action.tone ?? 'subtle';
        const shape = cn(buttonShape, toneClass[tone]);
        const ariaLabel = ariaLabelFor(action);
        if (action.href != null) {
          return (
            <Link
              key={`${action.kind}-${idx}`}
              href={action.href}
              aria-label={ariaLabel}
              className={shape}
            >
              <Icon className="size-3.5" aria-hidden />
              <span>{label}</span>
            </Link>
          );
        }
        const buttonProps: ComponentProps<'button'> = {
          type: 'button',
          'aria-label': ariaLabel,
          onClick: action.onClick,
          disabled: action.disabled,
          className: shape,
        };
        return (
          <button key={`${action.kind}-${idx}`} {...buttonProps}>
            <Icon className="size-3.5" aria-hidden />
            <span>{label}</span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * Re-export for callers that want to access the canonical label text
 * (e.g. in non-row contexts that still need to match the vocabulary).
 */
export function rowActionLabel(kind: RowActionKind): string {
  return ROW_ACTION_LABELS[kind];
}

export type { ReactNode };
