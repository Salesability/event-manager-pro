'use client';

import {
  CloseButton,
  Dialog as HUIDialog,
  DialogBackdrop as HUIBackdrop,
  DialogPanel as HUIPanel,
  DialogTitle as HUITitle,
  Description as HUIDescription,
} from '@headlessui/react';
import * as React from 'react';

function cx(...classes: Array<string | undefined>) {
  return classes.filter(Boolean).join(' ');
}

type RootProps = {
  open: boolean;
  onClose: (open: false) => void;
  children: React.ReactNode;
};

function Root({ open, onClose, children }: RootProps) {
  return (
    <HUIDialog
      open={open}
      onClose={() => onClose(false)}
      transition
      className="relative z-50 transition duration-150 ease-out data-closed:opacity-0"
    >
      {children}
    </HUIDialog>
  );
}

const Backdrop = React.forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<typeof HUIBackdrop>
>(function Backdrop({ className, ...props }, ref) {
  return (
    <HUIBackdrop
      ref={ref}
      transition
      className={cx(
        'fixed inset-0 z-40 bg-navy/40 backdrop-blur-sm transition duration-150 ease-out data-closed:opacity-0',
        className,
      )}
      {...props}
    />
  );
});

type PanelContainerProps = React.ComponentPropsWithoutRef<typeof HUIPanel>;

const Panel = React.forwardRef<HTMLDivElement, PanelContainerProps>(function Panel(
  { className, children, ...props },
  ref,
) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <HUIPanel
        ref={ref}
        transition
        className={cx(
          'w-full max-w-[560px] rounded-2xl border border-stone-200 bg-white p-6 shadow-[0_8px_32px_rgba(15,30,60,0.18)] outline-none transition duration-150 ease-out data-closed:scale-95 data-closed:opacity-0',
          className,
        )}
        {...props}
      >
        {children}
      </HUIPanel>
    </div>
  );
});

const Title = React.forwardRef<
  HTMLHeadingElement,
  React.ComponentPropsWithoutRef<typeof HUITitle>
>(function Title({ className, ...props }, ref) {
  return (
    <HUITitle
      ref={ref}
      className={cx('font-display text-2xl text-navy', className)}
      {...props}
    />
  );
});

const Description = React.forwardRef<
  HTMLParagraphElement,
  React.ComponentPropsWithoutRef<typeof HUIDescription>
>(function Description({ className, ...props }, ref) {
  return (
    <HUIDescription
      ref={ref}
      className={cx('mt-1 text-sm text-stone-600', className)}
      {...props}
    />
  );
});

export const Dialog = {
  Root,
  Backdrop,
  Panel,
  Title,
  Description,
  Close: CloseButton,
};
