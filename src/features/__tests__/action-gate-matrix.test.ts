// Drives every gated Server Action / Route Handler in `action-gate-matrix.ts`
// against four role profiles (unauth / admin / coach / orphan) and asserts
// the documented outcome. Catches "gate present but wrong admit set" — the
// 0031 lint rule catches "no gate at all"; this catches "gate is gated for
// the wrong roles."
//
// Strategy:
//   - Mock `getUser` + `loadCurrentMembership` + `redirect` at module-load
//     time so each gate decision is driven by the fixture, not a real DB.
//   - Mock `db` to a no-op stub so an admin pass-through doesn't actually
//     mutate anything; the gate runs first, so denial paths never reach db.
//   - For each row × role: invoke the action, capture thrown / resolved,
//     compare against the matrix's expected outcome.
//
// The drift-detection test re-greps the gated source surface and fails if
// any action in source is missing from the matrix.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

// Next.js redirect throws `Error` with `digest: 'NEXT_REDIRECT;...'`. Both the
// imperative `assertCan` callers AND the safe-action middleware (via
// `isNavigationError`) recognise this digest and let it propagate. The mock
// matches that shape so post-0033 actions wrapped in `capabilityClient`
// surface the redirect as a thrown error rather than a `{serverError}` body.
const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  loadCurrentMembership: vi.fn(),
  redirect: vi.fn((p: string) => {
    const err = new Error(`NEXT_REDIRECT;replace;${p};307;`);
    (err as Error & { digest: string }).digest = `NEXT_REDIRECT;replace;${p};307;`;
    throw err;
  }),
}));

vi.mock('server-only', () => ({}));
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/supabase/session', () => ({ getUser: mocks.getUser }));
vi.mock('@/lib/auth/load-team-membership', async (importOriginal) => {
  const real = await importOriginal<
    typeof import('@/lib/auth/load-team-membership')
  >();
  return {
    ...real,
    loadCurrentMembership: mocks.loadCurrentMembership,
  };
});

// `db` is a noop stub: every chain returns either an empty array, undefined,
// or a thenable that resolves to []. We don't care about action correctness
// past the gate — the gate either redirects (deny) or doesn't (allow).
vi.mock('@/lib/db', () => {
  const noop = () => emptyChain();
  function emptyChain(): unknown {
    const target: Record<string | symbol, unknown> = {
      then: (onF: (v: unknown) => unknown) => Promise.resolve([]).then(onF),
      catch: () => emptyChain(),
      finally: () => emptyChain(),
    };
    return new Proxy(target, {
      get(t, key) {
        if (key in t) return t[key as string];
        return () => emptyChain();
      },
    });
  }
  const tx = new Proxy(
    {},
    {
      get: () => noop,
    },
  );
  return {
    db: new Proxy(
      {},
      {
        get(_, key) {
          if (key === 'transaction') {
            return async (fn: (t: unknown) => Promise<unknown>) => {
              try {
                return await fn(tx);
              } catch (err) {
                throw err;
              }
            };
          }
          return noop;
        },
      },
    ),
  };
});

// Stub the audit + admin client + Resend so admin-passthrough doesn't try to
// touch external services on its way down the action.
vi.mock('@/features/audit/actions', () => ({ recordAudit: vi.fn() }));
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    auth: { admin: { createUser: vi.fn(), updateUserById: vi.fn() } },
  }),
}));
vi.mock('@/lib/email/send', () => ({
  sendEmail: async () => ({ ok: true } as const),
}));

import {
  ACTION_MATRIX,
  type ActionMatrixRow,
  type Outcome,
  type RoleKey,
} from './action-gate-matrix';

type RoleFixture = {
  user: { id: string; email?: string | null; app_metadata: Record<string, unknown> } | null;
  membership: {
    contactId: number;
    roles: string[];
    coachContactId: number | null;
    hasDealerContact: boolean;
  } | null;
};

const FIXTURES: Record<RoleKey, RoleFixture> = {
  unauth: { user: null, membership: null },
  admin: {
    user: {
      id: 'u-admin',
      email: 'admin@test.local',
      app_metadata: { role: 'admin' },
    },
    membership: null,
  },
  staff: {
    user: { id: 'u-staff', email: 'staff@test.local', app_metadata: {} },
    membership: {
      contactId: 5,
      roles: ['staff'],
      coachContactId: null,
      hasDealerContact: false,
    },
  },
  coach: {
    user: { id: 'u-coach', email: 'coach@test.local', app_metadata: {} },
    membership: {
      contactId: 7,
      roles: ['coach'],
      coachContactId: 7,
      hasDealerContact: false,
    },
  },
  viewer: {
    user: { id: 'u-viewer', email: 'viewer@test.local', app_metadata: {} },
    membership: {
      contactId: 9,
      roles: ['viewer'],
      coachContactId: null,
      hasDealerContact: false,
    },
  },
  dealer: {
    user: { id: 'u-dealer', email: 'dealer@test.local', app_metadata: {} },
    membership: {
      contactId: 11,
      roles: ['dealer'],
      coachContactId: null,
      hasDealerContact: true,
    },
  },
  orphan: {
    user: { id: 'u-orphan', email: null, app_metadata: {} },
    membership: null,
  },
};

