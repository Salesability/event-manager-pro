'use client';

import { useState, useTransition } from 'react';
import { Dialog } from '@/components/ui/dialog';
import { toast } from '@/components/ui/toaster';
import { archiveCoach, archiveDealer } from '@/features/schedule/actions';
import type { Coach, Dealer } from '@/features/schedule/queries';
import { CoachForm } from './coach-form';
import { DealerForm } from './dealer-form';

const headerAddClass =
  'rounded-lg border border-accent/40 bg-white px-3 py-1 text-xs font-semibold text-accent transition hover:border-accent hover:bg-accent/10';

const rowEditClass =
  'rounded border border-stone-200 bg-white px-2 py-0.5 text-xs font-medium text-stone-600 transition hover:border-navy hover:text-navy';

const rowDeleteClass =
  'rounded border border-stone-200 bg-white px-2 py-0.5 text-xs font-bold text-status-red transition hover:border-status-red hover:bg-status-red/10 disabled:cursor-not-allowed disabled:opacity-50';

export function AddDealerButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)} className={headerAddClass}>
        + Add Client
      </button>
      <Dialog.Root open={open} onClose={setOpen}>
        <Dialog.Backdrop />
        <Dialog.Panel>
          <Dialog.Title>Add Client</Dialog.Title>
          <Dialog.Description>Create a new dealership.</Dialog.Description>
          {open && <DealerForm mode="create" onSuccess={() => setOpen(false)} />}
        </Dialog.Panel>
      </Dialog.Root>
    </>
  );
}

export function DealerRowActions({ dealer }: { dealer: Dealer }) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function onDelete() {
    if (!confirm(`Archive ${dealer.name}? Existing campaigns will keep their reference.`)) return;
    startTransition(async () => {
      const fd = new FormData();
      fd.set('id', String(dealer.id));
      const result = await archiveDealer(fd);
      if ('ok' in result) toast.success('Dealer removed');
      else toast.error(result.error);
    });
  }

  return (
    <div className="flex shrink-0 items-center gap-1">
      <button onClick={() => setOpen(true)} className={rowEditClass}>
        Edit
      </button>
      <button
        onClick={onDelete}
        disabled={pending}
        aria-label={`Remove ${dealer.name}`}
        className={rowDeleteClass}
      >
        ✕
      </button>
      <Dialog.Root open={open} onClose={setOpen}>
        <Dialog.Backdrop />
        <Dialog.Panel>
          <Dialog.Title>Edit Client</Dialog.Title>
          {open && <DealerForm mode="edit" dealer={dealer} onSuccess={() => setOpen(false)} />}
        </Dialog.Panel>
      </Dialog.Root>
    </div>
  );
}

export function AddCoachButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)} className={headerAddClass}>
        + Add Coach
      </button>
      <Dialog.Root open={open} onClose={setOpen}>
        <Dialog.Backdrop />
        <Dialog.Panel>
          <Dialog.Title>Add Coach</Dialog.Title>
          <Dialog.Description>Create a new sales coach.</Dialog.Description>
          {open && <CoachForm mode="create" onSuccess={() => setOpen(false)} />}
        </Dialog.Panel>
      </Dialog.Root>
    </>
  );
}

export function CoachRowActions({ coach }: { coach: Coach }) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function onDelete() {
    if (!confirm(`Archive ${coach.displayName}? Existing campaigns will keep their reference.`))
      return;
    startTransition(async () => {
      const fd = new FormData();
      fd.set('id', String(coach.id));
      const result = await archiveCoach(fd);
      if ('ok' in result) toast.success('Coach removed');
      else toast.error(result.error);
    });
  }

  return (
    <div className="flex shrink-0 items-center gap-1">
      <button onClick={() => setOpen(true)} className={rowEditClass}>
        Edit
      </button>
      <button
        onClick={onDelete}
        disabled={pending}
        aria-label={`Remove ${coach.displayName}`}
        className={rowDeleteClass}
      >
        ✕
      </button>
      <Dialog.Root open={open} onClose={setOpen}>
        <Dialog.Backdrop />
        <Dialog.Panel>
          <Dialog.Title>Edit Coach</Dialog.Title>
          {open && <CoachForm mode="edit" coach={coach} onSuccess={() => setOpen(false)} />}
        </Dialog.Panel>
      </Dialog.Root>
    </div>
  );
}
