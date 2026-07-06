// Pure aggregation for the 0088 dealer-pipeline management dashboard. Takes
// already-loaded rows (from `loadDealerPipelineDashboard` in
// `schedule/queries.ts`) and produces the dashboard view model. No DB and no
// `server-only` import here, so the shapes + counting are unit-testable with
// plain fixtures (`dashboard.test.ts`) — the loader does the I/O, this does the
// math.
//
// Scope (decision.md D3/D4):
//  - Funnel, by-owner, and blockers count **non-archived prospects** only
//    (`status='prospect'`) — an active dealer has converted, so it's "won", not
//    a pipeline row.
//  - `won` = non-archived `status='active'`. This is *all* active dealers (the
//    commercial-spine definition of won); the schema carries no
//    "converted-from-prospect" provenance to scope it to this cohort.
//  - Activity counts are rolling windows (last 7 / last 30 days) off
//    `occurred_at`.

import {
  ACTIVITY_KINDS,
  isOverdue,
  isStale,
  isStalled,
  PIPELINE_STAGE_LABELS,
  PIPELINE_STAGES,
  type ActivityKind,
  type PipelineStage,
} from './pipeline';

// ---- Inputs (structurally satisfied by `Dealer` / a windowed activity row) ---

export interface DashboardDealer {
  id: number;
  name: string;
  status: 'prospect' | 'active';
  pipelineStage: PipelineStage | null;
  ownerId: string | null;
  ownerName: string | null;
  nextActionAt: string | null;
  lastContactedAt: Date | null;
  stageChangedAt: Date | null;
  archivedAt: Date | null;
}

export interface DashboardActivity {
  kind: ActivityKind;
  occurredAt: Date;
  createdById: string | null;
  actorName: string | null;
}

// ---- Output view model ------------------------------------------------------

export interface StageCount {
  stage: PipelineStage;
  label: string;
  count: number;
}

export interface FunnelSummary {
  /** All 9 stages in funnel order, zeros included, so the UI renders a stable funnel. */
  stages: StageCount[];
  /** Non-archived `status='prospect'` dealers. */
  totalProspects: number;
  /** Non-archived `status='active'` dealers (converted). */
  won: number;
}

export interface OwnerWorkload {
  ownerId: string | null;
  /** Resolved coach name, or 'Unassigned' (null owner) / 'Unknown' (unresolved). */
  ownerName: string;
  total: number;
  byStage: Record<PipelineStage, number>;
}

export interface ActivityActorCount {
  actorId: string | null;
  actorName: string;
  /** Touches in the last 7 days. */
  thisWeek: number;
  /** Touches in the last 30 days. */
  last30: number;
  /** Per-kind breakdown over the 30-day window. */
  byKind: Record<ActivityKind, number>;
}

export interface BlockerDealer {
  id: number;
  name: string;
  ownerName: string | null;
  pipelineStage: PipelineStage | null;
  stageChangedAt: Date | null;
  lastContactedAt: Date | null;
  nextActionAt: string | null;
}

export interface Blockers {
  stalled: BlockerDealer[];
  stale: BlockerDealer[];
  overdue: BlockerDealer[];
}

export interface PipelineDashboard {
  funnel: FunnelSummary;
  byOwner: OwnerWorkload[];
  activity: ActivityActorCount[];
  blockers: Blockers;
}

// ---- Helpers ----------------------------------------------------------------

const DAY_MS = 86_400_000;

function activeProspects(dealers: DashboardDealer[]): DashboardDealer[] {
  return dealers.filter((d) => d.archivedAt == null && d.status === 'prospect');
}

function emptyStageRecord(): Record<PipelineStage, number> {
  return Object.fromEntries(PIPELINE_STAGES.map((s) => [s, 0])) as Record<PipelineStage, number>;
}

function emptyKindRecord(): Record<ActivityKind, number> {
  return Object.fromEntries(ACTIVITY_KINDS.map((k) => [k, 0])) as Record<ActivityKind, number>;
}

function toBlocker(d: DashboardDealer): BlockerDealer {
  return {
    id: d.id,
    name: d.name,
    ownerName: d.ownerName,
    pipelineStage: d.pipelineStage,
    stageChangedAt: d.stageChangedAt,
    lastContactedAt: d.lastContactedAt,
    nextActionAt: d.nextActionAt,
  };
}

// ---- Facet builders ---------------------------------------------------------

/** N-by-stage funnel over non-archived prospects, plus a converted (`won`)
 *  count. All 9 stages are present (zeros included) in funnel order. */
