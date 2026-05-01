'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from '@/components/ui/toaster';
import {
  archiveAvailabilityBlock,
  createAvailabilityBlock,
  updateAvailabilityBlock,
} from '@/features/schedule/actions';
import type { AvailabilityBlock, Coach } from '@/features/schedule/queries';

type AvailabilityKind = AvailabilityBlock['kind'];

const KIND_LABELS: Record<AvailabilityKind, string> = {
  statutory_holiday: 'Statutory Holiday',
  company_closure: 'Company Closure',
  coach_unavailable: 'Coach Unavailable',
};

const inputClass =
  'min-w-0 rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm text-stone-800 outline-none transition focus:border-accent focus:ring-3 focus:ring-accent/20 disabled:bg-stone-100 disabled:text-stone-400';

const buttonClass =
  'rounded-lg border border-stone-200 bg-white px-3 py-2 text-xs font-semibold text-stone-700 transition hover:border-navy hover:text-navy disabled:cursor-not-allowed disabled:opacity-50';

type Draft = {
  startDate: string;
  endDate: string;
  kind: AvailabilityKind;
  coachId: string;
  reason: string;
};

const emptyDraft: Draft = {
  startDate: '',
  endDate: '',
  kind: 'company_closure',
  coachId: '',
  reason: '',
};

