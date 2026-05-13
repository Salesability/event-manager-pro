// Custom ESLint rule: row-action files (per-row table buttons) must not use
// inline string literals matching the canonical row-action vocabulary
// (`View`, `Edit`, `Archive`, `Activate`, `Open`, `Details`, `Manage`,
// `Show`). The labels constant in `src/lib/ui/labels.ts` is the single
// source for these strings; downstream `RowActions` consumers reference
// `ROW_ACTION_LABELS.<kind>` instead of typing the literal.
//
// Why: the chunk-0043 evidence — `/quotes` says "View", `/production` said
// "View + Edit", `/dealers` had no "View" — shows the vocabulary drifts
// silently when each file picks its own button text. Centralising in a const
// + a lint rule makes the drift impossible.
//
// Per-line opt-out via `// row-label: ok` comment. Use sparingly — most
// "false positives" are actually drift.
//
// Path-scoping (the rule only matters inside `src/app/**/row-actions.tsx`
// and `src/features/**/*-columns.tsx`) is handled by the ESLint config, not
// this rule.

const FORBIDDEN = new Set([
  'View',
  'Edit',
  'Archive',
  'Activate',
  'Open',
  'Details',
  'Manage',
  'Show',
]);

const OPT_OUT = 'row-label: ok';

const noInlineRowActionLabel = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Row-action files must source their button labels from `ROW_ACTION_LABELS` in `src/lib/ui/labels.ts` (0043 row-action convention).',
    },
    schema: [],
    messages: {
      forbiddenLiteral:
        "Inline row-action label '{{value}}' — import `ROW_ACTION_LABELS` from `@/lib/ui/labels` and use `ROW_ACTION_LABELS.{{kind}}` (or `<RowActions actions={[{ kind: '{{kind}}', … }]} />`). Opt out for the rare exception with `// row-label: ok`.",
    },
  },

  create(context) {
    const sourceCode = context.sourceCode || context.getSourceCode();

    function hasOptOutOnLine(node) {
      const comments = sourceCode.getAllComments();
      const nodeLine = node.loc.start.line;
      return comments.some((c) => {
        if (c.loc.start.line !== nodeLine && c.loc.end.line !== nodeLine) {
          return false;
        }
        return c.value.trim().includes(OPT_OUT);
      });
    }

    function check(node, value) {
      if (typeof value !== 'string') return;
      if (!FORBIDDEN.has(value)) return;
      if (hasOptOutOnLine(node)) return;
      context.report({
        node,
        messageId: 'forbiddenLiteral',
        data: { value, kind: value.toLowerCase() },
      });
    }

    return {
      Literal(node) {
        check(node, node.value);
      },
      // Template literals with no expressions: `View`
      TemplateLiteral(node) {
        if (node.expressions.length === 0 && node.quasis.length === 1) {
          check(node, node.quasis[0].value.cooked);
        }
      },
      // JSX text: <button>View</button>
      JSXText(node) {
        const trimmed = String(node.value || '').trim();
        if (trimmed) check(node, trimmed);
      },
    };
  },
};

const plugin = {
  meta: { name: 'no-inline-row-action-label', version: '1.0.0' },
  rules: {
    'no-inline-row-action-label': noInlineRowActionLabel,
  },
};

export default plugin;
