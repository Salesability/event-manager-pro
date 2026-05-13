import { Badge, type BadgeVariant } from '@/components/ui/badge';
import type { DisplayStatusKey } from '@/features/quotes/status-display';
import type { Msa } from '@/features/msa/queries';
import type { Dealer } from '@/features/schedule/queries';

/**
 * Enum-aware status badge wrappers (0043 Phase 7). Callers pass the raw
 * status value and get the right variant + label without restating the
 * mapping at every callsite. New enums get a new wrapper here, not a new
 * inline switch.
 */

const QUOTE_VARIANT: Record<DisplayStatusKey, BadgeVariant> = {
  draft: 'secondary',
  sent: 'info',
  accepted: 'success',
  declined: 'destructive',
  expired: 'warning',
};

export function QuoteStatusBadge({ status }: { status: DisplayStatusKey }) {
  return <Badge variant={QUOTE_VARIANT[status]}>{status}</Badge>;
}

type DealerStatusInput = {
  status: Dealer['status'];
  archivedAt: Date | null;
};

export function DealerStatusBadge({ status, archivedAt }: DealerStatusInput) {
  if (archivedAt) {
    return <Badge variant="outline">Archived</Badge>;
  }
  const variant: BadgeVariant = status === 'active' ? 'success' : 'warning';
  return <Badge variant={variant}>{status}</Badge>;
}

const MSA_VARIANT: Record<Msa['status'], BadgeVariant> = {
  pending: 'warning',
  active: 'success',
  expired: 'outline',
  terminated: 'destructive',
};

export function MsaStatusBadge({ status }: { status: Msa['status'] }) {
  return <Badge variant={MSA_VARIANT[status]}>{status}</Badge>;
}

type CampaignStatusBadgeProps = {
  live: boolean;
  past: boolean;
};

export function CampaignStatusBadge({ live, past }: CampaignStatusBadgeProps) {
  if (live) return <Badge variant="success">Live</Badge>;
  if (past) return <Badge variant="outline">Past</Badge>;
  return <Badge variant="info">Upcoming</Badge>;
}
