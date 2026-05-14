'use client';

import { Toaster as SonnerToaster, toast } from 'sonner';

export function Toaster() {
  return (
    <SonnerToaster
      position="top-right"
      richColors
      closeButton
      duration={5000}
      toastOptions={{
        classNames: {
          toast:
            'rounded-xl border border-zinc-200 bg-white text-brand-700 shadow-[0_4px_16px_rgba(15,30,60,0.12)]',
          title: 'text-sm font-semibold text-brand-700',
          description: 'text-xs text-zinc-500',
          success: '!border-l-4 !border-l-status-green',
          error: '!border-l-4 !border-l-status-red',
          info: '!border-l-4 !border-l-status-blue',
        },
      }}
    />
  );
}

export { toast };
