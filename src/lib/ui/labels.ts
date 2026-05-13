/**
 * Canonical row-action vocabulary (0043 Phase 6).
 *
 * Every table row's per-row action button reads its label from this map so
 * the same operation reads the same way on every list page. The companion
 * lint rule (`eslint-plugins/no-inline-row-action-label.mjs`) forbids inline
 * literals matching this vocabulary in row-action files, so the choice can't
 * silently drift back.
 *
 * View-xor-Edit rule (Decisions locked): a row exposes `View` when there's a
 * detail page to route to, OR `Edit` when the dialog is the canonical editor
 * — never both.
 */
export const ROW_ACTION_LABELS = {
  view: 'View',
  edit: 'Edit',
  archive: 'Archive',
  activate: 'Activate',
  /** `Quote` is a workflow-launch verb on dealer rows — distinct from the
   *  state-flip verbs above. Listed here so the labels constant is the
   *  single source for every row-button label. */
  quote: 'Quote',
} as const;

export type RowActionKind = keyof typeof ROW_ACTION_LABELS;
