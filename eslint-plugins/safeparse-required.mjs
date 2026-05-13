// Custom ESLint rule: Server Actions must run `safeParse` against a shared
// zod schema (0045 schema-as-contract doctrine). The default rejects actions
// that don't call `safeParse` directly or via a same-file helper. Per-export
// opt-out via `// validation: skip` line comment immediately before the
// `export`.
//
// What counts as a `safeParse` call:
//   1. `Identifier`-callee CallExpression named `safeParse` (rare; included
//      for completeness).
//   2. `MemberExpression`-callee CallExpression with property `safeParse` —
//      the canonical pattern: `someSchema.safeParse(payload)`.
//   3. A direct `Identifier`-callee CallExpression to a same-file async or
//      sync function whose own body (fixed-point) contains a `safeParse`
//      call. This catches the wrapper helpers (`parseQuoteInputs`,
//      `parseCampaignInput`, `parseAvailabilityInput`, `parseLookupLabel`,
//      etc.) that the actions delegate to.
//
// Why not strict-top-of-function (like action-gate)? `safeParse` is often
// gated behind a flag check (e.g. `if (formData.has('inputs'))` in
// `createQuote`) — the inputs are optional and the schema only fires when
// the wire field is present. Locking in a "must be the first statement"
// pattern would force a refactor that hurts more than it helps. Instead we
// walk the whole body (skipping nested function bodies) and accept any
// reachable safeParse call.
//
// AST is parser-agnostic — works with espree (default in tests) and
// `@typescript-eslint/parser` (real codebase).

const SAFE_PARSE_NAME = 'safeParse';
const DEFAULT_OPT_OUT = 'validation: skip';

function isSafeParseCall(callee) {
  if (!callee) return false;
  if (callee.type === 'Identifier' && callee.name === SAFE_PARSE_NAME) return true;
  if (
    callee.type === 'MemberExpression' &&
    !callee.computed &&
    callee.property &&
    callee.property.type === 'Identifier' &&
    callee.property.name === SAFE_PARSE_NAME
  )
    return true;
  return false;
}

function directIdentifierCalleeName(callee) {
  if (!callee) return null;
  if (callee.type === 'Identifier') return callee.name;
  return null;
}

// Walk a function body looking for either a `safeParse` call OR a call to a
// helper that's in the `wrappers` set. Skip into nested function bodies (an
// uncalled inner closure doesn't validate the action).
function bodyContainsValidation(body, wrappers) {
  if (!body || typeof body !== 'object') return false;
  let found = false;
  function walk(node) {
    if (found || !node || typeof node !== 'object') return;
    const isNestedFn =
      node.type === 'FunctionDeclaration' ||
      node.type === 'FunctionExpression' ||
      node.type === 'ArrowFunctionExpression';
    if (isNestedFn && node !== body) return;
    if (node.type === 'CallExpression') {
      if (isSafeParseCall(node.callee)) {
        found = true;
        return;
      }
      const name = directIdentifierCalleeName(node.callee);
      if (name && wrappers.has(name)) {
        found = true;
        return;
      }
    }
    for (const key of Object.keys(node)) {
      if (key === 'parent' || key === 'loc' || key === 'range') continue;
      const value = node[key];
      if (Array.isArray(value)) {
        for (const item of value) walk(item);
      } else if (value && typeof value === 'object' && value.type) {
        walk(value);
      }
    }
  }
  walk(body);
  return found;
}

function asyncFunctionsFromDeclaration(decl) {
  if (!decl) return [];
  if (decl.type === 'FunctionDeclaration' && decl.id && decl.async) {
    return [{ name: decl.id.name, fn: decl }];
  }
  if (decl.type === 'VariableDeclaration') {
    const out = [];
    for (const d of decl.declarations) {
      if (d.id?.type !== 'Identifier' || !d.init) continue;
      // Plain async function: `export const x = async () => …`
      if (
        (d.init.type === 'ArrowFunctionExpression' ||
          d.init.type === 'FunctionExpression') &&
        d.init.async
      ) {
        out.push({ name: d.id.name, fn: d.init });
        continue;
      }
      // capabilityClient(...).schema(...).action(<fn>) shape — the action
      // function passed to `.action()` is the real Server Action body. We
      // detect this by walking the call chain to find a `.action(<fn>)` call
      // whose argument is a (possibly async) function expression.
      if (d.init.type === 'CallExpression') {
        const actionFn = findActionChainFn(d.init);
        if (actionFn) out.push({ name: d.id.name, fn: actionFn });
      }
    }
    return out;
  }
  return [];
}

