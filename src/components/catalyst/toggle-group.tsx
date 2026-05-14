'use client';

import * as Headless from '@headlessui/react';
import clsx from 'clsx';

type ToggleGroupProps = {
  value: string;
  onValueChange: (value: string) => void;
  className?: string;
  children: React.ReactNode;
  'aria-label'?: string;
};

export function ToggleGroup({
  value,
  onValueChange,
  className,
  children,
  'aria-label': ariaLabel,
}: ToggleGroupProps) {
  return (
    <Headless.RadioGroup
      value={value}
      onChange={onValueChange}
      aria-label={ariaLabel}
      className={clsx('inline-flex items-center gap-1', className)}
    >
      {children}
    </Headless.RadioGroup>
  );
}

type ToggleGroupItemProps = {
  value: string;
  className?: string;
  children: React.ReactNode;
};

export function ToggleGroupItem({ value, className, children }: ToggleGroupItemProps) {
  return (
    <Headless.Radio
      value={value}
      className={clsx(
        'cursor-pointer rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-sm font-medium text-zinc-700 transition',
        'data-checked:border-brand-500 data-checked:bg-brand-50 data-checked:text-brand-700',
        'data-hover:border-zinc-300 data-focus:outline-2 data-focus:outline-offset-2 data-focus:outline-brand-500',
        className,
      )}
    >
      {children}
    </Headless.Radio>
  );
}
