'use client';

import { useCallback, useState } from 'react';
import {
  Alert,
  AlertActions,
  AlertDescription,
  AlertTitle,
} from '@/components/catalyst/alert';
import { Button } from '@/components/catalyst/button';

export type ConfirmOptions = {
  title: string;
  /** Optional supporting copy under the title. */
  message?: string;
  /** Label on the affirmative button. Defaults to `Confirm`. */
  confirmLabel?: string;
  /** Label on the dismiss button. Defaults to `Cancel`. */
  cancelLabel?: string;
  /** Soft/tonal-red confirm button (0081 doctrine) for destructive actions. */
  destructive?: boolean;
};

export function ConfirmDialog({
  open,
  options,
  onResolve,
}: {
  open: boolean;
  options: ConfirmOptions;
  onResolve: (confirmed: boolean) => void;
}) {
  const confirmLabel = options.confirmLabel ?? 'Confirm';
  const cancelLabel = options.cancelLabel ?? 'Cancel';
  return (
    <Alert size="sm" open={open} onClose={() => onResolve(false)}>
      <AlertTitle>{options.title}</AlertTitle>
      {options.message && <AlertDescription>{options.message}</AlertDescription>}
      <AlertActions>
        <Button type="button" outline onClick={() => onResolve(false)}>
          {cancelLabel}
        </Button>
        {options.destructive ? (
          <Button type="button" destructive onClick={() => onResolve(true)}>
            {confirmLabel}
          </Button>
        ) : (
          <Button type="button" color="brand" onClick={() => onResolve(true)}>
            {confirmLabel}
          </Button>
        )}
      </AlertActions>
    </Alert>
  );
}

// Promise-based replacement for `window.confirm` — call sites stay as simple as
// the `if (!(await confirm({...}))) return` they migrate from. One pending
// request at a time; cancel, backdrop click, and Escape all resolve `false`.
export function useConfirm() {
  const [request, setRequest] = useState<{
    options: ConfirmOptions;
    resolve: (confirmed: boolean) => void;
  } | null>(null);

  const confirm = useCallback(
    (options: ConfirmOptions) =>
      new Promise<boolean>((resolve) => setRequest({ options, resolve })),
    [],
  );

  const confirmDialog = request ? (
    <ConfirmDialog
      open
      options={request.options}
      onResolve={(confirmed) => {
        request.resolve(confirmed);
        setRequest(null);
      }}
    />
  ) : null;

  return { confirm, confirmDialog };
}
