// Shared constants + types for the dealer prospecting pipeline (0087). Single
// source of truth for the stage / priority / activity-kind value sets and their
// human labels — imported by the schema-mirroring zod (`pipeline-schema.ts`),
// the server projections (`schedule/queries.ts`), the dealer panel (Phase 4),
// and the commitment queue (Phase 5).
//
// These arrays MUST stay in lock-step with the pgEnums in
// `src/lib/db/schema/dealers.ts` + `dealer-activities.ts`; a unit test asserts
// equality against the drizzle `enumValues` so drift fails CI rather than at
// runtime. (Defined as plain literals here, rather than importing the schema,
// so the client bundle doesn't pull in drizzle.)

export const PIPELINE_STAGES = [
  'new',
  'researching',
  'contacted',
  'follow_up',
  'meeting_booked',
  'proposal_sent',
  'negotiation',
  'on_hold',
  'lost',
] as const;
export type PipelineStage = (typeof PIPELINE_STAGES)[number];

export const PIPELINE_STAGE_LABELS: Record<PipelineStage, string> = {
  new: 'New',
  researching: 'Researching',
  contacted: 'Contacted',
  follow_up: 'Follow-up',
  meeting_booked: 'Meeting booked',
  proposal_sent: 'Proposal sent',
  negotiation: 'Negotiation',
  on_hold: 'On hold',
  lost: 'Lost',
};

export const DEALER_PRIORITIES = ['high', 'medium', 'low'] as const;
export type DealerPriority = (typeof DEALER_PRIORITIES)[number];

export const DEALER_PRIORITY_LABELS: Record<DealerPriority, string> = {
  high: 'High',
  medium: 'Medium',
  low: 'Low',
};

export const ACTIVITY_KINDS = ['call', 'email', 'meeting', 'note', 'other'] as const;
export type ActivityKind = (typeof ACTIVITY_KINDS)[number];

export const ACTIVITY_KIND_LABELS: Record<ActivityKind, string> = {
  call: 'Call',
  email: 'Email',
  meeting: 'Meeting',
  note: 'Note',
  other: 'Other',
};

// ---- Commitment-queue bucketing (Phase 5) -----------------------------------
// All date math is on 'YYYY-MM-DD' strings (lexical compare == chronological),
// so the queue never depends on Date-object timezone behaviour.

export type DueBucket = 'overdue' | 'today' | 'week';

export const DUE_BUCKET_LABELS: Record<DueBucket, string> = {
  overdue: 'Overdue',
  today: 'Due today',
  week: 'Due this week',
};

/** Add `days` to an ISO date string, returning a new 'YYYY-MM-DD'. */
export function addDaysIso(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** A next-action is overdue when its due date is strictly before today. */
export function isOverdue(nextActionAt: string | null, todayIso: string): boolean {
  return nextActionAt != null && nextActionAt < todayIso;
}

/** Whether a due date falls in the given bucket (relative to `todayIso`). */
export function matchesDueBucket(
  nextActionAt: string | null,
  todayIso: string,
  bucket: DueBucket,
): boolean {
  if (!nextActionAt) return false;
  switch (bucket) {
    case 'overdue':
      return nextActionAt < todayIso;
    case 'today':
      return nextActionAt === todayIso;
    case 'week':
      // today through +7 days inclusive (the near-term commitment window).
      return nextActionAt >= todayIso && nextActionAt <= addDaysIso(todayIso, 7);
  }
}

/** Idle = no next action promised (the rep owes this dealer a commitment). */
export function isIdle(nextAction: string | null): boolean {
  return nextAction == null || nextAction.trim() === '';
}

// ---- Dashboard blocker thresholds (0088) ------------------------------------
// The management dashboard's "why isn't this moving" cutoffs (decision.md D3).
// Constants in v1 — a config UI is a later chunk. These operate on the
// timestamptz columns (`stage_changed_at`, `last_contacted_at`) as `Date`
// objects, unlike the queue's date-string bucketing above.

const DAY_MS = 86_400_000;

/** Days sitting in one pipeline stage before a prospect is "stalled". */
export const STALLED_DAYS = 21;
/** Days since the last logged touch before a prospect is "stale". */
export const STALE_DAYS = 14;

/** True when `at` is strictly more than `days` before `now`. A null stamp is
 *  NOT old (we can't prove age) — callers decide what null means per blocker. */
function isOlderThanDays(at: Date | null, now: Date, days: number): boolean {
  if (at == null) return false;
  return now.getTime() - at.getTime() > days * DAY_MS;
}

/** Stalled = sat in the same pipeline stage longer than `days` (read from
 *  `stage_changed_at`). A null stamp (never staged) is NOT stalled — stay
 *  conservative rather than false-flag a dealer whose age we can't establish. */
export function isStalled(stageChangedAt: Date | null, now: Date, days = STALLED_DAYS): boolean {
  return isOlderThanDays(stageChangedAt, now, days);
}

/** Stale = no touch in `days`, OR never contacted at all (null
 *  `last_contacted_at`) — a never-touched prospect is the loudest stale case
 *  (decision.md D3). */
export function isStale(lastContactedAt: Date | null, now: Date, days = STALE_DAYS): boolean {
  if (lastContactedAt == null) return true;
  return isOlderThanDays(lastContactedAt, now, days);
}
