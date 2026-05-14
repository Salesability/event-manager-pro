import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

type PageHeaderProps = {
  title: ReactNode;
  actions?: ReactNode;
  description?: ReactNode;
  sticky?: boolean;
  className?: string;
};

/**
 * Page-level header for `(app)/` routes. Renders the page title (bold Inter,
 * post-0042 type scale) with an optional right-aligned actions slot. When
 * `sticky`, parks at `top-16` to sit just below the 64px sticky `AppHeader`.
 */
export function PageHeader({
  title,
  actions,
  description,
  sticky = false,
  className,
}: PageHeaderProps) {
  return (
    <header
      className={cn(
        'flex flex-wrap items-start justify-between gap-3 border-b border-zinc-200 bg-white py-4',
        sticky && 'sticky top-16 z-10',
        className,
      )}
    >
      <div className="min-w-0 flex-1 space-y-1">
        <h1 className="font-sans text-3xl font-bold tracking-tight text-zinc-900">
          {title}
        </h1>
        {description ? (
          <p className="text-sm text-zinc-500">{description}</p>
        ) : null}
      </div>
      {actions ? (
        <div className="flex shrink-0 items-center gap-2">{actions}</div>
      ) : null}
    </header>
  );
}
