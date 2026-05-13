import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

type ListToolbarProps = {
  search?: ReactNode;
  filters?: ReactNode;
  actions?: ReactNode;
  className?: string;
};

/**
 * Canonical list-page filter bar shape: a flexible search input on the left,
 * a slot for filter pills/dropdowns in the middle, and a right-anchored
 * primary action. Same anatomy on every `(app)/` list page (per 0043 Phase 5)
 * so a scanner knows where to look regardless of which list they're on.
 */
export function ListToolbar({
  search,
  filters,
  actions,
  className,
}: ListToolbarProps) {
  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-2 print:hidden',
        className,
      )}
    >
      <div className="min-w-[14rem] flex-1">{search}</div>
      {filters ? (
        <div className="flex flex-wrap items-center gap-2">{filters}</div>
      ) : null}
      {actions ? (
        <div className="flex items-center gap-2">{actions}</div>
      ) : null}
    </div>
  );
}
