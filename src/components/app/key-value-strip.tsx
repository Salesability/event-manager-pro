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
 * tracking-wider text-muted-foreground`) over their values, auto-flowing in a
 * responsive grid. Same anatomy on every detail page (per 0043 Phase 4) so a
 * scanner knows where to look regardless of which record they're reading.
 */
export function KeyValueStrip({ items, className }: KeyValueStripProps) {
  return (
    <dl
      className={cn(
        'grid grid-cols-2 gap-x-6 gap-y-4 rounded-xl border border-border bg-card p-4 sm:grid-cols-3 lg:grid-cols-6',
        className,
      )}
    >
      {items.map((item) => (
        <div key={item.label} className="flex min-w-0 flex-col gap-1">
          <dt className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {item.label}
          </dt>
          <dd className="truncate text-sm font-medium text-foreground">
            {item.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
