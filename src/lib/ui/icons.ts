import {
  Archive,
  CheckCircle,
  Eye,
  FilePlus,
  Pencil,
  type LucideIcon,
} from 'lucide-react';
import type { RowActionKind } from './labels';

/**
 * Canonical row-action icon mapping (0043 Phase 6). Paired with
 * `ROW_ACTION_LABELS` so every row-action site renders the same icon for
 * the same verb. Adjust an icon once, every consumer follows.
 */
export const ROW_ACTION_ICONS: Record<RowActionKind, LucideIcon> = {
  view: Eye,
  edit: Pencil,
  archive: Archive,
  activate: CheckCircle,
  quote: FilePlus,
};
