'use client';

import * as Popover from '@radix-ui/react-popover';
import { Command } from 'cmdk';
import * as React from 'react';

// Typeable, filterable single-select. Built from `cmdk` (the keyboard +
// filtering engine, Radix-adjacent) inside a Radix Popover (positioning +
// portal + outside-click). Headless wrapper layer matches the project's
// `Dialog` shape: feature code passes options + value + onChange; the
// wrapper owns the open-state, typeahead filter, and the Tailwind look.
//
// Wire format: state-only. Caller is responsible for serializing the picked
// value into FormData via a hidden input next to the form (matches how the
// PersonForm handles `dealerLinks=<id>:<role>` rows).

function cx(...classes: Array<string | undefined | false>) {
  return classes.filter(Boolean).join(' ');
}

export type ComboboxOption = {
  value: string;
  label: string;
};

type ComboboxProps = {
  options: ComboboxOption[];
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  inputPlaceholder?: string;
  emptyMessage?: string;
  className?: string;
  buttonClassName?: string;
  ariaLabel?: string;
};

export function Combobox({
  options,
  value,
  onChange,
  placeholder = 'Pick one…',
  inputPlaceholder = 'Type to filter…',
  emptyMessage = 'No matches.',
  className,
  buttonClassName,
  ariaLabel,
}: ComboboxProps) {
  const [open, setOpen] = React.useState(false);
  const selected = options.find((o) => o.value === value);

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        type="button"
        aria-label={ariaLabel}
        className={cx(
          'flex min-w-0 items-center justify-between gap-2 rounded-lg border border-stone-200 bg-white px-3 py-2 text-left text-sm text-stone-800 outline-none transition focus:border-accent focus:ring-3 focus:ring-accent/20',
          !selected && 'text-stone-400',
          buttonClassName,
        )}
      >
        <span className="min-w-0 truncate">{selected?.label ?? placeholder}</span>
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 20 20"
          fill="currentColor"
          className="h-3 w-3 shrink-0 text-stone-500"
          aria-hidden="true"
        >
          <path
            fillRule="evenodd"
            d="M5.22 7.22a.75.75 0 0 1 1.06 0L10 10.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 8.28a.75.75 0 0 1 0-1.06Z"
            clipRule="evenodd"
          />
        </svg>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={4}
          className={cx(
            'z-50 w-[var(--radix-popover-trigger-width)] overflow-hidden rounded-lg border border-stone-200 bg-white shadow-[0_8px_24px_rgba(15,30,60,0.12)] outline-none data-[state=closed]:opacity-0',
            className,
          )}
        >
          <Command className="flex flex-col">
            <Command.Input
              placeholder={inputPlaceholder}
              className="border-b border-stone-200 px-3 py-2 text-sm text-stone-800 outline-none placeholder:text-stone-400"
            />
            <Command.List className="max-h-60 overflow-y-auto p-1">
              <Command.Empty className="px-2 py-1.5 text-xs text-stone-500">
                {emptyMessage}
              </Command.Empty>
              {options.map((o) => (
                <Command.Item
                  key={o.value}
                  // Use the option's stable `value` (e.g. a dealer ID) for
                  // cmdk's item identity so two options that happen to share
                  // a display name (e.g. two "Capital Ford" dealerships)
                  // don't collide on Arrow+Enter keyboard selection. Search
                  // continues to match by label via `keywords`.
                  value={o.value}
                  keywords={[o.label]}
                  onSelect={() => {
                    onChange(o.value);
                    setOpen(false);
                  }}
                  className="cursor-pointer rounded px-2 py-1.5 text-sm text-stone-700 aria-selected:bg-accent/10 aria-selected:text-navy"
                >
                  {o.label}
                </Command.Item>
              ))}
            </Command.List>
          </Command>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
