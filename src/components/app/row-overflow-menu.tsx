'use client';

import { MoreHorizontal } from 'lucide-react';
import {
  Dropdown,
  DropdownButton,
  DropdownMenu,
  DropdownItem,
} from '@/components/catalyst/dropdown';
import { ROW_ACTION_ICONS } from '@/lib/ui/icons';
import { ROW_ACTION_LABELS } from '@/lib/ui/labels';
import type { RowAction } from './row-actions';

type RowOverflowMenuProps = {
  /** Same shape as `<RowActions>`'s `actions` prop — callers can inline
   *  conditional entries with `null`/`false` and they get filtered out.
   *  Falsy menus (no surviving actions) render nothing. */
  actions: ReadonlyArray<RowAction | null | false>;
  /** Optional row identifier folded into the trigger's `aria-label` so
   *  screen readers hear "Open row actions for Acme Inc" rather than the
   *  bare "Open row actions". */
  ariaSuffix?: string;
};

/**
 * Row-end `…` overflow menu (0050). Replaces the inline-button row
 * (`<RowActions>`) on grids that adopt the edit-default pattern: the row
 * click is the View/Edit affordance (via `<RowIdentityCell>`'s dotted
 * underline), and everything else — Activate, Archive, Quote, future
 * non-CRUD verbs — collapses into the `…` menu.
 *
 * Re-uses the canonical `RowActionKind` / `ROW_ACTION_ICONS` /
 * `ROW_ACTION_LABELS` vocabulary so a grid that swaps in this primitive
 * keeps the same labels + icons that `<RowActions>` was rendering. Only
 * the rendering layer changes.
 *
 * Composes Catalyst's `<Dropdown>` (Headless UI Menu) so the keyboard
 * semantics — Arrow/Home/End navigation, Enter/Space activate, Escape
 * close, focus-restore to the trigger — come for free.
 */
export function RowOverflowMenu({ actions, ariaSuffix }: RowOverflowMenuProps) {
  const visible = actions.filter(
    (a): a is RowAction => a !== null && a !== false,
  );
  if (visible.length === 0) return null;

  const triggerLabel = ariaSuffix
    ? `Open row actions for ${ariaSuffix}`
    : 'Open row actions';

  return (
    <Dropdown>
      <DropdownButton
        as="button"
        aria-label={triggerLabel}
        className="inline-flex size-7 items-center justify-center rounded-md text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 data-open:bg-zinc-100 data-open:text-zinc-700"
      >
        <MoreHorizontal className="size-4" aria-hidden />
      </DropdownButton>
      <DropdownMenu anchor="bottom end" className="min-w-[10rem]">
        {visible.map((action, idx) => {
          const Icon = ROW_ACTION_ICONS[action.kind];
          const label = action.label ?? ROW_ACTION_LABELS[action.kind];
          const isDanger = action.tone === 'danger';
          // Catalyst's `<DropdownItem>` defaults to `data-focus:bg-blue-500
          // data-focus:text-white`. Danger items override both with red so
          // the focus state still reads as destructive; the `!` important
          // modifier wins over the base styles (which Catalyst merges via
          // plain clsx, not tailwind-merge).
          const dangerClass = isDanger
            ? 'text-red-700! data-focus:bg-red-50! data-focus:text-red-900! [&_[data-slot=icon]]:text-red-700! data-focus:[&_[data-slot=icon]]:text-red-700!'
            : '';

          if (action.href != null) {
            return (
              <DropdownItem
                key={`${action.kind}-${idx}`}
                href={action.href}
                className={dangerClass}
              >
                <Icon data-slot="icon" aria-hidden />
                <span>{label}</span>
              </DropdownItem>
            );
          }
          return (
            <DropdownItem
              key={`${action.kind}-${idx}`}
              onClick={action.onClick}
              disabled={action.disabled}
              className={dangerClass}
            >
              <Icon data-slot="icon" aria-hidden />
              <span>{label}</span>
            </DropdownItem>
          );
        })}
      </DropdownMenu>
    </Dropdown>
  );
}
