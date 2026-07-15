import { Badge } from '@/components/catalyst/badge';

// Display-only thread signals (0110): the AI-classified sentiment dot and
// prospect-temperature badge. Shared by the console panel and the inbox list;
// hook-free so the node-env render tests call them as plain functions. These
// are labels, never controls — they gate nothing and trigger nothing.

export function SentimentDot({
  sentiment,
}: {
  sentiment: 'positive' | 'neutral' | 'negative';
}) {
  const color =
    sentiment === 'positive'
      ? 'bg-green-500'
      : sentiment === 'negative'
        ? 'bg-red-500'
        : 'bg-zinc-400';
  return (
    <span
      role="img"
      aria-label={`sentiment: ${sentiment}`}
      title={`Sentiment: ${sentiment} (AI-classified)`}
      className={`inline-block size-2.5 shrink-0 rounded-full ${color}`}
    />
  );
}

export function TemperatureBadge({
  temperature,
}: {
  temperature: 'hot' | 'warm' | 'cold';
}) {
  const color = temperature === 'hot' ? 'red' : temperature === 'warm' ? 'amber' : 'sky';
  return (
    <Badge color={color} title={`Prospect temperature: ${temperature} (AI-classified)`}>
      {temperature} prospect
    </Badge>
  );
}
