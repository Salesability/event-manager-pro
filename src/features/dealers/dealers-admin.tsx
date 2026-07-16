'use client';

import { useMemo, useRef, useState, useTransition } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { ListToolbar } from '@/components/app/list-toolbar';
import { Can } from '@/components/auth/can';
import {
  Dialog,
  DialogDescription,
  DialogTitle,
} from '@/components/catalyst/dialog';
import { Button } from '@/components/catalyst/button';
import { useConfirm } from '@/components/app/confirm-dialog';
import { DataTable } from '@/components/ui/data-table';
import { toast } from '@/components/ui/toaster';
import { makeNeedleFilter } from '@/lib/ui/data-table-filters';
import { toLegacyResult } from '@/lib/actions/legacy-result';
import { archiveDealer, convertProspectToActive } from '@/features/schedule/actions';
import type { Dealer } from '@/features/schedule/queries';
import { buildDealersColumns } from '@/features/dealers/dealers-columns';
import { DealerForm } from '@/features/dealers/dealer-form';
import {
  DEALER_PRIORITIES,
  DEALER_PRIORITY_LABELS,
  DUE_BUCKET_LABELS,
  type DueBucket,
  isIdle,
  matchesDueBucket,
  PIPELINE_STAGE_LABELS,
  PIPELINE_STAGES,
  type PipelineStage,
} from '@/features/dealers/pipeline';

type StatusPill = 'active' | 'prospect' | 'archived';

function isStatusPill(v: string): v is StatusPill {
  return v === 'active' || v === 'prospect' || v === 'archived';
}

function pillClass(active: boolean): string {
  return active
    ? 'rounded-full border border-brand-500 bg-brand-100 px-3 py-1 text-xs font-semibold text-brand-700 transition'
    : 'rounded-full border border-zinc-200 bg-white px-3 py-1 text-xs font-medium text-zinc-500 transition hover:border-brand-500 hover:text-brand-700';
}

const QUEUE_SELECT_CLASS =
  'h-7 rounded-lg border border-zinc-200 bg-white px-2 text-xs text-zinc-700 outline-none transition focus:border-brand-500 focus:ring-3 focus:ring-brand-500/20';

function matchesPill(dealer: Dealer, pill: StatusPill): boolean {
  // Archived takes precedence: `archivedAt IS NOT NULL` regardless of status.
  // 0035 plan OQ #1 resolution: status enum is only `prospect | active`; the
  // archived state lives on the existing `archivable.archivedAt` timestamp.
  switch (pill) {
    case 'archived':
      return dealer.archivedAt !== null;
    case 'active':
      return dealer.archivedAt === null && dealer.status === 'active';
    case 'prospect':
      return dealer.archivedAt === null && dealer.status === 'prospect';
  }
}

const dealersGlobalFilterFn = makeNeedleFilter<Dealer>((d) => [
  d.name,
  [d.contactFirstName, d.contactLastName].filter(Boolean).join(' '),
  d.primaryEmail,
  d.primaryPhone,
  d.address,
]);

// Compose the archive confirm body, mirroring the people-admin pattern.
// Counts (linked contacts, referenced campaigns) aren't surfaced on the
// Dealer row today — once `loadDealers` denormalises them, the message can
// list specifics. Until then it states the soft-delete guarantee in plain
// language: archive sets `dealers.archivedAt` (no cascade, no hard-delete),
// existing campaign references survive in the database, and the dealer
// disappears from active staff surfaces (the People page filters archived
// dealers via `isNull(dealers.archivedAt)`). The dialog title carries the
// "Archive <name>?" question.
function buildArchiveConfirmMessage(): string {
  return 'Existing campaigns keep their reference. Contact-link rows are preserved in history but the dealer disappears from the People page and Dealer pickers.';
}

