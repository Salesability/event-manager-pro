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
