import { Badge } from '@/components/catalyst/badge';
import type { DisplayStatusKey } from '@/features/quotes/status-display';
import type { Msa } from '@/features/msa/queries';
import type { Dealer } from '@/features/schedule/queries';

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
