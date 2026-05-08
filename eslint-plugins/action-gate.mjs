// Custom ESLint rule: Server Actions and protected Route Handlers must call
// an auth gate. The default rejects gate omission; per-function opt-out via
// `// authz: public` line comment.
//
// Hardening (post-Codex review of 0031):
//   1. Gate identifiers must resolve to imports from `@/lib/auth/*` — a
//      same-file no-op shadow named `assertCan` does NOT satisfy the rule.
//   2. Exports are checked across all shapes: `export async function`,
//      `export const x = async () => {…}`, `export default async function`,
//      `export default async arrow`, AND `export { localName as PublicName }`
//      where `localName` resolves to a same-file async function/variable.
//   3. Gate calls inside nested function bodies (uncalled inner closures)
//      do NOT count — only calls in the action's own statement scope reach
//      the runtime auth check.
//
// Allow-list of gate import names is configurable via rule options. Same-file
// helper functions whose body itself calls a verified gate are detected as
// "wrapper gates" via a fixed-point pass.
//
// AST is intentionally walked with parser-agnostic shape — works with espree
// (default in tests) and `@typescript-eslint/parser` (real codebase).

const DEFAULT_GATE_NAMES = ['assertCan', 'requireRole', 'requireStaffAccess'];
const DEFAULT_OPT_OUT = 'authz: public';
// Any import source under `@/lib/auth/` (or a relative path resolving to
// `src/lib/auth/`) is trusted as the gate's origin module.
const AUTH_SOURCE_PATTERNS = [
  /^@\/lib\/auth\//,
  /^\.{1,2}\/(?:[^/]+\/)*lib\/auth\//,
  /^src\/lib\/auth\//,
];

function isTrustedAuthSource(source) {
  if (typeof source !== 'string') return false;
  return AUTH_SOURCE_PATTERNS.some((re) => re.test(source));
}

// Only direct `Identifier` callees count as gate calls. `obj.assertCan(...)`,
// `obj['assertCan'](...)`, and computed-key spoofing all fail because the
// member name isn't a binding we can resolve back to an import.
function directIdentifierCalleeName(callee) {
  if (!callee) return null;
  if (callee.type === 'Identifier') return callee.name;
  return null;
}

// Walk the body of a function looking for a direct-Identifier CallExpression
// whose callee name is in `gates`. Conservative reachability:
//   1. Skip into nested function bodies (uncalled closures don't gate).
//   2. Skip into branching constructs (if/switch/try/while/for/do/conditional/
//      logical-OR/AND) — gates inside conditional branches don't gate the
//      action at runtime, since execution might bypass them. The codebase
//      pattern is "gate at top of function before any branching" — we lock
//      that pattern in as the only shape the rule recognises.
//   3. Stop at the first top-level Return/Throw — gates after an unconditional
//      exit are unreachable. (We DO inspect the Return/Throw expression
//      itself; `return assertCan(...)` is a valid gate-then-return.)
function bodyContainsGateCall(body, gates) {
  if (!body || typeof body !== 'object') return false;
  // BlockStatement: walk top-level statements sequentially, stopping at the
  // first Return/Throw (after walking it). Other body shapes (expression-body
  // arrows like `async () => assertCan('x')`) fall through to the recursive
  // walk directly.
  if (body.type === 'BlockStatement') {
    for (const stmt of body.body) {
      if (statementOrExpressionContainsGate(stmt, gates)) return true;
      if (stmt.type === 'ReturnStatement' || stmt.type === 'ThrowStatement') {
        return false;
      }
    }
    return false;
  }
  return statementOrExpressionContainsGate(body, gates);
}

function statementOrExpressionContainsGate(root, gates) {
  let found = false;
  function walk(node, inBranch) {
    if (found || !node || typeof node !== 'object') return;
    const isNestedFn =
      node.type === 'FunctionDeclaration' ||
      node.type === 'FunctionExpression' ||
      node.type === 'ArrowFunctionExpression';
    if (isNestedFn && node !== root) return;
    const opensBranch =
      node.type === 'IfStatement' ||
      node.type === 'SwitchStatement' ||
      node.type === 'TryStatement' ||
      node.type === 'WhileStatement' ||
      node.type === 'DoWhileStatement' ||
      node.type === 'ForStatement' ||
      node.type === 'ForInStatement' ||
      node.type === 'ForOfStatement' ||
      node.type === 'ConditionalExpression' ||
      node.type === 'LogicalExpression';
    const childInBranch = inBranch || opensBranch;
    if (!inBranch && node.type === 'CallExpression') {
      const name = directIdentifierCalleeName(node.callee);
      if (name && gates.has(name)) {
        found = true;
        return;
      }
    }
    for (const key of Object.keys(node)) {
      if (key === 'parent' || key === 'loc' || key === 'range') continue;
      const value = node[key];
      if (Array.isArray(value)) {
        for (const item of value) walk(item, childInBranch);
      } else if (value && typeof value === 'object' && value.type) {
        walk(value, childInBranch);
      }
    }
  }
  walk(root, false);
  return found;
}

