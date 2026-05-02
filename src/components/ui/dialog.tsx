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
          'relative w-full max-w-[560px] rounded-2xl border border-stone-200 bg-white p-6 shadow-[0_8px_32px_rgba(15,30,60,0.18)] outline-none transition duration-150 ease-out data-closed:scale-95 data-closed:opacity-0',
          className,
        )}
        {...props}
      >
        <CloseButton
          aria-label="Close"
          className="absolute top-3 right-3 inline-flex h-8 w-8 items-center justify-center rounded-full text-stone-500 transition hover:bg-stone-100 hover:text-navy focus:outline-none focus-visible:ring-2 focus-visible:ring-navy"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 20 20"
            fill="currentColor"
            className="h-4 w-4"
            aria-hidden="true"
          >
            <path d="M5.28 4.22a.75.75 0 0 0-1.06 1.06L8.94 10l-4.72 4.72a.75.75 0 1 0 1.06 1.06L10 11.06l4.72 4.72a.75.75 0 1 0 1.06-1.06L11.06 10l4.72-4.72a.75.75 0 0 0-1.06-1.06L10 8.94 5.28 4.22Z" />
          </svg>
        </CloseButton>
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
