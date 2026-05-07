'use client';

import * as TabsPrimitive from '@radix-ui/react-tabs';
import * as React from 'react';

// Wraps Radix Tabs in this app's Tailwind vocabulary, mirroring the public
// surface convention from `dialog.tsx`:
//   <Tabs.Root value={tab} onValueChange={setTab}>
//     <Tabs.List>
//       <Tabs.Trigger value="a">A</Tabs.Trigger>
//       <Tabs.Trigger value="b">B</Tabs.Trigger>
//     </Tabs.List>
//     <Tabs.Content value="a">…</Tabs.Content>
//     <Tabs.Content value="b">…</Tabs.Content>
//   </Tabs.Root>

function cx(...classes: Array<string | undefined>) {
  return classes.filter(Boolean).join(' ');
}

const Root = TabsPrimitive.Root;

const List = React.forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(function List({ className, ...props }, ref) {
  return (
    <TabsPrimitive.List
      ref={ref}
      className={cx(
        'inline-flex items-center gap-1 rounded-lg border border-stone-200 bg-white p-1 shadow-[0_1px_2px_rgba(15,30,60,0.04)]',
        className,
      )}
      {...props}
    />
  );
});

const Trigger = React.forwardRef<
  HTMLButtonElement,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(function Trigger({ className, ...props }, ref) {
  return (
    <TabsPrimitive.Trigger
      ref={ref}
      className={cx(
        'rounded-md px-3 py-1.5 text-xs font-semibold text-stone-600 transition',
        'hover:text-navy',
        'data-[state=active]:bg-navy data-[state=active]:text-white',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-navy/30',
        className,
      )}
      {...props}
    />
  );
});

const Content = React.forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(function Content({ className, ...props }, ref) {
  return (
    <TabsPrimitive.Content
      ref={ref}
      className={cx('mt-4 outline-none', className)}
      {...props}
    />
  );
});

export const Tabs = { Root, List, Trigger, Content };