function asyncFunctionFromDeclarator(d) {
  if (
    d.id?.type === 'Identifier' &&
    d.init &&
    (d.init.type === 'ArrowFunctionExpression' || d.init.type === 'FunctionExpression') &&
    d.init.async
  ) {
    return { name: d.id.name, fn: d.init };
  }
  return null;
}

// Returns array of {name, fn} for each async function-shaped binding the
// declaration introduces (handles `function foo()` and `const foo = …`).
function asyncFunctionsFromDeclaration(decl) {
  if (!decl) return [];
  if (decl.type === 'FunctionDeclaration' && decl.id && decl.async) {
    return [{ name: decl.id.name, fn: decl }];
  }
  if (decl.type === 'VariableDeclaration') {
    const out = [];
    for (const d of decl.declarations) {
      const info = asyncFunctionFromDeclarator(d);
      if (info) out.push(info);
    }
    return out;
  }
  return [];
}

// Build a map: localBindingName → { fn?: AST, isVerifiedGate?: boolean }.
// Includes imports (whose `.fn` is undefined but isVerifiedGate may be true)
// AND same-file functions/variables (whose `.fn` is the AST node so we can
// re-examine their body during fixed-point wrapper detection).
function buildLocalBindings(programBody, baseGateImportNames) {
  const bindings = new Map();

  function setImport(localName, isGate) {
    bindings.set(localName, { fn: null, isVerifiedGate: !!isGate });
  }
  function setLocal(name, fn) {
    if (!bindings.has(name)) {
      bindings.set(name, { fn, isVerifiedGate: false });
    }
  }

  for (const node of programBody) {
    if (node.type === 'ImportDeclaration') {
      const source = node.source && node.source.value;
      const trusted = isTrustedAuthSource(source);
      for (const spec of node.specifiers || []) {
        // Only `ImportSpecifier` (named) imports can be gates — default and
        // namespace imports of an auth module are not the gate function.
        if (spec.type === 'ImportSpecifier') {
          const importedName =
            (spec.imported && spec.imported.name) || spec.local.name;
          const isGate = trusted && baseGateImportNames.has(importedName);
          setImport(spec.local.name, isGate);
        } else {
          // Default + namespace imports — record the name so a later
          // same-file wrapper named the same can't accidentally claim
          // gate-ness via the import alone.
          setImport(spec.local.name, false);
        }
      }
    } else if (node.type === 'FunctionDeclaration' && node.id) {
      setLocal(node.id.name, node);
    } else if (node.type === 'VariableDeclaration') {
      for (const d of node.declarations) {
        if (
          d.id?.type === 'Identifier' &&
          d.init &&
          (d.init.type === 'ArrowFunctionExpression' ||
            d.init.type === 'FunctionExpression')
        ) {
          setLocal(d.id.name, d.init);
        }
      }
    } else if (node.type === 'ExportNamedDeclaration' && node.declaration) {
      const decl = node.declaration;
      if (decl.type === 'FunctionDeclaration' && decl.id) {
        setLocal(decl.id.name, decl);
      } else if (decl.type === 'VariableDeclaration') {
        for (const d of decl.declarations) {
          if (
            d.id?.type === 'Identifier' &&
            d.init &&
            (d.init.type === 'ArrowFunctionExpression' ||
              d.init.type === 'FunctionExpression')
          ) {
            setLocal(d.id.name, d.init);
          }
        }
      }
    }
  }

  // Fixed-point: any local function whose body contains a call to an
  // already-verified gate becomes a verified gate itself.
  let changed = true;
  while (changed) {
    changed = false;
    const verified = new Set(
      [...bindings.entries()]
        .filter(([, v]) => v.isVerifiedGate)
        .map(([k]) => k),
    );
    for (const info of bindings.values()) {
      if (info.isVerifiedGate || !info.fn) continue;
      if (bodyContainsGateCall(info.fn.body, verified)) {
        info.isVerifiedGate = true;
        changed = true;
      }
    }
  }

  return bindings;
}

function programHasUseServer(programBody) {
  return programBody.some(
    (n) => n.type === 'ExpressionStatement' && n.directive === 'use server',
  );
}