function applyFixture(role: RoleKey) {
  const fix = FIXTURES[role];
  mocks.getUser.mockResolvedValue(fix.user);
  mocks.loadCurrentMembership.mockResolvedValue(fix.membership);
}

async function captureOutcome(
  invoke: () => Promise<unknown>,
): Promise<{ kind: 'resolve'; value: unknown } | { kind: 'throw'; message: string }> {
  try {
    const value = await invoke();
    return { kind: 'resolve', value };
  } catch (err) {
    return {
      kind: 'throw',
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

function classify(
  outcome: Awaited<ReturnType<typeof captureOutcome>>,
): Outcome | 'allow-with-error' {
  if (outcome.kind === 'resolve') return 'allow';
  // The redirect mock throws an Error whose `digest` starts with
  // `NEXT_REDIRECT;<kind>;<path>;...`. Decode the path so the assertion
  // can compare against `redirect:/login` / `redirect:/`. Anything else is
  // post-gate and counts as "allow" — the gate let the action proceed,
  // where it then failed on validation, missing FormData fields, or the
  // no-op DB stub.
  const m = outcome.message.match(/^NEXT_REDIRECT;[^;]+;([^;]+);/);
  if (m) return `redirect:${m[1]}` as Outcome;
  return 'allow-with-error';
}

describe('action gate matrix — every gated action × role × outcome', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.redirect.mockImplementation((p: string) => {
      const err = new Error(`NEXT_REDIRECT;replace;${p};307;`);
      (err as Error & { digest: string }).digest = `NEXT_REDIRECT;replace;${p};307;`;
      throw err;
    });
  });

  for (const row of ACTION_MATRIX) {
    describe(row.label, () => {
      for (const role of [
        'unauth',
        'admin',
        'staff',
        'coach',
        'viewer',
        'dealer',
        'orphan',
      ] as RoleKey[]) {
        const expected = row.expectedByRole[role];
        it(`${role} → ${expected}`, async () => {
          applyFixture(role);
          const outcome = await captureOutcome(row.invoke);
          const actual = classify(outcome);

          if (expected === 'allow') {
            // Either a clean resolve OR a non-redirect throw counts as
            // "the gate let me through." A redirect would be a wrong-admit
            // bug.
            expect(actual === 'allow' || actual === 'allow-with-error').toBe(
              true,
            );
            if (!(actual === 'allow' || actual === 'allow-with-error')) {
              throw new Error(
                `[${row.label}] ${role}: expected gate-allow but got ${actual} — note: ${row.note}`,
              );
            }
          } else {
            expect(actual).toBe(expected);
            if (actual !== expected) {
              throw new Error(
                `[${row.label}] ${role}: expected ${expected} but got ${actual} — note: ${row.note}`,
              );
            }
          }
        });
      }
    });
  }
});

// ---- Drift detection ----------------------------------------------------
// Cheap regex-based grep over the gated source. If a new action lands with
// `assertCan(...)` or `capabilityClient(...)` and isn't in the matrix, this
// fails. Catches the failure mode "matrix went stale because nobody added
// the row."

function thisFile() {
  return fileURLToPath(import.meta.url);
}
function repoRoot(): string {
  // src/features/__tests__/action-gate-matrix.test.ts → up 4 levels.
  return path.resolve(thisFile(), '../../../..');
}

function* walk(dir: string): Generator<string> {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.next') continue;
      yield* walk(full);
    } else {
      yield full;
    }
  }
}

function gatedFiles(): string[] {
  const root = repoRoot();
  const out: string[] = [];
  const featuresDir = path.join(root, 'src', 'features');
  for (const f of walk(featuresDir)) {
    // Match `*/actions.ts` and any `*/actions/*.ts` — both legitimate Server
    // Action module shapes. Skip declaration files and `*.test.ts`.
    const isActionsFile =
      f.endsWith(`${path.sep}actions.ts`) ||
      f.includes(`${path.sep}actions${path.sep}`);
    if (!isActionsFile) continue;
    if (f.endsWith('.d.ts') || f.endsWith('.test.ts')) continue;
    // Only Server Action files (top-level 'use server' directive) — internal
    // helper modules like `src/features/audit/actions.ts` are imported
    // server-side but aren't directly invocable from the client, so they're
    // not part of the gated-action surface the matrix covers. Allow leading
    // block comments before the directive.
    const src = fs.readFileSync(f, 'utf8');
    if (!hasUseServerDirective(src)) continue;
    out.push(f);
  }
  const appDir = path.join(root, 'src', 'app');
  for (const f of walk(appDir)) {
    if (f.endsWith('route.ts')) out.push(f);
  }
  return out;
}

