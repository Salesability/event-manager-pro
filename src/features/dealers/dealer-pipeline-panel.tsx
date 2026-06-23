'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Field, FieldGroup, Label } from '@/components/catalyst/fieldset';
import { FieldError } from '@/components/catalyst/field-compat';
import { Button } from '@/components/catalyst/button';
import { Input } from '@/components/catalyst/input';
import { Textarea } from '@/components/catalyst/textarea';
import { PipelineStageBadge, PriorityBadge } from '@/components/app/status-badge';
import { toast } from '@/components/ui/toaster';
import { toLegacyResult } from '@/lib/actions/legacy-result';
import {
  convertProspectToActive,
  logDealerActivity,
  setDealerPipeline,
} from '@/features/schedule/actions';
import type { Coach, Dealer, DealerActivity } from '@/features/schedule/queries';
import {
  ACTIVITY_KIND_LABELS,
  ACTIVITY_KINDS,
  DEALER_PRIORITIES,
  DEALER_PRIORITY_LABELS,
  isIdle,
  isOverdue,
  matchesDueBucket,
  PIPELINE_STAGE_LABELS,
  PIPELINE_STAGES,
} from './pipeline';
import {
  dealerPipelineSchema,
  type DealerPipelineValues,
  logActivitySchema,
  type LogActivityValues,
} from './pipeline-schema';

// Native <select> styling lifted from dealer-form.tsx (shadcn <Select> is a Base
// UI dropdown — overkill for short option lists).
const SELECT_CLASS =
  'h-8 w-full min-w-0 rounded-lg border border-zinc-300 bg-transparent px-2.5 py-1 text-sm outline-none focus-visible:border-zinc-400 focus-visible:ring-3 focus-visible:ring-zinc-400/50 md:text-sm';

// Small text-link toggles (Edit / Cancel / disclosure) — an intentional raw
// exception to the Button consolidation (0081 decision: field-label text links).
const LINK_BTN =
  'text-xs font-medium text-brand-700 underline-offset-2 hover:text-brand-800 hover:underline';

