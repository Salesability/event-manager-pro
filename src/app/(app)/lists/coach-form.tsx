'use client';

import { useActionState, useEffect } from 'react';
import { toast } from '@/components/ui/toaster';
import { createCoach, updateCoach } from '@/features/schedule/actions';
import type { Coach } from '@/features/schedule/queries';

type Mode = 'create' | 'edit';
type State = { ok: true } | { error: string } | null;

type CoachFormProps = {
  mode: Mode;
  coach?: Coach;
  onSuccess: () => void;
};

export function CoachForm({ mode, coach, onSuccess }: CoachFormProps) {
  const action = mode === 'create' ? createCoach : updateCoach;
  const [state, formAction, pending] = useActionState<State, FormData>(
    async (_prev, fd) => action(fd),
    null,
  );

  useEffect(() => {
    if (!state) return;
    if ('ok' in state) {
      toast.success(mode === 'create' ? 'Coach added' : 'Coach saved');
      onSuccess();
    } else {
      toast.error(state.error);
    }
  }, [state, mode, onSuccess]);

  return (
    <form action={formAction} className="mt-4 flex flex-col gap-4">
      {mode === 'edit' && coach && (
        <input type="hidden" name="id" value={coach.id} />
      )}

      <div className="grid grid-cols-2 gap-3">
        <Field label="First Name" htmlFor="coach-first" required>
          <input
            id="coach-first"
            name="firstName"
            type="text"
            required
            defaultValue={coach?.firstName ?? ''}
            autoFocus
            className={inputClass}
          />
        </Field>
        <Field label="Last Name" htmlFor="coach-last" required>
          <input
            id="coach-last"
            name="lastName"
            type="text"
            required
            defaultValue={coach?.lastName ?? ''}
            className={inputClass}
          />
        </Field>
      </div>

      <Field label="Email" htmlFor="coach-email">
        <input
          id="coach-email"
          name="email"
          type="email"
          defaultValue={coach?.primaryEmail ?? ''}
          className={inputClass}
        />
      </Field>

      <Field label="Phone" htmlFor="coach-phone">
        <input
          id="coach-phone"
          name="phone"
          type="tel"
          defaultValue={coach?.primaryPhone ?? ''}
          className={inputClass}
        />
      </Field>

      <Field label="Specialty" htmlFor="coach-specialty">
        <input
          id="coach-specialty"
          name="specialty"
          type="text"
          defaultValue={coach?.specialty ?? ''}
          placeholder="e.g. Used Vehicle Sales"
          className={inputClass}
        />
      </Field>

      <div className="mt-2 flex justify-end gap-2">
        <button
          type="button"
          onClick={onSuccess}
          className="rounded-lg border border-stone-200 bg-white px-4 py-2 text-sm font-medium text-stone-600 transition hover:border-stone-400 hover:text-navy"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-navy px-4 py-2 text-sm font-medium text-white transition hover:bg-navy-light disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pending ? 'Saving…' : mode === 'create' ? 'Add Coach' : 'Save'}
        </button>
      </div>
    </form>
  );
}

const inputClass =
  'rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm text-stone-800 outline-none transition focus:border-accent focus:ring-3 focus:ring-accent/20';

function Field({
  label,
  htmlFor,
  required,
  children,
}: {
  label: string;
  htmlFor: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label
        htmlFor={htmlFor}
        className="text-xs font-semibold uppercase tracking-wide text-stone-600"
      >
        {label}
        {required && <span className="ml-1 text-status-red">*</span>}
      </label>
      {children}
    </div>
  );
}
