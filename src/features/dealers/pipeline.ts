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