const noUngatedAction = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Server Actions and protected Route Handlers must call an auth gate (assertCan, requireRole, requireStaffAccess) — or opt out with `// authz: public`.',
    },
    schema: [
      {
        type: 'object',
        properties: {
          gateNames: {
            type: 'array',
            items: { type: 'string' },
            uniqueItems: true,
          },
          optOutComment: { type: 'string' },
          routeHandler: { type: 'boolean' },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      missingGate:
        "Server Action '{{name}}' has no auth gate. Call one of: {{gates}} — or add `// {{optOut}}` if intentionally public.",
      missingGateRoute:
        "Route Handler '{{name}}' has no auth gate. Call one of: {{gates}} — or add `// {{optOut}}` if intentionally public.",
    },
  },

  create(context) {
    const opts = context.options[0] || {};
    const gateNames = opts.gateNames || DEFAULT_GATE_NAMES;
    const baseGateImportNames = new Set(gateNames);
    const optOutText = (opts.optOutComment || DEFAULT_OPT_OUT).trim();
    const isRouteHandler = !!opts.routeHandler;

    const sourceCode = context.sourceCode || context.getSourceCode();
    const programBody = sourceCode.ast.body;
    const fileLevelUseServer = programHasUseServer(programBody);

    if (!isRouteHandler && !fileLevelUseServer) {
      return {};
    }

    const bindings = buildLocalBindings(programBody, baseGateImportNames);
    const verifiedGateNames = new Set(
      [...bindings.entries()]
        .filter(([, v]) => v.isVerifiedGate)
        .map(([k]) => k),
    );

    function hasOptOutBefore(node) {
      const comments = sourceCode.getCommentsBefore(node) || [];
      return comments.some((c) => {
        const trimmed = c.value.trim();
        if (trimmed === optOutText) return true;
        if (trimmed.startsWith(optOutText)) {
          const tail = trimmed.slice(optOutText.length);
          return tail.length === 0 || /^\s/.test(tail);
        }
        return false;
      });
    }

    function reportMissing(reportNode, name) {
      if (hasOptOutBefore(reportNode)) return;
      context.report({
        node: reportNode,
        messageId: isRouteHandler ? 'missingGateRoute' : 'missingGate',
        data: {
          name,
          gates: gateNames.join(', '),
          optOut: optOutText,
        },
      });
    }

    function checkExport(reportNode, fnNode, name) {
      if (!fnNode || !fnNode.async) return;
      if (bodyContainsGateCall(fnNode.body, verifiedGateNames)) return;
      reportMissing(reportNode, name);
    }

    return {
      ExportNamedDeclaration(node) {
        // Form 1: `export async function foo() {…}` /
        //         `export const foo = async () => {…}` — declaration is inline.
        if (node.declaration) {
          for (const info of asyncFunctionsFromDeclaration(node.declaration)) {
            checkExport(node, info.fn, info.name);
          }
          return;
        }
        // Form 2: `export { localName as PublicName }` — declaration is null,
        // specifiers carry the local→exported mapping. Resolve each local
        // back to its same-file binding's function AST.
        if (node.source) {
          // `export ... from 'other-file'` — we can't see the other file's
          // body here. Best effort: don't report, but log nothing (same
          // limitation as `export * from`). Carry-forward.
          return;
        }
        for (const spec of node.specifiers || []) {
          if (spec.type !== 'ExportSpecifier') continue;
          const localName = spec.local && spec.local.name;
          const exportedName =
            (spec.exported && spec.exported.name) || localName;
          if (!localName) continue;
          const binding = bindings.get(localName);
          if (binding && binding.fn) {
            checkExport(spec, binding.fn, exportedName);
          }
        }
      },
      ExportDefaultDeclaration(node) {
        const decl = node.declaration;
        if (!decl) return;
        if (
          (decl.type === 'FunctionDeclaration' ||
            decl.type === 'FunctionExpression') &&
          decl.async
        ) {
          checkExport(node, decl, decl.id?.name || 'default');
        } else if (decl.type === 'ArrowFunctionExpression' && decl.async) {
          checkExport(node, decl, 'default');
        } else if (decl.type === 'Identifier') {
          // `export default someLocalAction` — resolve to the same-file
          // binding's AST.
          const binding = bindings.get(decl.name);
          if (binding && binding.fn) {
            checkExport(node, binding.fn, decl.name);
          }
        }
      },
    };
  },
};

const plugin = {
  meta: { name: 'action-gate', version: '1.1.0' },
  rules: {
    'no-ungated-action': noUngatedAction,
  },
};

export default plugin;