export function AvailabilityAdmin({
  blocks,
  coaches,
  defaultStartDate = '',
}: {
  blocks: AvailabilityBlock[];
  coaches: Coach[];
  defaultStartDate?: string;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<Draft>(() => ({ ...emptyDraft, startDate: defaultStartDate }));
  const [archivedIds, setArchivedIds] = useState<Set<number>>(() => new Set());
  const [overrides, setOverrides] = useState<Record<number, AvailabilityBlock>>({});
  const [pending, startTransition] = useTransition();

  const rows = useMemo(
    () =>
      blocks
        .filter((block) => !archivedIds.has(block.id))
        .map((block) => overrides[block.id] ?? block)
        .sort((a, b) => a.startDate.localeCompare(b.startDate) || a.endDate.localeCompare(b.endDate)),
    [archivedIds, blocks, overrides],
  );

  const grouped = useMemo(() => groupByMonth(rows), [rows]);

  function refresh() {
    router.refresh();
  }

  function onCreate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    startTransition(async () => {
      const fd = draftToFormData(draft);
      const result = await createAvailabilityBlock(fd);
      if ('ok' in result) {
        toast.success('Date block added');
        setDraft({ ...emptyDraft, startDate: defaultStartDate });
        refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <div className="mt-4 flex flex-col gap-5">
      <form onSubmit={onCreate} className="rounded-xl border border-stone-200 bg-stone-50 p-3">
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Start Date" htmlFor="block-start" required>
            <input
              id="block-start"
              type="date"
              value={draft.startDate}
              onChange={(e) => setDraft((d) => ({ ...d, startDate: e.target.value }))}
              className={inputClass}
              required
            />
          </Field>
          <Field label="End Date" htmlFor="block-end">
            <input
              id="block-end"
              type="date"
              value={draft.endDate}
              onChange={(e) => setDraft((d) => ({ ...d, endDate: e.target.value }))}
              className={inputClass}
            />
          </Field>
          <Field label="Type" htmlFor="block-kind">
            <KindSelect
              id="block-kind"
              value={draft.kind}
              onChange={(kind) =>
                setDraft((d) => ({
                  ...d,
                  kind,
                  coachId: kind === 'coach_unavailable' ? d.coachId : '',
                }))
              }
            />
          </Field>
          <Field label="Coach" htmlFor="block-coach">
            <CoachSelect
              id="block-coach"
              coaches={coaches}
              value={draft.coachId}
              disabled={draft.kind !== 'coach_unavailable'}
              onChange={(coachId) => setDraft((d) => ({ ...d, coachId }))}
            />
          </Field>
        </div>
        <div className="mt-3 grid gap-3 md:grid-cols-[1fr_auto]">
          <Field label="Reason" htmlFor="block-reason">
            <input
              id="block-reason"
              type="text"
              value={draft.reason}
              onChange={(e) => setDraft((d) => ({ ...d, reason: e.target.value }))}
              className={inputClass}
              maxLength={200}
              placeholder="Holiday, closure, vacation"
            />
          </Field>
          <div className="flex items-end">
            <button
              type="submit"
              disabled={pending}
              className="h-10 rounded-lg bg-navy px-4 text-sm font-semibold text-white transition hover:bg-navy-light disabled:cursor-not-allowed disabled:opacity-60"
            >
              Add Block
            </button>
          </div>
        </div>
      </form>

      <div className="max-h-[440px] overflow-y-auto pr-1">
        {grouped.length === 0 ? (
          <div className="rounded-lg bg-stone-50 px-3 py-8 text-center text-sm text-stone-500">
            No blocked dates.
          </div>
        ) : (
          <div className="flex flex-col gap-5">
            {grouped.map((group) => (
              <section key={group.month} className="flex flex-col gap-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-stone-500">
                  {group.month}
                </h3>
                <div className="divide-y divide-stone-100 rounded-xl border border-stone-200 bg-white">
                  {group.blocks.map((block) => (
                    <AvailabilityRow
                      key={`${block.id}:${block.startDate}:${block.endDate}:${block.kind}:${block.reason ?? ''}`}
                      block={block}
                      coaches={coaches}
                      onChanged={refresh}
                      onLocalUpdate={(next) =>
                        setOverrides((current) => ({ ...current, [next.id]: next }))
                      }
                      onLocalArchive={() =>
                        setArchivedIds((current) => new Set(current).add(block.id))
                      }
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function AvailabilityRow({
  block,
  coaches,
  onChanged,
  onLocalUpdate,
  onLocalArchive,
}: {
  block: AvailabilityBlock;
  coaches: Coach[];
  onChanged: () => void;
  onLocalUpdate: (block: AvailabilityBlock) => void;
  onLocalArchive: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Draft>(() => blockToDraft(block));
  const [pending, startTransition] = useTransition();
  const coachName = block.coachId
    ? coaches.find((coach) => coach.id === block.coachId)?.displayName
    : null;

  function save() {
    startTransition(async () => {
      const fd = draftToFormData(draft);
      fd.set('id', String(block.id));
      const result = await updateAvailabilityBlock(fd);
      if ('ok' in result) {
        toast.success('Date block saved');
        const next = formDraftToBlock(block.id, draft);
        onLocalUpdate(next);
        setDraft(blockToDraft(next));
        setEditing(false);
        onChanged();
      } else {
        toast.error(result.error);
      }
    });
  }

  function archive() {
    if (!confirm(`Remove ${formatRange(block.startDate, block.endDate)}?`)) return;
    startTransition(async () => {
      const fd = new FormData();
      fd.set('id', String(block.id));
      const result = await archiveAvailabilityBlock(fd);
      if ('ok' in result) {
        toast.success('Date block removed');
        onLocalArchive();
        onChanged();
      } else {
        toast.error(result.error);
      }
    });
  }

  if (editing) {
    return (
      <div className="grid gap-2 p-3">
        <div className="grid gap-2 md:grid-cols-2">
          <input
            type="date"
            value={draft.startDate}
            onChange={(e) => setDraft((d) => ({ ...d, startDate: e.target.value }))}
            className={inputClass}
          />
          <input
            type="date"
            value={draft.endDate}
            onChange={(e) => setDraft((d) => ({ ...d, endDate: e.target.value }))}
            className={inputClass}
          />
          <KindSelect
            value={draft.kind}
            onChange={(kind) =>
              setDraft((d) => ({
                ...d,
                kind,
                coachId: kind === 'coach_unavailable' ? d.coachId : '',
              }))
            }
          />
          <CoachSelect
            coaches={coaches}
            value={draft.coachId}
            disabled={draft.kind !== 'coach_unavailable'}
            onChange={(coachId) => setDraft((d) => ({ ...d, coachId }))}
          />
        </div>
        <input
          type="text"
          value={draft.reason}
          onChange={(e) => setDraft((d) => ({ ...d, reason: e.target.value }))}
          className={inputClass}
          maxLength={200}
          placeholder="Reason"
        />
        <div className="flex justify-end gap-2">
          <button type="button" onClick={save} disabled={pending} className={buttonClass}>
            Save
          </button>
          <button
            type="button"
            onClick={() => {
              setDraft(blockToDraft(block));
              setEditing(false);
            }}
            className={buttonClass}
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-start gap-3 p-3">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold text-stone-800">
            {formatRange(block.startDate, block.endDate)}
          </span>
          <span className="rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-semibold text-status-red">
            {KIND_LABELS[block.kind]}
          </span>
        </div>
        <div className="mt-1 text-xs text-stone-600">
          {block.reason || 'Blocked'}
          {coachName ? ` · ${coachName}` : ''}
        </div>
      </div>
      <div className="flex shrink-0 gap-1">
        <button type="button" onClick={() => setEditing(true)} className={buttonClass}>
          Edit
        </button>
        <button
          type="button"
          onClick={archive}
          disabled={pending}
          aria-label={`Remove ${formatRange(block.startDate, block.endDate)}`}
          className="rounded-lg border border-stone-200 bg-white px-3 py-2 text-xs font-bold text-status-red transition hover:border-status-red hover:bg-status-red/10 disabled:cursor-not-allowed disabled:opacity-50"
        >
          x
        </button>
      </div>
    </div>
  );
}

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

function KindSelect({
  id,
  value,
  onChange,
}: {
  id?: string;
  value: AvailabilityKind;
  onChange: (value: AvailabilityKind) => void;
}) {
  return (
    <select
      id={id}
      value={value}
      onChange={(e) => onChange(e.target.value as AvailabilityKind)}
      className={inputClass}
    >
      {Object.entries(KIND_LABELS).map(([value, label]) => (
        <option key={value} value={value}>
          {label}
        </option>
      ))}
    </select>
  );
}

function CoachSelect({
  id,
  coaches,
  value,
  disabled,
  onChange,
}: {
  id?: string;
  coaches: Coach[];
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <select
      id={id}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      className={inputClass}
    >
      <option value="">{disabled ? 'Not applicable' : 'Select coach...'}</option>
      {coaches.map((coach) => (
        <option key={coach.id} value={coach.id}>
          {coach.displayName}
        </option>
      ))}
    </select>
  );
}

function draftToFormData(draft: Draft) {
  const fd = new FormData();
  fd.set('startDate', draft.startDate);
  fd.set('endDate', draft.endDate || draft.startDate);
  fd.set('kind', draft.kind);
  fd.set('coachId', draft.kind === 'coach_unavailable' ? draft.coachId : '');
  fd.set('reason', draft.reason);
  return fd;
}

function blockToDraft(block: AvailabilityBlock): Draft {
  return {
    startDate: block.startDate,
    endDate: block.endDate,
    kind: block.kind,
    coachId: block.coachId ? String(block.coachId) : '',
    reason: block.reason ?? '',
  };
}

function formDraftToBlock(id: number, draft: Draft): AvailabilityBlock {
  return {
    id,
    startDate: draft.startDate,
    endDate: draft.endDate || draft.startDate,
    kind: draft.kind,
    coachId: draft.kind === 'coach_unavailable' && draft.coachId ? Number(draft.coachId) : null,
    reason: draft.reason || null,
  };
}

function groupByMonth(blocks: AvailabilityBlock[]) {
  const groups = new Map<string, AvailabilityBlock[]>();
  for (const block of blocks) {
    const month = monthLabel(block.startDate);
    groups.set(month, [...(groups.get(month) ?? []), block]);
  }
  return Array.from(groups, ([month, blocks]) => ({ month, blocks }));
}

function monthLabel(iso: string) {
  const date = new Date(`${iso}T12:00:00`);
  return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

function formatRange(start: string, end: string) {
  if (start === end) return formatDate(start);
  return `${formatDate(start)} to ${formatDate(end)}`;
}

function formatDate(iso: string) {
  const date = new Date(`${iso}T12:00:00`);
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
