'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from '@/components/ui/toaster';
import { Field, FieldGroup, Label } from '@/components/catalyst/fieldset';
import { FieldError } from '@/components/catalyst/field-compat';
import { Input } from '@/components/catalyst/input';
import { toLegacyResult } from '@/lib/actions/legacy-result';
import {
  archiveAvailabilityBlock,
  createAvailabilityBlock,
  updateAvailabilityBlock,
} from '@/features/schedule/actions';
import type { AvailabilityBlock, Coach } from '@/features/schedule/queries';
import {
  AVAILABILITY_KINDS,
  availabilityFormSchema,
  type AvailabilityFormValues,
  type AvailabilityKind,
} from './availability-schema';

const KIND_LABELS: Record<AvailabilityKind, string> = {
  statutory_holiday: 'Statutory Holiday',
  company_closure: 'Company Closure',
  coach_unavailable: 'Coach Unavailable',
};

const selectClass =
  'h-9 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm disabled:bg-muted disabled:text-muted-foreground/70';

const buttonClass =
  'rounded-lg border border-border bg-white px-3 py-2 text-xs font-semibold text-foreground transition hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-50';

const submitClass =
  'h-10 rounded-lg bg-primary px-4 text-sm font-semibold text-white transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60';

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
  const [archivedIds, setArchivedIds] = useState<Set<number>>(() => new Set());
  const [overrides, setOverrides] = useState<Record<number, AvailabilityBlock>>({});

  const rows = useMemo(
    () =>
      blocks
        .filter((block) => !archivedIds.has(block.id))
        .map((block) => overrides[block.id] ?? block)
        .sort(
          (a, b) =>
            a.startDate.localeCompare(b.startDate) ||
            a.endDate.localeCompare(b.endDate),
        ),
    [archivedIds, blocks, overrides],
  );

  const grouped = useMemo(() => groupByMonth(rows), [rows]);

  function refresh() {
    router.refresh();
  }

  return (
    <div className="mt-4 flex flex-col gap-5">
      <AvailabilityForm
        mode="create"
        coaches={coaches}
        defaultStartDate={defaultStartDate}
        onSuccess={refresh}
      />

      <div className="max-h-[440px] overflow-y-auto pr-1">
        {grouped.length === 0 ? (
          <div className="rounded-lg bg-muted px-3 py-8 text-center text-sm text-muted-foreground">
            No blocked dates.
          </div>
        ) : (
          <div className="flex flex-col gap-5">
            {grouped.map((group) => (
              <section key={group.month} className="flex flex-col gap-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {group.month}
                </h3>
                <div className="divide-y divide-border rounded-xl border border-border bg-white">
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
  const [pending, startTransition] = useTransition();
  const coachName = block.coachId
    ? coaches.find((coach) => coach.id === block.coachId)?.displayName
    : null;

  function archive() {
    if (!confirm(`Remove ${formatRange(block.startDate, block.endDate)}?`)) return;
    startTransition(async () => {
      const fd = new FormData();
      fd.set('id', String(block.id));
      const result = toLegacyResult(await archiveAvailabilityBlock(fd));
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
      <div className="p-3">
        <AvailabilityForm
          mode="edit"
          block={block}
          coaches={coaches}
          onSuccess={(updated) => {
            onLocalUpdate(updated);
            setEditing(false);
            onChanged();
          }}
          onCancel={() => setEditing(false)}
        />
      </div>
    );
  }

  return (
    <div className="flex items-start gap-3 p-3">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold text-foreground">
            {formatRange(block.startDate, block.endDate)}
          </span>
          <span className="rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-semibold text-status-red">
            {KIND_LABELS[block.kind]}
          </span>
        </div>
        <div className="mt-1 text-xs text-muted-foreground">
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
          className="rounded-lg border border-border bg-white px-3 py-2 text-xs font-bold text-status-red transition hover:border-status-red hover:bg-status-red/10 disabled:cursor-not-allowed disabled:opacity-50"
        >
          x
        </button>
      </div>
    </div>
  );
}

type AvailabilityFormProps =
  | {
      mode: 'create';
      coaches: Coach[];
      defaultStartDate: string;
      onSuccess: (block: AvailabilityBlock) => void;
      onCancel?: undefined;
      block?: undefined;
    }
  | {
      mode: 'edit';
      coaches: Coach[];
      block: AvailabilityBlock;
      onSuccess: (block: AvailabilityBlock) => void;
      onCancel: () => void;
      defaultStartDate?: undefined;
    };

function AvailabilityForm(props: AvailabilityFormProps) {
  const isEdit = props.mode === 'edit';
  const defaultValues: AvailabilityFormValues = useMemo(() => {
    if (isEdit) {
      return {
        startDate: props.block.startDate,
        endDate: props.block.endDate,
        kind: props.block.kind,
        coachId: props.block.coachId ? String(props.block.coachId) : '',
        reason: props.block.reason ?? '',
      };
    }
    return {
      startDate: props.defaultStartDate,
      endDate: '',
      kind: 'company_closure' as AvailabilityKind,
      coachId: '',
      reason: '',
    };
  }, [isEdit, props]);

  const form = useForm<AvailabilityFormValues>({
    resolver: zodResolver(availabilityFormSchema),
    defaultValues,
    mode: 'onTouched',
  });
  const { register, handleSubmit, watch, setValue, reset, formState } = form;
  const { errors, isSubmitting } = formState;
  const kind = watch('kind');

  // Clear coach when kind switches away from coach_unavailable, matching the
  // legacy "disabled select gets cleared" behaviour.
  useEffect(() => {
    if (kind !== 'coach_unavailable') {
      setValue('coachId', '');
    }
  }, [kind, setValue]);

  const onSubmit = handleSubmit(async (values) => {
    const fd = valuesToFormData(values, isEdit ? props.block.id : undefined);
    const action = isEdit ? updateAvailabilityBlock : createAvailabilityBlock;
    const result = toLegacyResult(await action(fd));
    if ('ok' in result) {
      toast.success(isEdit ? 'Date block saved' : 'Date block added');
      const nextBlock: AvailabilityBlock = {
        id: isEdit ? props.block.id : -1,
        startDate: values.startDate,
        endDate: values.endDate && values.endDate.length > 0 ? values.endDate : values.startDate,
        kind: values.kind,
        coachId:
          values.kind === 'coach_unavailable' && values.coachId
            ? Number(values.coachId)
            : null,
        reason: values.reason && values.reason.length > 0 ? values.reason : null,
      };
      props.onSuccess(nextBlock);
      if (!isEdit) reset(defaultValues);
    } else if (result.fieldErrors) {
      for (const [name, messages] of Object.entries(result.fieldErrors)) {
        const msg = messages?.[0];
        if (msg) form.setError(name as keyof AvailabilityFormValues, { type: 'server', message: msg });
      }
    } else {
      toast.error(result.error);
    }
  });

  return (
    <form
      onSubmit={onSubmit}
      className={
        isEdit
          ? 'flex flex-col gap-3'
          : 'rounded-xl border border-border bg-muted p-3'
      }
    >
      <FieldGroup>
        <div className="grid gap-3 md:grid-cols-2">
          <Field>
            <Label htmlFor="avl-start">Start Date</Label>
            <Input
              id="avl-start"
              type="date"
              required
              aria-invalid={!!errors.startDate || undefined}
              {...register('startDate')}
            />
            {errors.startDate && <FieldError>{errors.startDate.message}</FieldError>}
          </Field>
          <Field>
            <Label htmlFor="avl-end">End Date</Label>
            <Input
              id="avl-end"
              type="date"
              aria-invalid={!!errors.endDate || undefined}
              {...register('endDate')}
            />
            {errors.endDate && <FieldError>{errors.endDate.message}</FieldError>}
          </Field>
          <Field>
            <Label htmlFor="avl-kind">Type</Label>
            <select id="avl-kind" className={selectClass} {...register('kind')}>
              {AVAILABILITY_KINDS.map((k) => (
                <option key={k} value={k}>
                  {KIND_LABELS[k]}
                </option>
              ))}
            </select>
            {errors.kind && <FieldError>{errors.kind.message}</FieldError>}
          </Field>
          <Field>
            <Label htmlFor="avl-coach">Coach</Label>
            <select
              id="avl-coach"
              disabled={kind !== 'coach_unavailable'}
              className={selectClass}
              {...register('coachId')}
            >
              <option value="">
                {kind === 'coach_unavailable' ? 'Select coach…' : 'Not applicable'}
              </option>
              {props.coaches.map((coach) => (
                <option key={coach.id} value={coach.id}>
                  {coach.displayName}
                </option>
              ))}
            </select>
            {errors.coachId && <FieldError>{errors.coachId.message}</FieldError>}
          </Field>
        </div>
        <div className="grid gap-3 md:grid-cols-[1fr_auto]">
          <Field>
            <Label htmlFor="avl-reason">Reason</Label>
            <Input
              id="avl-reason"
              type="text"
              maxLength={200}
              placeholder="Holiday, closure, vacation"
              aria-invalid={!!errors.reason || undefined}
              {...register('reason')}
            />
            {errors.reason && <FieldError>{errors.reason.message}</FieldError>}
          </Field>
          <div className="flex items-end gap-2">
            {isEdit && (
              <button type="button" onClick={props.onCancel} className={buttonClass}>
                Cancel
              </button>
            )}
            <button type="submit" disabled={isSubmitting} className={submitClass}>
              {isEdit ? 'Save' : 'Add Block'}
            </button>
          </div>
        </div>
      </FieldGroup>
    </form>
  );
}

function valuesToFormData(values: AvailabilityFormValues, id?: number): FormData {
  const fd = new FormData();
  if (id != null) fd.set('id', String(id));
  fd.set('startDate', values.startDate);
  fd.set('endDate', values.endDate ?? '');
  fd.set('kind', values.kind);
  fd.set(
    'coachId',
    values.kind === 'coach_unavailable' ? values.coachId ?? '' : '',
  );
  fd.set('reason', values.reason ?? '');
  return fd;
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
