import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export type KeyValueItem = {
  label: string;
  value: ReactNode;
};

type KeyValueStripProps = {
  items: KeyValueItem[];
  className?: string;
};

/**
 * Detail-page key-value strip. Uppercase muted labels (`text-xs uppercase
 * tracking-wider text-zinc-500`) over their values, auto-flowing in a
 * responsive grid. Same anatomy on every detail page (per 0043 Phase 4) so a
 * scanner knows where to look regardless of which record they're reading.
 */
export function KeyValueStrip({ items, className }: KeyValueStripProps) {
  return (
    <dl
      className={cn(
        'grid grid-cols-2 gap-x-6 gap-y-4 rounded-xl border border-zinc-200 bg-white p-4 sm:grid-cols-3 lg:grid-cols-6',
        className,
      )}
    >
      {items.map((item) => (
        <div key={item.label} className="flex min-w-0 flex-col gap-1">
          <dt className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
            {item.label}
          </dt>
          <dd className="truncate text-sm font-medium text-zinc-900">
            {item.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