export function pipelineByStage(dealers: DashboardDealer[]): FunnelSummary {
  const prospects = activeProspects(dealers);
  const counts = emptyStageRecord();
  for (const d of prospects) if (d.pipelineStage) counts[d.pipelineStage] += 1;
  return {
    stages: PIPELINE_STAGES.map((stage) => ({
      stage,
      label: PIPELINE_STAGE_LABELS[stage],
      count: counts[stage],
    })),
    totalProspects: prospects.length,
    won: dealers.filter((d) => d.archivedAt == null && d.status === 'active').length,
  };
}

/** Per-owner workload — stage breakdown + total, over non-archived prospects. A
 *  null owner collapses into a single 'Unassigned' bucket. Sorted by total
 *  desc, then owner name. */
export function pipelineByOwner(dealers: DashboardDealer[]): OwnerWorkload[] {
  const byKey = new Map<string, OwnerWorkload>();
  for (const d of activeProspects(dealers)) {
    const key = d.ownerId ?? '__unassigned__';
    let row = byKey.get(key);
    if (!row) {
      row = {
        ownerId: d.ownerId,
        ownerName: d.ownerId ? (d.ownerName ?? 'Unknown') : 'Unassigned',
        total: 0,
        byStage: emptyStageRecord(),
      };
      byKey.set(key, row);
    }
    row.total += 1;
    if (d.pipelineStage) row.byStage[d.pipelineStage] += 1;
  }
  return [...byKey.values()].sort(
    (a, b) => b.total - a.total || a.ownerName.localeCompare(b.ownerName),
  );
}

/** Activity counts per actor over rolling last-7 / last-30-day windows, with a
 *  per-kind breakdown over the 30-day window. Rows older than 30 days are
 *  ignored. Sorted by last-30 total desc, then actor name. */
export function activityCounts(activities: DashboardActivity[], now: Date): ActivityActorCount[] {
  const weekCutoff = now.getTime() - 7 * DAY_MS;
  const monthCutoff = now.getTime() - 30 * DAY_MS;
  const byKey = new Map<string, ActivityActorCount>();
  for (const ev of activities) {
    const t = ev.occurredAt.getTime();
    if (t < monthCutoff) continue; // outside the widest window
    const key = ev.createdById ?? '__unknown__';
    let row = byKey.get(key);
    if (!row) {
      row = {
        actorId: ev.createdById,
        actorName: ev.createdById ? (ev.actorName ?? 'Unknown') : 'Unknown',
        thisWeek: 0,
        last30: 0,
        byKind: emptyKindRecord(),
      };
      byKey.set(key, row);
    }
    row.last30 += 1;
    row.byKind[ev.kind] += 1;
    if (t >= weekCutoff) row.thisWeek += 1;
  }
  return [...byKey.values()].sort(
    (a, b) => b.last30 - a.last30 || a.actorName.localeCompare(b.actorName),
  );
}

/** The three "why no progress" blocker lists over non-archived prospects
 *  (decision.md D3): stalled (too long in stage), stale (no recent touch / never
 *  touched), overdue (past-due commitment). Each is sorted worst-first —
 *  oldest / never-contacted / most-overdue leads. */
export function blockers(dealers: DashboardDealer[], now: Date, todayIso: string): Blockers {
  const prospects = activeProspects(dealers);
  const stalled = prospects
    .filter((d) => isStalled(d.stageChangedAt, now))
    .sort((a, b) => (a.stageChangedAt?.getTime() ?? 0) - (b.stageChangedAt?.getTime() ?? 0))
    .map(toBlocker);
  // Never-contacted (null) sorts first, then oldest touch first.
  const stale = prospects
    .filter((d) => isStale(d.lastContactedAt, now))
    .sort(
      (a, b) =>
        (a.lastContactedAt?.getTime() ?? -Infinity) - (b.lastContactedAt?.getTime() ?? -Infinity),
    )
    .map(toBlocker);
  const overdue = prospects
    .filter((d) => isOverdue(d.nextActionAt, todayIso))
    .sort((a, b) => (a.nextActionAt ?? '').localeCompare(b.nextActionAt ?? ''))
    .map(toBlocker);
  return { stalled, stale, overdue };
}

/** Compose the full dashboard view model from the loaded rows. */
export function buildPipelineDashboard(
  dealers: DashboardDealer[],
  activities: DashboardActivity[],
  now: Date,
  todayIso: string,
): PipelineDashboard {
  return {
    funnel: pipelineByStage(dealers),
    byOwner: pipelineByOwner(dealers),
    activity: activityCounts(activities, now),
    blockers: blockers(dealers, now, todayIso),
  };
}