// Today as 'YYYY-MM-DD' in the viewer's local time — the due-bucket / overdue
// reference. Computed per render (cheap) so it stays correct across midnight.
function localTodayIso(): string {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

function isDueBucket(v: string): v is DueBucket {
  return v === 'overdue' || v === 'today' || v === 'week';
}

export function DealersAdmin({
  dealers,
  currentUserId = null,
}: {
  dealers: Dealer[];
  /** The signed-in user's auth uuid — drives the "Mine" commitment filter. */
  currentUserId?: string | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [addOpen, setAddOpen] = useState(false);
  const { confirm, confirmDialog } = useConfirm();

  // URL-driven filter state so back-nav from a dealer detail page restores
  // the search term + status pill (per 0043 Phase 5). Local debounce mirrors
  // QuotesFilters' shape; pill defaults to 'active' so the page lands on the
  // same view it did when filters were component-state-only.
  const qFromUrl = params.get('q') ?? '';
  const rawStatus = params.get('status') ?? '';
  const pill: StatusPill = isStatusPill(rawStatus) ? rawStatus : 'active';

  // Commitment-queue filters (0087 Phase 5) — only meaningful on the Prospect
  // view. All URL-driven so a shared link / back-nav restores the queue state.
  const showQueue = pill === 'prospect';
  const rawDue = params.get('due') ?? '';
  const dueFilter: DueBucket | null = isDueBucket(rawDue) ? rawDue : null;
  const mineFilter = params.get('mine') === '1';
  const idleFilter = params.get('idle') === '1';
  const rawStage = params.get('stage') ?? '';
  const stageFilter = (PIPELINE_STAGES as readonly string[]).includes(rawStage)
    ? (rawStage as PipelineStage)
    : null;
  const rawPriority = params.get('priority') ?? '';
  const priorityFilter = (DEALER_PRIORITIES as readonly string[]).includes(rawPriority)
    ? rawPriority
    : null;
  const todayIso = localTodayIso();

  const [globalFilter, setGlobalFilter] = useState(qFromUrl);
  const [prevQFromUrl, setPrevQFromUrl] = useState(qFromUrl);
  if (qFromUrl !== prevQFromUrl) {
    setPrevQFromUrl(qFromUrl);
    setGlobalFilter(qFromUrl);
  }

  const [, startTransition] = useTransition();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const QUEUE_PARAMS = ['due', 'mine', 'idle', 'stage', 'priority'] as const;

  function pushParams(next: { q?: string; status?: StatusPill }) {
    const sp = new URLSearchParams(window.location.search);
    if (next.q !== undefined) {
      if (next.q) sp.set('q', next.q);
      else sp.delete('q');
    }
    if (next.status !== undefined) {
      if (next.status && next.status !== 'active') sp.set('status', next.status);
      else sp.delete('status');
      // Commitment filters are Prospect-only — drop them when leaving that view
      // so they don't linger silently in the URL.
      if (next.status !== 'prospect') QUEUE_PARAMS.forEach((k) => sp.delete(k));
    }
    const qs = sp.toString();
    startTransition(() => {
      router.replace(qs ? `${pathname}?${qs}` : pathname);
    });
  }

  // Single queue-filter param setter (value '' / false clears the key).
  function pushParam(key: (typeof QUEUE_PARAMS)[number], value: string | boolean) {
    const sp = new URLSearchParams(window.location.search);
    const v = value === true ? '1' : value === false ? '' : value;
    if (v) sp.set(key, v);
    else sp.delete(key);
    const qs = sp.toString();
    startTransition(() => {
      router.replace(qs ? `${pathname}?${qs}` : pathname);
    });
  }

  function onSearchChange(value: string) {
    setGlobalFilter(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => pushParams({ q: value }), 250);
  }

  const queueFiltered =
    mineFilter || idleFilter || dueFilter != null || stageFilter != null || priorityFilter != null;
  const isFiltered = globalFilter.trim().length > 0 || pill !== 'active';
  const clearFilters = () => {
    setGlobalFilter('');
    if (debounceRef.current) clearTimeout(debounceRef.current);
    pushParams({ q: '', status: 'active' });
  };
  const clearQueueFilters = () => {
    const sp = new URLSearchParams(window.location.search);
    QUEUE_PARAMS.forEach((k) => sp.delete(k));
    const qs = sp.toString();
    startTransition(() => router.replace(qs ? `${pathname}?${qs}` : pathname));
  };

  async function archive(dealer: Dealer) {
    if (
      !(await confirm({
        title: `Archive ${dealer.name}?`,
        message: buildArchiveConfirmMessage(),
        confirmLabel: 'Archive',
        destructive: true,
      }))
    ) {
      return;
    }
    startTransition(async () => {
      const fd = new FormData();
      fd.set('id', String(dealer.id));
      const result = toLegacyResult(await archiveDealer(fd));
      if ('ok' in result) {
        toast.success('Dealer removed');
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  function activate(dealer: Dealer) {
    startTransition(async () => {
      const fd = new FormData();
      fd.set('id', String(dealer.id));
      const result = toLegacyResult(await convertProspectToActive(fd));
      if ('ok' in result) {
        toast.success(`${dealer.name} marked active`);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  const filteredDealers = useMemo(() => {
    let rows = dealers.filter((d) => matchesPill(d, pill));
    if (showQueue) {
      if (mineFilter) rows = rows.filter((d) => d.ownerId === currentUserId);
      if (idleFilter) rows = rows.filter((d) => isIdle(d.nextAction));
      if (dueFilter) rows = rows.filter((d) => matchesDueBucket(d.nextActionAt, todayIso, dueFilter));
      if (stageFilter) rows = rows.filter((d) => d.pipelineStage === stageFilter);
      if (priorityFilter) rows = rows.filter((d) => d.priority === priorityFilter);
    }
    return rows;
  }, [
    dealers,
    pill,
    showQueue,
    mineFilter,
    idleFilter,
    dueFilter,
    stageFilter,
    priorityFilter,
    currentUserId,
    todayIso,
  ]);

  const columns = useMemo(
    () =>
      buildDealersColumns({
        onArchive: archive,
        onActivate: activate,
        view: showQueue ? 'queue' : 'default',
        todayIso,
      }),
    // See people-admin.tsx — `archive`/`activate` close over per-render state setters but
    // their identity is stable; rebuild is cheap given the column count.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [showQueue, todayIso],
  );

  const counts = useMemo(
    () => ({
      active: dealers.filter((d) => matchesPill(d, 'active')).length,
      prospect: dealers.filter((d) => matchesPill(d, 'prospect')).length,
      archived: dealers.filter((d) => matchesPill(d, 'archived')).length,
    }),
    [dealers],
  );

  return (
    <section className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-[0_1px_4px_rgba(15,30,60,0.08)]">
      {confirmDialog}
      <ListToolbar
        search={
          <input
            type="search"
            value={globalFilter}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search by name, contact, or email…"
            aria-label="Search dealers"
            className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-sm text-zinc-900 outline-none transition focus:border-brand-500 focus:ring-3 focus:ring-brand-500/20"
          />
        }
        filters={
          <>
            <button
              type="button"
              aria-pressed={pill === 'active'}
              onClick={() => pushParams({ status: 'active' })}
              className={pillClass(pill === 'active')}
            >
              Active ({counts.active})
            </button>
            <button
              type="button"
              aria-pressed={pill === 'prospect'}
              onClick={() => pushParams({ status: 'prospect' })}
              className={pillClass(pill === 'prospect')}
            >
              Prospect ({counts.prospect})
            </button>
            <button
              type="button"
              aria-pressed={pill === 'archived'}
              onClick={() => pushParams({ status: 'archived' })}
              className={pillClass(pill === 'archived')}
            >
              Archived ({counts.archived})
            </button>
          </>
        }
        actions={
          <Can capability="dealer:create">
            <Button color="brand" onClick={() => setAddOpen(true)}>
              + Add Dealer
            </Button>
          </Can>
        }
      />

      {showQueue && (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-zinc-100 pt-3">
          <span className="mr-1 text-xs font-semibold uppercase tracking-wide text-zinc-400">
            Queue
          </span>
          {currentUserId && (
            <button
              type="button"
              aria-pressed={mineFilter}
              onClick={() => pushParam('mine', !mineFilter)}
              className={pillClass(mineFilter)}
            >
              Mine
            </button>
          )}
          {(['overdue', 'today', 'week'] as DueBucket[]).map((b) => (
            <button
              key={b}
              type="button"
              aria-pressed={dueFilter === b}
              onClick={() => pushParam('due', dueFilter === b ? '' : b)}
              className={pillClass(dueFilter === b)}
            >
              {DUE_BUCKET_LABELS[b]}
            </button>
          ))}
          <button
            type="button"
            aria-pressed={idleFilter}
            onClick={() => pushParam('idle', !idleFilter)}
            className={pillClass(idleFilter)}
          >
            No commitment
          </button>
          <select
            aria-label="Filter by stage"
            value={stageFilter ?? ''}
            onChange={(e) => pushParam('stage', e.target.value)}
            className={QUEUE_SELECT_CLASS}
          >
            <option value="">All stages</option>
            {PIPELINE_STAGES.map((s) => (
              <option key={s} value={s}>
                {PIPELINE_STAGE_LABELS[s]}
              </option>
            ))}
          </select>
          <select
            aria-label="Filter by priority"
            value={priorityFilter ?? ''}
            onChange={(e) => pushParam('priority', e.target.value)}
            className={QUEUE_SELECT_CLASS}
          >
            <option value="">Any priority</option>
            {DEALER_PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {DEALER_PRIORITY_LABELS[p]}
              </option>
            ))}
          </select>
          {queueFiltered && (
            <button
              type="button"
              onClick={clearQueueFilters}
              className="text-xs font-medium text-zinc-500 underline transition hover:text-zinc-900"
            >
              Clear queue filters
            </button>
          )}
        </div>
      )}

      <p className="mt-2 text-xs text-zinc-500">
        {filteredDealers.length} {showQueue ? 'in queue' : 'dealers'}
      </p>

      <div className="mt-3">
        <DataTable
          key={showQueue ? 'queue' : 'default'}
          columns={columns}
          data={filteredDealers}
          initialSorting={[{ id: showQueue ? 'due' : 'name', desc: false }]}
          initialPageSize={50}
          globalFilter={globalFilter}
          onGlobalFilterChange={setGlobalFilter}
          globalFilterFn={dealersGlobalFilterFn}
          emptyState={
            isFiltered ? (
              <span className="inline-flex items-center gap-2">
                <span>No dealers match.</span>
                <Button outline compact type="button" onClick={clearFilters}>
                  Clear filters
                </Button>
              </span>
            ) : (
              'No dealers yet.'
            )
          }
        />
      </div>

      <Dialog open={addOpen} onClose={setAddOpen}>
        <DialogTitle>Add Dealer</DialogTitle>
        <DialogDescription>Create a new dealership.</DialogDescription>
        {addOpen && (
          <DealerForm
            mode="create"
            onSuccess={() => setAddOpen(false)}
            onCancel={() => setAddOpen(false)}
          />
        )}
      </Dialog>
    </section>
  );
}
