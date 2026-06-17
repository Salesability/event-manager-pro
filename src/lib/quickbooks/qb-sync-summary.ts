import {
  type SyncSummary,
  decodeSyncSummary,
  encodeSyncSummary,
} from '@/lib/quickbooks/dealer-sync';
import {
  type ItemSyncSummary,
  decodeItemSyncSummary,
  encodeItemSyncSummary,
} from '@/lib/quickbooks/item-sync';

// Combined dealer + item sync summary for the unified `?qbsync=` flash param
// (chunk 0083). The single "Sync" button reconciles dealers AND mirrors items
// in one click, so the page needs one notice rather than two. Dealers encode as
// `<created>.<linked>.<skipped>` (3 segments) and items as
// `<created>.<updated>.<archived>.<purged>` (4 segments); the combined param is
// the two joined by a dot — a fixed 7-segment, all-digit layout the page decodes
// back into one sentence. Reuses the per-part encoders/decoders (which already
// reject tampered/non-numeric params) so the round-trip stays unit-tested.

export type QbSyncSummary = { dealers: SyncSummary; items: ItemSyncSummary };

export function encodeQbSyncSummary(dealers: SyncSummary, items: ItemSyncSummary): string {
  return `${encodeSyncSummary(dealers)}.${encodeItemSyncSummary(items)}`;
}

export function decodeQbSyncSummary(param: string): QbSyncSummary | null {
  const parts = param.split('.');
  if (parts.length !== 7) return null;
  const dealers = decodeSyncSummary(parts.slice(0, 3).join('.'));
  const items = decodeItemSyncSummary(parts.slice(3).join('.'));
  if (!dealers || !items) return null;
  return { dealers, items };
}
