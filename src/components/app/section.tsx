import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

type SectionProps = {
  title: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  variant?: 'plain' | 'card';
  className?: string;
};

export function Section({
  title,
  actions,
  children,
  variant = 'plain',
  className,
}: SectionProps) {
  return (
    <section
      className={cn(
        'space-y-3',
        variant === 'card' &&
          'rounded-2xl border border-border bg-card p-5 shadow-soft',
        className,
      )}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          {title}
        </h2>
        {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}
