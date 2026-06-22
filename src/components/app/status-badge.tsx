import { Badge } from '@/components/catalyst/badge';
import type { DisplayStatusKey } from '@/features/quotes/status-display';
import type { Msa } from '@/features/msa/queries';
import type { Dealer } from '@/features/schedule/queries';
import {
  type DealerPriority,
  DEALER_PRIORITY_LABELS,
  type PipelineStage,
  PIPELINE_STAGE_LABELS,
} from '@/features/dealers/pipeline';

type BadgeColor = 'zinc' | 'brand' | 'green' | 'amber' | 'blue' | 'red';

const QUOTE_COLOR: Record<DisplayStatusKey, BadgeColor> = {
  draft: 'zinc',
  sent: 'blue',
  accepted: 'green',
  declined: 'red',
  expired: 'amber',
};

export function QuoteStatusBadge({ status }: { status: DisplayStatusKey }) {
  return <Badge color={QUOTE_COLOR[status]}>{status}</Badge>;
}

type DealerStatusInput = {
  status: Dealer['status'];
  archivedAt: Date | null;
};

export function DealerStatusBadge({ status, archivedAt }: DealerStatusInput) {
  if (archivedAt) {
    return <Badge color="zinc">Archived</Badge>;
  }
  const color: BadgeColor = status === 'active' ? 'green' : 'amber';
  return <Badge color={color}>{status}</Badge>;
}

// Prospecting funnel (0087). Colour ramps cool→warm along the funnel; `lost` red.
const PIPELINE_STAGE_COLOR: Record<PipelineStage, BadgeColor> = {
  new: 'zinc',
  researching: 'zinc',
  contacted: 'blue',
  follow_up: 'blue',
  meeting_booked: 'brand',
  proposal_sent: 'brand',
  negotiation: 'amber',
  on_hold: 'amber',
  lost: 'red',
};

export function PipelineStageBadge({ stage }: { stage: PipelineStage }) {
  return <Badge color={PIPELINE_STAGE_COLOR[stage]}>{PIPELINE_STAGE_LABELS[stage]}</Badge>;
}

const PRIORITY_COLOR: Record<DealerPriority, BadgeColor> = {
  high: 'red',
  medium: 'amber',
  low: 'zinc',
};

export function PriorityBadge({ priority }: { priority: DealerPriority }) {
  return <Badge color={PRIORITY_COLOR[priority]}>{DEALER_PRIORITY_LABELS[priority]}</Badge>;
}

const MSA_COLOR: Record<Msa['status'], BadgeColor> = {
  pending: 'amber',
  active: 'green',
  expired: 'zinc',
  terminated: 'red',
};

export function MsaStatusBadge({ status }: { status: Msa['status'] }) {
  return <Badge color={MSA_COLOR[status]}>{status}</Badge>;
}

type CampaignStatusBadgeProps = {
  live: boolean;
  past: boolean;
};

export function CampaignStatusBadge({ live, past }: CampaignStatusBadgeProps) {
  if (live) return <Badge color="green">Live</Badge>;
  if (past) return <Badge color="zinc">Past</Badge>;
  return <Badge color="blue">Upcoming</Badge>;
}
