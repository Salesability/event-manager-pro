import { Badge } from '@/components/catalyst/badge';
import { Section } from '@/components/app/section';

// Funnel stat strip for the Campaign SMS page (0110): the five at-a-glance
// numbers the competitor review called out — Sent / Delivered / Responses /
// No response / Stops. Presentational + hook-free (server-rendered on both
// gate branches; the node-env render test calls it as a plain function).
// A live snapshot, not a reporting module — no time series, no export.

export type FunnelStripProps = {
  funnel: {
    sent: number;
    delivered: number;
    responses: number;
    noResponse: number;
    stops: number;
  };
};

export function FunnelStrip({ funnel }: FunnelStripProps) {
  return (
    <Section title="Funnel" variant="card">
      <div className="flex flex-wrap gap-2">
        <Badge color="zinc">{funnel.sent} sent</Badge>
        <Badge color={funnel.delivered ? 'green' : 'zinc'}>
          {funnel.delivered} delivered
        </Badge>
        <Badge color={funnel.responses ? 'brand' : 'zinc'}>
          {funnel.responses} {funnel.responses === 1 ? 'response' : 'responses'}
        </Badge>
        <Badge color="zinc">{funnel.noResponse} no response</Badge>
        <Badge color={funnel.stops ? 'red' : 'zinc'}>{funnel.stops} stops</Badge>
      </div>
    </Section>
  );
}
