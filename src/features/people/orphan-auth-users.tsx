'use client';

import { useActionState, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Can } from '@/components/auth/can';
import { Dialog } from '@/components/ui/dialog';
import { toast } from '@/components/ui/toaster';
import { adoptOrphanAuthUser } from '@/features/people/actions';
import type { OrphanAuthUser } from '@/features/people/queries';

const inputClass =
  'min-w-0 rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm text-stone-800 outline-none transition focus:border-accent focus:ring-3 focus:ring-accent/20';

const rowEditClass =
  'rounded border border-stone-200 bg-white px-2 py-0.5 text-xs font-medium text-stone-600 transition hover:border-navy hover:text-navy';

const submitClass =
  'rounded-lg bg-navy px-3 py-2 text-xs font-semibold text-white transition hover:bg-navy-light disabled:cursor-not-allowed disabled:opacity-60';

// Surfaced only when the page query found at least one orphan auth.users row.
// Adopting one materializes a contacts row + email identifier and links via
// `contacts.user_id`, after which the row reappears on the main People list
// and the orphan panel shrinks.
export function OrphanAuthUsers({ orphans }: { orphans: OrphanAuthUser[] }) {
  return (
    <section className="rounded-2xl border border-amber-300 bg-amber-50/60 p-5">
      <div>
        <h2 className="font-display text-lg text-amber-900">Unprovisioned auth users</h2>
        <p className="text-xs text-amber-800/80">
          {orphans.length} sign-in account{orphans.length === 1 ? '' : 's'} with no matching person
          record. Adopt to create a contact and link them.
        </p>
      </div>
      <ul className="mt-3 flex flex-col gap-2">
        {orphans.map((o) => (
          <OrphanRow key={o.userId} orphan={o} />
        ))}
      </ul>
    </section>
  );
}

function OrphanRow({ orphan }: { orphan: OrphanAuthUser }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="flex items-center justify-between gap-4 rounded-lg border border-amber-200 bg-white px-4 py-2">
      <div className="min-w-0 text-sm">
        <div className="truncate font-medium text-stone-800">{orphan.email ?? orphan.userId}</div>
        <div className="text-xs text-stone-500">
          providers: {orphan.providers.join(', ')}
          {orphan.lastSignInAt && ` · last sign-in ${new Date(orphan.lastSignInAt).toLocaleDateString()}`}
        </div>
      </div>
      <Can capability="person:adopt-orphan">
        <button onClick={() => setOpen(true)} className={rowEditClass}>
          Adopt
        </button>
      </Can>
      <Dialog.Root open={open} onClose={setOpen}>
        <Dialog.Backdrop />
        <Dialog.Panel>
          <Dialog.Title>Adopt {orphan.email ?? orphan.userId}</Dialog.Title>
          <Dialog.Description>
            Create a contacts row for this auth user and link it.
          </Dialog.Description>
          {open && <AdoptForm orphan={orphan} onSuccess={() => setOpen(false)} />}
        </Dialog.Panel>
      </Dialog.Root>
    </li>
  );
}

type AdoptState =
  | { ok: true; contactId?: number; warning?: string }
  | { error: string }
  | null;

function AdoptForm({
  orphan,
  onSuccess,
}: {
  orphan: OrphanAuthUser;
  onSuccess: () => void;
}) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState<AdoptState, FormData>(
    async (_prev, fd) => adoptOrphanAuthUser(fd),
    null,
  );

  useEffect(() => {
    if (!state) return;
    if ('ok' in state) {
      toast.success('Adopted');
      router.refresh();
      onSuccess();
    } else {
      toast.error(state.error);
    }
  }, [state, router, onSuccess]);

  return (
    <form action={formAction} className="mt-4 flex flex-col gap-3">
      <input type="hidden" name="userId" value={orphan.userId} />
      {orphan.email && <input type="hidden" name="email" value={orphan.email} />}
      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1 text-xs font-medium text-stone-600">
          First name
          <input
            type="text"
            name="firstName"
            className={inputClass}
            autoFocus
            required
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-stone-600">
          Last name
          <input type="text" name="lastName" className={inputClass} required />
        </label>
      </div>
      {orphan.email && (
        <p className="text-[11px] text-stone-500">
          Will use <code>{orphan.email}</code> as the primary email identifier.
        </p>
      )}
      <div className="mt-2 flex justify-end gap-2">
        <Dialog.Close className={rowEditClass}>Cancel</Dialog.Close>
        <button type="submit" disabled={pending} className={submitClass}>
          {pending ? 'Adopting…' : 'Adopt'}
        </button>
      </div>
    </form>
  );
}