// Strip leading block-comment / line-comment / whitespace, then check the
// first remaining statement is `'use server'`. More forgiving than the
// previous `^\s*['"]use server['"];?` match — handles
// `/* note */ 'use server';` and other prologue shapes.
function hasUseServerDirective(src: string): boolean {
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') {
      i++;
      continue;
    }
    if (src.startsWith('//', i)) {
      const nl = src.indexOf('\n', i);
      i = nl < 0 ? src.length : nl + 1;
      continue;
    }
    if (src.startsWith('/*', i)) {
      const end = src.indexOf('*/', i + 2);
      i = end < 0 ? src.length : end + 2;
      continue;
    }
    break;
  }
  const tail = src.slice(i, i + 16);
  return /^['"]use server['"]/.test(tail);
}

// Detect exported async functions in the file across the export shapes
// matching the 0031 lint rule's surface:
//   1. `export async function NAME(...)`           — declaration export
//   2. `export const NAME = async (...) => ...`    — variable arrow export
//   3. `export const NAME = async function (...)`  — variable function-expr
//   4. `export default async function NAME?(...)`  — default declaration
//   5. `export default async (...) => ...`         — default arrow
// (Specifier exports `export { NAME }` and re-exports are not yet covered —
// AST-level work; documented carry-forward.)
function exportedGatedFunctions(file: string): string[] {
  const src = fs.readFileSync(file, 'utf8');
  // Skip entire file if it has no gate call anywhere — auth flow opted out
  // via // authz: public is not in scope for the matrix.
  const hasGateCall =
    /assertCan\s*\(/.test(src) ||
    /capabilityClient\s*\(/.test(src) ||
    /requireStaffAccess\s*\(/.test(src);
  if (!hasGateCall) return [];

  type Hit = { name: string; sigStart: number };
  const hits: Hit[] = [];
  const patterns: RegExp[] = [
    /export\s+async\s+function\s+([A-Za-z0-9_$]+)\s*\(/g,
    /export\s+const\s+([A-Za-z0-9_$]+)\s*(?::\s*[^=]+)?=\s*async\b/g,
    /export\s+default\s+async\s+function(?:\s+([A-Za-z0-9_$]+))?\s*\(/g,
  ];
  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(src)) !== null) {
      hits.push({ name: m[1] || 'default', sigStart: m.index });
    }
  }
  // `export default async (` — anonymous arrow default. Only counts if no
  // function form preceded.
  const defaultArrow = /export\s+default\s+async\s*[(<]/g;
  if (defaultArrow.test(src) && !hits.some((h) => h.name === 'default')) {
    hits.push({ name: 'default', sigStart: src.search(defaultArrow) });
  }

  // Filter out functions explicitly opted out via `// authz: public` line
  // comment immediately preceding the export.
  return hits
    .filter((h) => {
      const prior = src.slice(0, h.sigStart);
      const lastNl = prior.lastIndexOf('\n', prior.length - 2);
      const priorLine = prior.slice(lastNl + 1).trim();
      return !priorLine.startsWith('// authz: public');
    })
    .map((h) => h.name);
}

describe('action gate matrix — drift detection', () => {
  it('every gated action in source appears in ACTION_MATRIX', () => {
    const sourceNames = new Set<string>();
    for (const file of gatedFiles()) {
      // Route Handlers' export is `GET` / `POST` / etc — coerce into a
      // matrix-comparable label.
      const isRoute = file.endsWith('route.ts');
      for (const fn of exportedGatedFunctions(file)) {
        if (isRoute) {
          // Build the matrix-side label: "GET /production/export" etc.
          const root = repoRoot();
          const rel = path
            .relative(path.join(root, 'src', 'app'), file)
            .replace(/\\/g, '/')
            .replace(/\(app\)\//g, '')
            .replace(/\/route\.ts$/, '');
          sourceNames.add(`${fn} /${rel}`);
        } else {
          sourceNames.add(fn);
        }
      }
    }

    const matrixNames = new Set(ACTION_MATRIX.map((r: ActionMatrixRow) => r.label));

    const missingFromMatrix = [...sourceNames].filter((n) => !matrixNames.has(n));

    expect(missingFromMatrix).toEqual([]);
    if (missingFromMatrix.length) {
      throw new Error(
        `New gated action(s) in source missing from ACTION_MATRIX: ${missingFromMatrix.join(', ')}. Add a matrix row in src/features/__tests__/action-gate-matrix.ts so this suite enforces the per-role admit set.`,
      );
    }
  });
});
