'use client';

import { useActionState, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Can } from '@/components/auth/can';
import { toast } from '@/components/ui/toaster';
import { toLegacyResult } from '@/lib/actions/legacy-result';
import {
  archiveCampaignStyle,
  archiveAudienceSource,
  createCampaignStyle,
  createAudienceSource,
  updateCampaignStyle,
  updateAudienceSource,
} from '@/features/schedule/actions';
import type { LookupOption } from '@/features/schedule/queries';

// All six lookup actions share the safe-action shape post-0033 (returns
// `Promise<SafeActionResult<...>>`). Caller-side compat to the legacy
// `{ok|error}` is via `toLegacyResult`.
type LookupAction = typeof createCampaignStyle;
type LookupKind = 'styles' | 'sources';

const configs: Record<
  LookupKind,
  {
    title: string;
    empty: string;
    addLabel: string;
    createAction: LookupAction;
    updateAction: LookupAction;
    archiveAction: LookupAction;
  }
> = {
  styles: {
    title: 'Event Styles',
    empty: 'No event styles yet.',
    addLabel: 'Add Style',
    createAction: createCampaignStyle,
    updateAction: updateCampaignStyle,
    archiveAction: archiveCampaignStyle,
  },
  sources: {
    title: 'Data Sources',
    empty: 'No data sources yet.',
    addLabel: 'Add Source',
    createAction: createAudienceSource,
    updateAction: updateAudienceSource,
    archiveAction: archiveAudienceSource,
  },
};

const inputClass =
  'min-w-0 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 outline-none transition focus:border-brand-500 focus:ring-3 focus:ring-brand-500/20';

const buttonClass =
  'rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs font-semibold text-zinc-900 transition hover:border-brand-500 hover:text-brand-700 disabled:cursor-not-allowed disabled:opacity-50';

export function LookupAdmin({
  kind,
  items,
  compact = false,
}: {
  kind: LookupKind;
  items: LookupOption[];
  compact?: boolean;
}) {
  const config = configs[kind];
  const router = useRouter();
  const [renamed, setRenamed] = useState<Record<number, string>>({});
  const [archivedIds, setArchivedIds] = useState<Set<number>>(() => new Set());
  const formRef = useRef<HTMLFormElement>(null);

  const rows = useMemo(
    () =>
      items
        .filter((item) => !archivedIds.has(item.id))
        .map((item) => ({ ...item, label: renamed[item.id] ?? item.label })),
    [archivedIds, items, renamed],
  );

  function refresh() {
    router.refresh();
  }

  type AddState = { ok: true } | { error: string } | null;
  const [addState, addAction, pending] = useActionState<AddState, FormData>(
    async (_prev, fd) => {
      const result = toLegacyResult(await config.createAction(fd));
      if ('ok' in result) {
        // Drop any optimistic mutations that the upcoming router.refresh()
        // would superscede — server is now the source of truth again.
        setArchivedIds(new Set());
        setRenamed({});
      }
      return result;
    },
    null,
  );

  useEffect(() => {
    if (!addState) return;
    if ('ok' in addState) {
      toast.success(`${config.title.slice(0, -1)} added`);
      formRef.current?.reset();
      refresh();
    } else {
      toast.error(addState.error);
    }
    // refresh + config are stable for the lifetime of this component instance.
  }, [addState]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <section
      className={
        compact
          ? 'flex flex-col gap-3'
          : 'rounded-2xl border border-zinc-200 bg-white p-5 shadow-[0_1px_4px_rgba(15,30,60,0.08)]'
      }
    >
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-sans font-bold tracking-tight text-2xl text-brand-700">{config.title}</h2>
        <span className="rounded-full bg-brand-50 px-2.5 py-1 text-xs font-semibold text-brand-700">
          {rows.length}
        </span>
      </div>

      <Can capability="lookup:edit">
        <form ref={formRef} action={addAction} className="mt-3 flex gap-2">
          <input
            name="label"
            className={`${inputClass} flex-1`}
            placeholder={config.addLabel}
            maxLength={120}
          />
          <button
            type="submit"
            disabled={pending}
            className="rounded-lg bg-brand-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Add
          </button>
        </form>
      </Can>

      <div className="mt-4 flex flex-col divide-y divide-zinc-200">
        {rows.length === 0 ? (
          <div className="rounded-lg bg-zinc-100 px-3 py-6 text-center text-sm text-zinc-500">
            {config.empty}
          </div>
        ) : (
          rows.map((item) => (
            <LookupRow
              key={`${item.id}:${item.label}`}
              item={item}
              updateAction={config.updateAction}
              archiveAction={config.archiveAction}
              onChanged={refresh}
              onLocalRename={(nextLabel) =>
                setRenamed((current) => ({ ...current, [item.id]: nextLabel }))
              }
              onLocalArchive={() =>
                setArchivedIds((current) => new Set(current).add(item.id))
              }
            />
          ))
        )}
      </div>
    </section>
  );
}

function LookupRow({
  item,
  updateAction,
  archiveAction,
  onChanged,
  onLocalRename,
  onLocalArchive,
}: {
  item: LookupOption;
  updateAction: LookupAction;
  archiveAction: LookupAction;
  onChanged: () => void;
  onLocalRename: (label: string) => void;
  onLocalArchive: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState(item.label);
  const [pending, startTransition] = useTransition();

  function save() {
    const nextLabel = label.trim();
    if (!nextLabel) {
      toast.error('Label is required.');
      return;
    }

    startTransition(async () => {
      const fd = new FormData();
      fd.set('id', String(item.id));
      fd.set('label', nextLabel);
      const result = toLegacyResult(await updateAction(fd));
      if ('ok' in result) {
        toast.success('Lookup renamed');
        onLocalRename(nextLabel);
        setEditing(false);
        onChanged();
      } else {
        toast.error(result.error);
      }
    });
  }

  function archive() {
    if (!confirm(`Archive ${item.label}? Existing campaigns will keep this label.`)) return;

    startTransition(async () => {
      const fd = new FormData();
      fd.set('id', String(item.id));
      const result = toLegacyResult(await archiveAction(fd));
      if ('ok' in result) {
        toast.success('Lookup archived');
        onLocalArchive();
        onChanged();
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <div className="flex min-h-14 items-center gap-2 py-2">
      {editing ? (
        <>
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') save();
              if (e.key === 'Escape') {
                setLabel(item.label);
                setEditing(false);
              }
            }}
            className={`${inputClass} flex-1`}
            maxLength={120}
            autoFocus
          />
          <button type="button" onClick={save} disabled={pending} className={buttonClass}>
            Save
          </button>
          <button
            type="button"
            onClick={() => {
              setLabel(item.label);
              setEditing(false);
            }}
            className={buttonClass}
          >
            Cancel
          </button>
        </>
      ) : (
        <>
          <span className="min-w-0 flex-1 truncate text-sm font-medium text-zinc-900">
            {item.label}
          </span>
          <Can capability="lookup:edit">
            <button type="button" onClick={() => setEditing(true)} className={buttonClass}>
              Rename
            </button>
            <button
              type="button"
              onClick={archive}
              disabled={pending}
              aria-label={`Archive ${item.label}`}
              className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs font-bold text-red-700 transition hover:border-red-500 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              x
            </button>
          </Can>
        </>
      )}
    </div>
  );
}