function fmtDate(value: string | Date | null): string {
  if (!value) return '—';
  const d = typeof value === 'string' ? new Date(`${value}T12:00:00`) : value;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// Relative "x days ago" for last-contacted / activity timestamps. Coarse by
// design — the panel is a glanceable commitment view, not an audit log.
function fmtRelative(d: Date): string {
  const days = Math.round((Date.now() - d.getTime()) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  if (days < 60) return 'a month ago';
  return `${Math.round(days / 30)} months ago`;
}

// A YYYY-MM-DD string in local time — for date-input defaults AND the due-bucket
// comparison (same convention as the /dealerships queue's todayIso).
function todayInputValue(): string {
  const now = new Date();
  const tzAdjusted = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return tzAdjusted.toISOString().slice(0, 10);
}

// Due-date chip — overdue loud (matches the commitment-queue column styling),
// due-today amber, otherwise quiet.
function DueChip({ due, todayIso }: { due: string; todayIso: string }) {
  const overdue = isOverdue(due, todayIso);
  const today = matchesDueBucket(due, todayIso, 'today');
  const cls = overdue
    ? 'inline-flex items-center gap-1 rounded-md bg-red-50 px-1.5 py-0.5 text-xs font-semibold text-red-700'
    : today
      ? 'inline-flex items-center gap-1 rounded-md bg-amber-50 px-1.5 py-0.5 text-xs font-semibold text-amber-700'
      : 'inline-flex items-center gap-1 text-xs font-medium text-zinc-600';
  return (
    <span className={cls}>
      {overdue && <span aria-hidden>⚠</span>}
      {overdue ? 'Overdue · ' : today ? 'Due today · ' : 'Due '}
      {fmtDate(due)}
    </span>
  );
}

export function DealerPipelinePanel({
  dealer,
  coaches,
  activities,
}: {
  dealer: Dealer;
  coaches: Coach[];
  activities: DealerActivity[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  // Hero interaction state: the commitment block shows ONE of view / done / edit
  // at a time (no duplicate next-action field). Idle dealers render the "set
  // commitment" form directly, independent of this.
  const [heroMode, setHeroMode] = useState<'view' | 'done' | 'edit'>('view');
  const [editDetails, setEditDetails] = useState(false);
  const [showLog, setShowLog] = useState(false);

  const todayIso = todayInputValue();

  // Won leaves the funnel — an active dealer's pipeline is read-only history.
  const locked = dealer.status === 'active';
  const idle = isIdle(dealer.nextAction);

  // Owner picklist = coaches WITH an auth-user link (owner_id FKs auth.users).
  const ownerOptions = coaches.filter((c) => c.userId);
  // If the current owner isn't in the picklist (archived coach / widened source),
  // keep it selectable so saving doesn't silently drop it.
  const currentOwnerMissing =
    dealer.ownerId != null && !ownerOptions.some((c) => c.userId === dealer.ownerId);

  // "Done" — completes the current commitment: record a touch (kind + optional
  // note), stamp last_contacted, and advance to the next promise in ONE submit.
  const doneForm = useForm<LogActivityValues>({
    resolver: zodResolver(logActivitySchema),
    defaultValues: { kind: 'call', note: '', occurredAt: '', nextAction: '', nextActionAt: '' },
    mode: 'onTouched',
  });

  // The single next-action input — used for both "set when idle" and "edit the
  // current commitment". Reuses setDealerPipeline (no touch — making a plan isn't
  // a contact).
  const nextForm = useForm<DealerPipelineValues>({
    resolver: zodResolver(dealerPipelineSchema),
    defaultValues: {
      nextAction: dealer.nextAction ?? '',
      nextActionAt: dealer.nextActionAt ?? '',
    },
    mode: 'onTouched',
  });

  // Compact stage / priority / owner editor (de-emphasized — they change rarely).
  const detailsForm = useForm<DealerPipelineValues>({
    resolver: zodResolver(dealerPipelineSchema),
    defaultValues: {
      stage: dealer.pipelineStage ?? 'new',
      priority: dealer.priority ?? '',
      ownerId: dealer.ownerId ?? '',
    },
    mode: 'onTouched',
  });

  // Escape hatch — a past/rich touch that does NOT advance the commitment.
  const logForm = useForm<LogActivityValues>({
    resolver: zodResolver(logActivitySchema),
    defaultValues: { kind: 'call', note: '', occurredAt: todayInputValue() },
    mode: 'onTouched',
  });

  function submitDone(values: LogActivityValues) {
    startTransition(async () => {
      const fd = new FormData();
      fd.set('id', String(dealer.id));
      fd.set('kind', values.kind);
      fd.set('note', values.note ?? '');
      // Always send the next-promise pair so completing the commitment either
      // replaces it (rep typed the next one) or clears it (left blank → null).
      fd.set('nextAction', values.nextAction ?? '');
      fd.set('nextActionAt', values.nextActionAt ?? '');
      const result = toLegacyResult(await logDealerActivity(fd));
      if ('ok' in result) {
        toast.success('Marked done');
        doneForm.reset({ kind: 'call', note: '', occurredAt: '', nextAction: '', nextActionAt: '' });
        setHeroMode('view');
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  function submitNextAction(values: DealerPipelineValues) {
    startTransition(async () => {
      const fd = new FormData();
      fd.set('id', String(dealer.id));
      // Only the commitment fields — stage/priority/owner omitted so they're
      // preserved by setDealerPipeline's omit-when-absent patch.
      fd.set('nextAction', values.nextAction ?? '');
      fd.set('nextActionAt', values.nextActionAt ?? '');
      const result = toLegacyResult(await setDealerPipeline(fd));
      if ('ok' in result) {
        toast.success('Commitment saved');
        setHeroMode('view');
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  function submitDetails(values: DealerPipelineValues) {
    startTransition(async () => {
      const fd = new FormData();
      fd.set('id', String(dealer.id));
      fd.set('stage', values.stage ?? '');
      fd.set('priority', values.priority ?? '');
      fd.set('ownerId', values.ownerId ?? '');
      // next-action omitted → the commitment is preserved.
      const result = toLegacyResult(await setDealerPipeline(fd));
      if ('ok' in result) {
        toast.success('Pipeline updated');
        setEditDetails(false);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  function submitLog(values: LogActivityValues) {
    startTransition(async () => {
      const fd = new FormData();
      fd.set('id', String(dealer.id));
      fd.set('kind', values.kind);
      fd.set('note', values.note ?? '');
      if (values.occurredAt) fd.set('occurredAt', values.occurredAt);
      // Deliberately omit nextAction/nextActionAt — a past touch never clobbers
      // the live commitment.
      const result = toLegacyResult(await logDealerActivity(fd));
      if ('ok' in result) {
        toast.success('Activity logged');
        logForm.reset({ kind: 'call', note: '', occurredAt: todayInputValue() });
        setShowLog(false);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  function markWon() {
    startTransition(async () => {
      const fd = new FormData();
      fd.set('id', String(dealer.id));
      const result = toLegacyResult(await convertProspectToActive(fd));
      if ('ok' in result) {
        toast.success('Marked won — dealer is now active');
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  if (locked) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-zinc-500">
          This dealer is <span className="font-medium text-zinc-700">active</span> — prospecting is
          complete. The activity history below is read-only.
        </p>
        <RecentActivity activities={activities} />
      </div>
    );
  }

  const doneErrors = doneForm.formState.errors;
  const nextErrors = nextForm.formState.errors;
  const logErrors = logForm.formState.errors;

  return (
    <div className="space-y-6">
      {/* ---- Next-action hero --------------------------------------------- */}
      <section className="rounded-xl border border-brand-200 bg-brand-50/60 p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-brand-700">
          Next commitment
        </p>

        {idle ? (
          // No commitment owed — prompt the rep to make one.
          <form
            onSubmit={nextForm.handleSubmit(submitNextAction)}
            className="mt-2 flex flex-col gap-3"
          >
            <p className="text-sm text-brand-900/80">
              Nothing promised yet — what do you owe them next?
            </p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_max-content]">
              <Field>
                <Label htmlFor="next-action" className="sr-only">
                  Next action
                </Label>
                <Input
                  id="next-action"
                  type="text"
                  maxLength={500}
                  placeholder="Call Tuesday / send pricing"
                  aria-invalid={!!nextErrors.nextAction || undefined}
                  {...nextForm.register('nextAction')}
                />
                {nextErrors.nextAction && <FieldError>{nextErrors.nextAction.message}</FieldError>}
              </Field>
              <Field>
                <Label htmlFor="next-action-at" className="sr-only">
                  Due
                </Label>
                <Input id="next-action-at" type="date" {...nextForm.register('nextActionAt')} />
              </Field>
            </div>
            <div className="flex justify-end">
              <Button type="submit" color="brand" compact disabled={pending}>
                {pending ? 'Saving…' : 'Set commitment'}
              </Button>
            </div>
          </form>
        ) : heroMode === 'view' ? (
          // The commitment is the hero — show it loud with Done + Edit.
          <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-base font-semibold break-words text-brand-950">
                {dealer.nextAction}
              </p>
              {dealer.nextActionAt && (
                <p className="mt-1">
                  <DueChip due={dealer.nextActionAt} todayIso={todayIso} />
                </p>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-3">
              <button type="button" className={LINK_BTN} onClick={() => setHeroMode('edit')}>
                Edit
              </button>
              <Button type="button" color="brand" compact onClick={() => setHeroMode('done')}>
                Done
              </Button>
            </div>
          </div>
        ) : heroMode === 'edit' ? (
          // Re-word / re-schedule the promise — no touch logged.
          <form
            onSubmit={nextForm.handleSubmit(submitNextAction)}
            className="mt-2 flex flex-col gap-3"
          >
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_max-content]">
              <Field>
                <Label htmlFor="edit-action">Next action</Label>
                <Input
                  id="edit-action"
                  type="text"
                  maxLength={500}
                  placeholder="Call Tuesday / send pricing"
                  aria-invalid={!!nextErrors.nextAction || undefined}
                  {...nextForm.register('nextAction')}
                />
                {nextErrors.nextAction && <FieldError>{nextErrors.nextAction.message}</FieldError>}
              </Field>
              <Field>
                <Label htmlFor="edit-action-at">Due</Label>
                <Input id="edit-action-at" type="date" {...nextForm.register('nextActionAt')} />
              </Field>
            </div>
            <div className="flex items-center justify-end gap-3">
              <button
                type="button"
                className={LINK_BTN}
                onClick={() => {
                  nextForm.reset({
                    nextAction: dealer.nextAction ?? '',
                    nextActionAt: dealer.nextActionAt ?? '',
                  });
                  setHeroMode('view');
                }}
              >
                Cancel
              </button>
              <Button type="submit" color="brand" compact disabled={pending}>
                {pending ? 'Saving…' : 'Save'}
              </Button>
            </div>
          </form>
        ) : (
          // Done flow — record the touch + set the next promise in one submit.
          <form
            onSubmit={doneForm.handleSubmit(submitDone)}
            className="mt-2 flex flex-col gap-3"
          >
            <p className="text-sm text-brand-900/80">
              Mark <span className="font-medium text-brand-950">“{dealer.nextAction}”</span> done.
            </p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-[max-content_1fr] sm:items-end">
              <Field className="sm:w-40">
                <Label htmlFor="done-kind">How?</Label>
                <select id="done-kind" className={SELECT_CLASS} {...doneForm.register('kind')}>
                  {ACTIVITY_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {ACTIVITY_KIND_LABELS[k]}
                    </option>
                  ))}
                </select>
              </Field>
              <Field>
                <Label htmlFor="done-note">Note (optional)</Label>
                <Input
                  id="done-note"
                  type="text"
                  maxLength={2000}
                  placeholder="What happened?"
                  aria-invalid={!!doneErrors.note || undefined}
                  {...doneForm.register('note')}
                />
                {doneErrors.note && <FieldError>{doneErrors.note.message}</FieldError>}
              </Field>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_max-content]">
              <Field>
                <Label htmlFor="done-next">Next commitment</Label>
                <Input
                  id="done-next"
                  type="text"
                  maxLength={500}
                  placeholder="The next promise (optional)"
                  aria-invalid={!!doneErrors.nextAction || undefined}
                  {...doneForm.register('nextAction')}
                />
                {doneErrors.nextAction && <FieldError>{doneErrors.nextAction.message}</FieldError>}
              </Field>
              <Field>
                <Label htmlFor="done-next-at">Due</Label>
                <Input id="done-next-at" type="date" {...doneForm.register('nextActionAt')} />
              </Field>
            </div>
            <div className="flex items-center justify-end gap-3">
              <button
                type="button"
                className={LINK_BTN}
                onClick={() => {
                  doneForm.reset({
                    kind: 'call',
                    note: '',
                    occurredAt: '',
                    nextAction: '',
                    nextActionAt: '',
                  });
                  setHeroMode('view');
                }}
              >
                Cancel
              </button>
              <Button type="submit" color="brand" compact disabled={pending}>
                {pending ? 'Saving…' : 'Mark done'}
              </Button>
            </div>
          </form>
        )}
      </section>

      {/* ---- Compact metadata row (stage / priority / owner) -------------- */}
      <section>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium uppercase tracking-wide text-zinc-400">Stage</span>
            {dealer.pipelineStage ? <PipelineStageBadge stage={dealer.pipelineStage} /> : '—'}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium uppercase tracking-wide text-zinc-400">
              Priority
            </span>
            {dealer.priority ? <PriorityBadge priority={dealer.priority} /> : <span>—</span>}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium uppercase tracking-wide text-zinc-400">Owner</span>
            <span className="text-zinc-900">{dealer.ownerName ?? 'Unassigned'}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium uppercase tracking-wide text-zinc-400">
              Last contacted
            </span>
            <span className="text-zinc-900">
              {dealer.lastContactedAt ? fmtRelative(dealer.lastContactedAt) : 'never'}
            </span>
          </div>
          {!editDetails && (
            <button
              type="button"
              className={`${LINK_BTN} ml-auto`}
              onClick={() => setEditDetails(true)}
            >
              Edit details
            </button>
          )}
        </div>

        {editDetails && (
          <form
            onSubmit={detailsForm.handleSubmit(submitDetails)}
            className="mt-3 flex flex-col gap-3 rounded-lg border border-zinc-200 bg-zinc-50/60 p-3"
          >
            <FieldGroup>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <Field>
                  <Label htmlFor="pl-stage">Stage</Label>
                  <select id="pl-stage" className={SELECT_CLASS} {...detailsForm.register('stage')}>
                    {PIPELINE_STAGES.map((s) => (
                      <option key={s} value={s}>
                        {PIPELINE_STAGE_LABELS[s]}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field>
                  <Label htmlFor="pl-priority">Priority</Label>
                  <select
                    id="pl-priority"
                    className={SELECT_CLASS}
                    {...detailsForm.register('priority')}
                  >
                    <option value="">— None —</option>
                    {DEALER_PRIORITIES.map((p) => (
                      <option key={p} value={p}>
                        {DEALER_PRIORITY_LABELS[p]}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field>
                  <Label htmlFor="pl-owner">Owner</Label>
                  <select
                    id="pl-owner"
                    className={SELECT_CLASS}
                    {...detailsForm.register('ownerId')}
                  >
                    <option value="">— Unassigned —</option>
                    {currentOwnerMissing && dealer.ownerId && (
                      <option value={dealer.ownerId}>{dealer.ownerName ?? 'Current owner'}</option>
                    )}
                    {ownerOptions.map((c) => (
                      <option key={c.userId!} value={c.userId!}>
                        {c.displayName}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
            </FieldGroup>
            <div className="flex items-center justify-end gap-3">
              <button
                type="button"
                className={LINK_BTN}
                onClick={() => {
                  detailsForm.reset({
                    stage: dealer.pipelineStage ?? 'new',
                    priority: dealer.priority ?? '',
                    ownerId: dealer.ownerId ?? '',
                  });
                  setEditDetails(false);
                }}
              >
                Cancel
              </button>
              <Button type="submit" color="brand" compact disabled={pending}>
                {pending ? 'Saving…' : 'Save'}
              </Button>
            </div>
          </form>
        )}
      </section>

      {/* ---- Recent activity --------------------------------------------- */}
      <div className="border-t border-zinc-100 pt-5">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
            Recent activity
          </h3>
          {!showLog && (
            <button type="button" className={LINK_BTN} onClick={() => setShowLog(true)}>
              + Log a past touch
            </button>
          )}
        </div>

        {showLog && (
          <form
            onSubmit={logForm.handleSubmit(submitLog)}
            className="mb-4 flex flex-col gap-3 rounded-lg border border-zinc-200 bg-zinc-50/60 p-3"
          >
            <p className="text-xs text-zinc-500">
              Record an after-the-fact or detailed touch. This won’t change the next commitment.
            </p>
            <FieldGroup>
              <div className="grid grid-cols-2 gap-3 sm:flex sm:flex-wrap sm:items-end">
                <Field className="sm:w-40">
                  <Label htmlFor="log-kind">Type</Label>
                  <select id="log-kind" className={SELECT_CLASS} {...logForm.register('kind')}>
                    {ACTIVITY_KINDS.map((k) => (
                      <option key={k} value={k}>
                        {ACTIVITY_KIND_LABELS[k]}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field className="sm:w-48">
                  <Label htmlFor="log-when">When</Label>
                  <Input id="log-when" type="date" {...logForm.register('occurredAt')} />
                </Field>
              </div>
              <Field>
                <Label htmlFor="log-note">Note</Label>
                <Textarea
                  id="log-note"
                  rows={2}
                  maxLength={2000}
                  placeholder="What happened?"
                  aria-invalid={!!logErrors.note || undefined}
                  {...logForm.register('note')}
                />
                {logErrors.note && <FieldError>{logErrors.note.message}</FieldError>}
              </Field>
            </FieldGroup>
            <div className="flex items-center justify-end gap-3">
              <button
                type="button"
                className={LINK_BTN}
                onClick={() => {
                  logForm.reset({ kind: 'call', note: '', occurredAt: todayInputValue() });
                  setShowLog(false);
                }}
              >
                Cancel
              </button>
              <Button type="submit" outline compact disabled={pending}>
                {pending ? 'Logging…' : 'Log touch'}
              </Button>
            </div>
          </form>
        )}

        <RecentActivity activities={activities} />
      </div>

      {/* ---- Won (prospect → active) ------------------------------------- */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-zinc-100 pt-5">
        <p className="text-sm text-zinc-500">
          Closed the deal? Marking won activates the dealer and creates its QuickBooks customer.
        </p>
        <Button type="button" color="brand" onClick={markWon} disabled={pending}>
          Mark won
        </Button>
      </div>
    </div>
  );
}

function RecentActivity({ activities }: { activities: DealerActivity[] }) {
  if (activities.length === 0) {
    return <p className="text-sm text-zinc-400">No activity logged yet.</p>;
  }
  return (
    <ul className="flex flex-col gap-3">
      {activities.map((a) => (
        <li key={a.id} className="flex gap-3 text-sm">
          <span className="mt-0.5 shrink-0 rounded-md bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-600">
            {ACTIVITY_KIND_LABELS[a.kind]}
          </span>
          <div className="min-w-0">
            {a.note && <p className="text-zinc-900">{a.note}</p>}
            <p className="text-xs text-zinc-400">
              {fmtRelative(a.occurredAt)}
              {a.actorName && <> · {a.actorName}</>}
            </p>
          </div>
        </li>
      ))}
    </ul>
  );
}
