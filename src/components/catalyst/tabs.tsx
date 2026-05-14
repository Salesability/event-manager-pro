'use client';

import { createContext, useContext } from 'react';
import clsx from 'clsx';

type TabsContextValue = { value: string; onValueChange: (value: string) => void };
const TabsContext = createContext<TabsContextValue | null>(null);

function useTabs(): TabsContextValue {
  const ctx = useContext(TabsContext);
  if (!ctx) throw new Error('Tabs subcomponent must be rendered inside <Tabs>');
  return ctx;
}

type TabsProps = {
  value: string;
  onValueChange: (value: string) => void;
  className?: string;
  children: React.ReactNode;
};

export function Tabs({ value, onValueChange, className, children }: TabsProps) {
  return (
    <TabsContext.Provider value={{ value, onValueChange }}>
      <div data-slot="tabs" className={clsx('flex flex-col gap-4', className)}>
        {children}
      </div>
    </TabsContext.Provider>
  );
}

type TabsListProps = React.ComponentPropsWithoutRef<'div'> & {
  'aria-label'?: string;
};

export function TabsList({ className, children, ...props }: TabsListProps) {
  return (
    <div
      role="tablist"
      data-slot="tabs-list"
      className={clsx(
        'inline-flex items-center gap-1 rounded-lg bg-zinc-100 p-1 text-zinc-600',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

type TabsTriggerProps = Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'value'> & {
  value: string;
};

export function TabsTrigger({ value, className, children, ...props }: TabsTriggerProps) {
  const { value: current, onValueChange } = useTabs();
  const active = current === value;
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      data-active={active || undefined}
      onClick={() => onValueChange(value)}
      className={clsx(
        'inline-flex items-center justify-center rounded-md px-3 py-1 text-sm font-medium transition',
        active
          ? 'bg-white text-zinc-950 shadow-sm'
          : 'text-zinc-600 hover:text-zinc-900',
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

type TabsContentProps = React.ComponentPropsWithoutRef<'div'> & {
  value: string;
};

export function TabsContent({ value, className, children, ...props }: TabsContentProps) {
  const { value: current } = useTabs();
  if (current !== value) return null;
  return (
    <div role="tabpanel" data-slot="tabs-content" className={clsx('flex-1', className)} {...props}>
      {children}
    </div>
  );
}