function findActionChainFn(node) {
  // Walk callee chain: outermost CallExpression is `.action(...)`.
  // `.action(fn)` → arg is the action function we want.
  let cur = node;
  while (cur && cur.type === 'CallExpression') {
    const callee = cur.callee;
    if (
      callee &&
      callee.type === 'MemberExpression' &&
      !callee.computed &&
      callee.property &&
      callee.property.type === 'Identifier' &&
      callee.property.name === 'action' &&
      cur.arguments &&
      cur.arguments.length > 0
    ) {
      const arg = cur.arguments[0];
      if (
        arg.type === 'ArrowFunctionExpression' ||
        arg.type === 'FunctionExpression'
      ) {
        return arg;
      }
      return null;
    }
    cur = callee && callee.type === 'MemberExpression' ? callee.object : null;
  }
  return null;
}

function buildLocalWrappers(programBody) {
  // Collect every local (non-export) function/arrow definition's AST so we
  // can run a fixed-point detection of "wrappers that internally safeParse".
  const local = new Map();
  function add(name, fn) {
    if (!name || !fn) return;
    if (!local.has(name)) local.set(name, fn);
  }
  for (const node of programBody) {
    if (node.type === 'FunctionDeclaration' && node.id) {
      add(node.id.name, node);
    } else if (node.type === 'VariableDeclaration') {
      for (const d of node.declarations) {
        if (
          d.id?.type === 'Identifier' &&
          d.init &&
          (d.init.type === 'ArrowFunctionExpression' ||
            d.init.type === 'FunctionExpression')
        ) {
          add(d.id.name, d.init);
        }
      }
    } else if (node.type === 'ExportNamedDeclaration' && node.declaration) {
      const decl = node.declaration;
      if (decl.type === 'FunctionDeclaration' && decl.id) add(decl.id.name, decl);
      else if (decl.type === 'VariableDeclaration') {
        for (const d of decl.declarations) {
          if (
            d.id?.type === 'Identifier' &&
            d.init &&
            (d.init.type === 'ArrowFunctionExpression' ||
              d.init.type === 'FunctionExpression')
          ) {
            add(d.id.name, d.init);
          }
        }
      }
    }
  }

  // Fixed-point: a local fn whose body contains a safeParse call (or a call
  // to an already-verified wrapper) becomes a verified wrapper itself.
  const wrappers = new Set();
  let changed = true;
  while (changed) {
    changed = false;
    for (const [name, fn] of local.entries()) {
      if (wrappers.has(name)) continue;
      if (bodyContainsValidation(fn.body, wrappers)) {
        wrappers.add(name);
        changed = true;
      }
    }
  }
  return wrappers;
}

function programHasUseServer(programBody) {
  return programBody.some(
    (n) => n.type === 'ExpressionStatement' && n.directive === 'use server',
  );
}

const safeparseRequired = {
  meta: {
    type: 'problem',
    docs: {
      description:
        "Server Actions must validate input via a shared zod schema's `safeParse` (0045 schema-as-contract) — or opt out with `// validation: skip`.",
    },
    schema: [
      {
        type: 'object',
        properties: {
          optOutComment: { type: 'string' },
          // Cross-file wrapper function names. Calls to these via direct
          // Identifier callee count as validation (the rule trusts that the
          // wrapper itself runs `safeParse`). Use for helpers like
          // `parseCampaignInput` in `schedule/validators.ts` that wrap a
          // shared schema and are imported by multiple action files.
          wrapperNames: {
            type: 'array',
            items: { type: 'string' },
            uniqueItems: true,
          },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      missingSafeParse:
        "Server Action '{{name}}' does not run a zod `safeParse` (directly or via a same-file wrapper). Add `schema.safeParse(Object.fromEntries(formData))` — or add `// {{optOut}}` if intentionally raw.",
    },
  },

  create(context) {
    const opts = context.options[0] || {};
    const optOutText = (opts.optOutComment || DEFAULT_OPT_OUT).trim();
    const configuredWrappers = new Set(opts.wrapperNames || []);

    const sourceCode = context.sourceCode || context.getSourceCode();
    const programBody = sourceCode.ast.body;
    if (!programHasUseServer(programBody)) return {};

    const wrappers = buildLocalWrappers(programBody);
    for (const name of configuredWrappers) wrappers.add(name);

    function hasOptOutBefore(node) {
      const comments = sourceCode.getCommentsBefore(node) || [];
      return comments.some((c) => {
        const trimmed = c.value.trim();
        return trimmed === optOutText || trimmed.startsWith(`${optOutText} `);
      });
    }

    function checkExport(reportNode, fnNode, name) {
      if (!fnNode) return;
      if (bodyContainsValidation(fnNode.body, wrappers)) return;
      if (hasOptOutBefore(reportNode)) return;
      context.report({
        node: reportNode,
        messageId: 'missingSafeParse',
        data: { name, optOut: optOutText },
      });
    }

    return {
      ExportNamedDeclaration(node) {
        if (node.declaration) {
          for (const info of asyncFunctionsFromDeclaration(node.declaration)) {
            checkExport(node, info.fn, info.name);
          }
        }
      },
    };
  },
};

const plugin = {
  meta: { name: 'safeparse-required', version: '1.0.0' },
  rules: {
    'safeparse-required': safeparseRequired,
  },
};

export default plugin;
