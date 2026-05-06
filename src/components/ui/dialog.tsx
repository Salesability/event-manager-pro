'use client';

import * as DialogPrimitive from '@radix-ui/react-dialog';
import * as React from 'react';

// Public surface preserved from the previous Headless UI wrapper so call
// sites in `people-admin.tsx`, `calendar-view.tsx`, `lists/list-actions.tsx`,
// `production/row-actions.tsx`, etc. don't change:
//   <Dialog.Root open onClose={setOpen}>
//     <Dialog.Backdrop />
//     <Dialog.Panel>
//       <Dialog.Title>...</Dialog.Title>
//       <Dialog.Description>...</Dialog.Description>
//       ...
//       <Dialog.Close>Cancel</Dialog.Close>
//     </Dialog.Panel>
//   </Dialog.Root>
//
// Radix's tree is `Root > Portal > (Overlay + Content > Title/Description/Close)`.
// `Root` here wraps children in a single `Portal` so consumers can keep rendering
// `Backdrop` + `Panel` as siblings; `Backdrop` becomes `Overlay`, `Panel`
// becomes `Content`. Transition selectors changed from HUI's `data-closed:*`
// to Radix's `data-[state=closed]:*`. Close-side transitions may be cut by
// Radix's default unmount-on-close — acceptable for v1 (the bigger UX win is
// the wrapper-swap itself; richer enter/leave animations are tunable later
// with `forceMount` + tailwindcss-animate).

function cx(...classes: Array<string | undefined>) {
  return classes.filter(Boolean).join(' ');
}

// Focus-restore plumbing. Radix returns focus to a `Dialog.Trigger` on close
// by default, but our consumers open dialogs via controlled `open` props
// without a Trigger (the trigger button lives outside `Dialog.Root`). Without
// this, Esc / outside-click / Close would land focus on `<body>` — keyboard
// users would lose their place. Root captures `document.activeElement` at
// open-time; Panel's `onCloseAutoFocus` restores it on close.
type SavedFocusRef = React.MutableRefObject<HTMLElement | null>;
const FocusContext = React.createContext<SavedFocusRef | null>(null);

type RootProps = {
  open: boolean;
  onClose: (open: false) => void;
  children: React.ReactNode;
};

function Root({ open, onClose, children }: RootProps) {
  const savedFocus = React.useRef<HTMLElement | null>(null);
  React.useEffect(() => {
    if (open && document.activeElement instanceof HTMLElement) {
      savedFocus.current = document.activeElement;
    }
  }, [open]);

  return (
    <FocusContext.Provider value={savedFocus}>
      <DialogPrimitive.Root
        open={open}
        onOpenChange={(next) => {
          if (!next) onClose(false);
        }}
      >
        <DialogPrimitive.Portal>{children}</DialogPrimitive.Portal>
      </DialogPrimitive.Root>
    </FocusContext.Provider>
  );
}

const Backdrop = React.forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(function Backdrop({ className, ...props }, ref) {
  return (
    <DialogPrimitive.Overlay
      ref={ref}
      className={cx(
        'fixed inset-0 z-40 bg-navy/40 backdrop-blur-sm transition-opacity duration-150 ease-out data-[state=closed]:opacity-0',
        className,
      )}
      {...props}
    />
  );
});

type PanelContainerProps = Omit<
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>,
  'children'
> & {
  children?: React.ReactNode;
};

const Panel = React.forwardRef<HTMLDivElement, PanelContainerProps>(function Panel(
  { className, children, ...props },
  ref,
) {
  const savedFocus = React.useContext(FocusContext);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <DialogPrimitive.Content
        ref={ref}
        onCloseAutoFocus={(e) => {
          // Override Radix's default trigger-focus restore (we don't use
          // `Dialog.Trigger`); jump back to whatever was focused when the
          // dialog opened.
          if (savedFocus?.current) {
            e.preventDefault();
            savedFocus.current.focus();
          }
        }}
        className={cx(
          'relative w-full max-w-[560px] rounded-2xl border border-stone-200 bg-white p-6 shadow-[0_8px_32px_rgba(15,30,60,0.18)] outline-none transition duration-150 ease-out data-[state=closed]:scale-95 data-[state=closed]:opacity-0',
          className,
        )}
        {...props}
      >
        <DialogPrimitive.Close
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
        </DialogPrimitive.Close>
        {children}
      </DialogPrimitive.Content>
    </div>
  );
});

const Title = React.forwardRef<
  HTMLHeadingElement,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(function Title({ className, ...props }, ref) {
  return (
    <DialogPrimitive.Title
      ref={ref}
      className={cx('font-display text-2xl text-navy', className)}
      {...props}
    />
  );
});

const Description = React.forwardRef<
  HTMLParagraphElement,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(function Description({ className, ...props }, ref) {
  return (
    <DialogPrimitive.Description
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
  Close: DialogPrimitive.Close,
};
