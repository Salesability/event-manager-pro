'use client';

import { useTransition } from 'react';
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

// A YYYY-MM-DD string in local time for date-input defaults.
function todayInputValue(): string {
  const now = new Date();
  const tzAdjusted = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return tzAdjusted.toISOString().slice(0, 10);
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

  // Won leaves the funnel — an active dealer's pipeline is read-only history.
  const locked = dealer.status === 'active';

  // Owner picklist = coaches WITH an auth-user link (owner_id FKs auth.users).
  const ownerOptions = coaches.filter((c) => c.userId);
  // If the current owner isn't in the picklist (archived coach / widened source),
  // keep it selectable so saving doesn't silently drop it.
  const currentOwnerMissing =
    dealer.ownerId != null && !ownerOptions.some((c) => c.userId === dealer.ownerId);

  const pipelineForm = useForm<DealerPipelineValues>({
    resolver: zodResolver(dealerPipelineSchema),
    defaultValues: {
      stage: dealer.pipelineStage ?? 'new',
      priority: dealer.priority ?? '',
      ownerId: dealer.ownerId ?? '',
      nextAction: dealer.nextAction ?? '',
      nextActionAt: dealer.nextActionAt ?? '',
    },
    mode: 'onTouched',
  });

  const activityForm = useForm<LogActivityValues>({
    resolver: zodResolver(logActivitySchema),
    defaultValues: {
      kind: 'call',
      note: '',
      occurredAt: todayInputValue(),
      nextAction: '',
      nextActionAt: '',
    },
    mode: 'onTouched',
  });

  function savePipeline(values: DealerPipelineValues) {
    startTransition(async () => {
      const fd = new FormData();
      fd.set('id', String(dealer.id));
      fd.set('stage', values.stage ?? '');
      fd.set('priority', values.priority ?? '');
      fd.set('ownerId', values.ownerId ?? '');
      fd.set('nextAction', values.nextAction ?? '');
      fd.set('nextActionAt', values.nextActionAt ?? '');
      const result = toLegacyResult(await setDealerPipeline(fd));
      if ('ok' in result) {
        toast.success('Pipeline updated');
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  function logActivity(values: LogActivityValues) {
    startTransition(async () => {
      const fd = new FormData();
      fd.set('id', String(dealer.id));
      fd.set('kind', values.kind);
      fd.set('note', values.note ?? '');
      if (values.occurredAt) fd.set('occurredAt', values.occurredAt);
      // Only send the next-promise fields when the rep filled them in, so an
      // empty pair doesn't clear an existing commitment.
      if (values.nextAction) fd.set('nextAction', values.nextAction);
      if (values.nextActionAt) fd.set('nextActionAt', values.nextActionAt);
      const result = toLegacyResult(await logDealerActivity(fd));
      if ('ok' in result) {
        toast.success('Activity logged');
        activityForm.reset({
          kind: 'call',
          note: '',
          occurredAt: todayInputValue(),
          nextAction: '',
          nextActionAt: '',
        });
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

  const pErrors = pipelineForm.formState.errors;
  const aErrors = activityForm.formState.errors;

  return (
    <div className="space-y-6">
      {/* Commitment summary */}
      <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-xs font-medium uppercase tracking-wide text-zinc-400">Stage</dt>
          <dd className="mt-1">
            {dealer.pipelineStage ? <PipelineStageBadge stage={dealer.pipelineStage} /> : '—'}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-medium uppercase tracking-wide text-zinc-400">Priority</dt>
          <dd className="mt-1">
            {dealer.priority ? <PriorityBadge priority={dealer.priority} /> : '—'}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-medium uppercase tracking-wide text-zinc-400">Owner</dt>
          <dd className="mt-1 text-zinc-900">{dealer.ownerName ?? '—'}</dd>
        </div>
        <div>
          <dt className="text-xs font-medium uppercase tracking-wide text-zinc-400">
            Last contacted
          </dt>
          <dd className="mt-1 text-zinc-900">
            {dealer.lastContactedAt ? fmtRelative(dealer.lastContactedAt) : 'never'}
          </dd>
        </div>
      </dl>

      {dealer.nextAction && (
        <p className="rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 text-sm text-brand-900">
          <span className="font-semibold">Next:</span> {dealer.nextAction}
          {dealer.nextActionAt && (
            <span className="text-brand-700"> · due {fmtDate(dealer.nextActionAt)}</span>
          )}
        </p>
      )}

      {/* Pipeline editor */}
      <form onSubmit={pipelineForm.handleSubmit(savePipeline)} className="flex flex-col gap-3">
        <FieldGroup>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Field>
              <Label htmlFor="pl-stage">Stage</Label>
              <select id="pl-stage" className={SELECT_CLASS} {...pipelineForm.register('stage')}>
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
                {...pipelineForm.register('priority')}
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
              <select id="pl-owner" className={SELECT_CLASS} {...pipelineForm.register('ownerId')}>
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

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_max-content]">
            <Field>
              <Label htmlFor="pl-nextAction">Next action</Label>
              <Input
                id="pl-nextAction"
                type="text"
                maxLength={500}
                placeholder="Call Tuesday / send pricing"
                aria-invalid={!!pErrors.nextAction || undefined}
                {...pipelineForm.register('nextAction')}
              />
              {pErrors.nextAction && <FieldError>{pErrors.nextAction.message}</FieldError>}
            </Field>
            <Field>
              <Label htmlFor="pl-nextActionAt">Due</Label>
              <Input id="pl-nextActionAt" type="date" {...pipelineForm.register('nextActionAt')} />
            </Field>
          </div>
        </FieldGroup>
        <div className="flex justify-end">
          <Button type="submit" color="brand" compact disabled={pending}>
            {pending ? 'Saving…' : 'Save pipeline'}
          </Button>
        </div>
      </form>

      {/* Log activity */}
      <div className="border-t border-zinc-100 pt-5">
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-500">
          Log activity
        </h3>
        <form onSubmit={activityForm.handleSubmit(logActivity)} className="flex flex-col gap-3">
          <FieldGroup>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-[max-content_1fr]">
              <Field>
                <Label htmlFor="ac-kind">Type</Label>
                <select id="ac-kind" className={SELECT_CLASS} {...activityForm.register('kind')}>
                  {ACTIVITY_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {ACTIVITY_KIND_LABELS[k]}
                    </option>
                  ))}
                </select>
              </Field>
              <Field>
                <Label htmlFor="ac-occurredAt">When</Label>
                <Input id="ac-occurredAt" type="date" {...activityForm.register('occurredAt')} />
              </Field>
            </div>
            <Field>
              <Label htmlFor="ac-note">Note</Label>
              <Textarea
                id="ac-note"
                rows={2}
                maxLength={2000}
                placeholder="What happened?"
                aria-invalid={!!aErrors.note || undefined}
                {...activityForm.register('note')}
              />
              {aErrors.note && <FieldError>{aErrors.note.message}</FieldError>}
            </Field>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_max-content]">
              <Field>
                <Label htmlFor="ac-nextAction">Set next action (optional)</Label>
                <Input
                  id="ac-nextAction"
                  type="text"
                  maxLength={500}
                  placeholder="The next promise"
                  {...activityForm.register('nextAction')}
                />
              </Field>
              <Field>
                <Label htmlFor="ac-nextActionAt">Due</Label>
                <Input
                  id="ac-nextActionAt"
                  type="date"
                  {...activityForm.register('nextActionAt')}
                />
              </Field>
            </div>
          </FieldGroup>
          <div className="flex justify-end">
            <Button type="submit" outline compact disabled={pending}>
              {pending ? 'Logging…' : 'Log activity'}
            </Button>
          </div>
        </form>
      </div>

      {/* Recent activity */}
      <div className="border-t border-zinc-100 pt-5">
        <RecentActivity activities={activities} />
      </div>

      {/* Won (prospect → active) */}
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
  return (
    <div>
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-500">
        Recent activity
      </h3>
      {activities.length === 0 ? (
        <p className="text-sm text-zinc-400">No activity logged yet.</p>
      ) : (
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
      )}
    </div>
  );
}
