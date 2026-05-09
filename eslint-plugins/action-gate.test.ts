// Tests for the custom action-gate ESLint rule. Uses ESLint's `Linter` rather
// than `RuleTester` so the test framework is whatever vitest gives us; uses
// the default espree parser with parser-agnostic JS fixtures (the rule walks
// shapes that ESTree-compatible parsers all produce).
import { describe, expect, it } from 'vitest';
import { ESLint, Linter } from 'eslint';
import actionGatePlugin from './action-gate.mjs';

function lintServerAction(code: string, options: Record<string, unknown> = {}) {
  const linter = new Linter({ configType: 'flat' });
  const config: Linter.Config = {
    plugins: { 'action-gate': actionGatePlugin as ESLint.Plugin },
    languageOptions: { sourceType: 'module', ecmaVersion: 2024 },
    rules: {
      'action-gate/no-ungated-action': ['error', options],
    },
  };
  return linter.verify(code, config);
}

function lintRouteHandler(code: string, options: Record<string, unknown> = {}) {
  return lintServerAction(code, { ...options, routeHandler: true });
}

describe('action-gate/no-ungated-action — Server Actions', () => {
  it('passes when an exported async function calls assertCan', () => {
    const code = `
      'use server';
      import { assertCan } from '@/lib/auth/assert-can';
      export async function createPerson(formData) {
        await assertCan('person:create');
      }
    `;
    expect(lintServerAction(code)).toEqual([]);
  });

  it('passes when an exported async function calls assertCan with a multi-role capability', () => {
    const code = `
      'use server';
      import { assertCan } from '@/lib/auth/assert-can';
      export async function createBlock(formData) {
        const user = await assertCan('availability:edit');
        return user;
      }
    `;
    expect(lintServerAction(code)).toEqual([]);
  });

  it('fails when an exported async function has no gate call', () => {
    const code = `
      'use server';
      export async function deleteEverything(formData) {
        return { ok: true };
      }
    `;
    const messages = lintServerAction(code);
    expect(messages).toHaveLength(1);
    expect(messages[0].messageId).toBe('missingGate');
    expect(messages[0].message).toContain("'deleteEverything'");
  });

  it('passes when the function has the // authz: public opt-out comment', () => {
    const code = `
      'use server';
      // authz: public
      export async function signInWithMagicLink(formData) {
        return { ok: true };
      }
    `;
    expect(lintServerAction(code)).toEqual([]);
  });

  it('passes when the opt-out comment carries a trailing explanation', () => {
    const code = `
      'use server';
      // authz: public — OAuth callback runs before any session exists.
      export async function signInWithMagicLink(formData) {
        return { ok: true };
      }
    `;
    expect(lintServerAction(code)).toEqual([]);
  });

  it('does not treat unrelated comments starting with "authz" as opt-outs', () => {
    const code = `
      'use server';
      // authzpublic
      export async function notOptedOut(formData) {
        return { ok: true };
      }
    `;
    const messages = lintServerAction(code);
    expect(messages).toHaveLength(1);
  });

  it('passes when an exported function calls a same-file wrapper that gates', () => {
    const code = `
      'use server';
      import { assertCan } from '@/lib/auth/assert-can';
      async function requireSenderEmail() {
        const user = await assertCan('email:send');
        return user.email;
      }
      export async function sendCampaign(formData) {
        const email = await requireSenderEmail();
        return { ok: true };
      }
    `;
    expect(lintServerAction(code)).toEqual([]);
  });

  it('fails when a same-file helper is unrelated to gating', () => {
    const code = `
      'use server';
      function parseId(formData) { return Number(formData.get('id')); }
      export async function ungatedAction(formData) {
        const id = parseId(formData);
        return { id };
      }
    `;
    const messages = lintServerAction(code);
    expect(messages).toHaveLength(1);
    expect(messages[0].messageId).toBe('missingGate');
  });

  it('skips files without a top-level use server directive', () => {
    const code = `
      export async function notAServerAction(formData) {
        return { ok: true };
      }
    `;
    expect(lintServerAction(code)).toEqual([]);
  });

  it('reports each ungated export independently', () => {
    const code = `
      'use server';
      export async function first() { return 1; }
      export async function second() { return 2; }
    `;
    const messages = lintServerAction(code);
    expect(messages).toHaveLength(2);
  });

  it('only reports async exports — sync exports are ignored', () => {
    const code = `
      'use server';
      export function helper() { return 1; }
    `;
    expect(lintServerAction(code)).toEqual([]);
  });

  it('handles arrow-function async exports', () => {
    const code = `
      'use server';
      export const ungated = async (formData) => {
        return { ok: true };
      };
    `;
    const messages = lintServerAction(code);
    expect(messages).toHaveLength(1);
    expect(messages[0].messageId).toBe('missingGate');
  });

  it('honours custom gateNames option', () => {
    const code = `
      'use server';
      import { myCustomGate } from '@/lib/auth/custom';
      export async function action() {
        await myCustomGate('thing');
      }
    `;
    expect(
      lintServerAction(code, { gateNames: ['myCustomGate'] }),
    ).toEqual([]);
  });
});

describe('action-gate/no-ungated-action — evasion hardening (post-Codex)', () => {
  it('rejects a same-file no-op named like a gate (shadowed import)', () => {
    const code = `
      'use server';
      function assertCan(_) { /* no-op shadow, NOT the real gate */ }
      export async function ungatedAction() {
        await assertCan('person:create');
        return { ok: true };
      }
    `;
    // The local function 'assertCan' has no body call to a verified gate, so
    // it's not promoted to a gate via fixed-point. The export must fail.
    const messages = lintServerAction(code);
    expect(messages).toHaveLength(1);
    expect(messages[0].messageId).toBe('missingGate');
  });

  it('accepts a gate imported from `@/lib/auth/*`', () => {
    const code = `
      'use server';
      import { assertCan } from '@/lib/auth/assert-can';
      export async function gated() {
        await assertCan('thing');
      }
    `;
    expect(lintServerAction(code)).toEqual([]);
  });

  it('rejects gate-name imports from non-auth modules', () => {
    const code = `
      'use server';
      import { assertCan } from '@/lib/something-else';
      export async function fakeGated() {
        await assertCan('thing');
      }
    `;
    const messages = lintServerAction(code);
    expect(messages).toHaveLength(1);
    expect(messages[0].messageId).toBe('missingGate');
  });

  it('rejects gate calls that live only inside a nested closure', () => {
    const code = `
      'use server';
      import { assertCan } from '@/lib/auth/assert-can';
      export async function leakyAction(formData) {
        const lazyCheck = async () => {
          await assertCan('person:create');
        };
        // lazyCheck is never invoked — runtime never gates.
        return { ok: true };
      }
    `;
    const messages = lintServerAction(code);
    expect(messages).toHaveLength(1);
    expect(messages[0].messageId).toBe('missingGate');
  });

  it('checks default-async-function exports', () => {
    const code = `
      'use server';
      export default async function () {
        return { ok: true };
      }
    `;
    const messages = lintServerAction(code);
    expect(messages).toHaveLength(1);
    expect(messages[0].messageId).toBe('missingGate');
  });

  it('checks default-async-arrow exports', () => {
    const code = `
      'use server';
      export default async () => ({ ok: true });
    `;
    const messages = lintServerAction(code);
    expect(messages).toHaveLength(1);
    expect(messages[0].messageId).toBe('missingGate');
  });

  it('checks `export { local as Public }` specifier exports', () => {
    const code = `
      'use server';
      const handler = async () => ({ ok: true });
      export { handler as POST };
    `;
    const messages = lintServerAction(code);
    expect(messages).toHaveLength(1);
    expect(messages[0].messageId).toBe('missingGate');
  });

  it('passes specifier exports whose local binding is gated', () => {
    const code = `
      'use server';
      import { assertCan } from '@/lib/auth/assert-can';
      const handler = async () => {
        await assertCan('thing');
      };
      export { handler as POST };
    `;
    expect(lintServerAction(code)).toEqual([]);
  });

  it('checks `export default someLocalAction` identifier exports', () => {
    const code = `
      'use server';
      const action = async () => ({ ok: true });
      export default action;
    `;
    const messages = lintServerAction(code);
    expect(messages).toHaveLength(1);
    expect(messages[0].messageId).toBe('missingGate');
  });

  it('rejects member-property name spoofs (fake.assertCan())', () => {
    const code = `
      'use server';
      const fake = { assertCan: async () => {} };
      export async function deleteEverything() {
        await fake.assertCan('admin:delete');
        return { ok: true };
      }
    `;
    const messages = lintServerAction(code);
    expect(messages).toHaveLength(1);
    expect(messages[0].messageId).toBe('missingGate');
  });

  it('rejects computed-member spoofs (fake[name]())', () => {
    const code = `
      'use server';
      const fake = { x: async () => {} };
      const k = 'assertCan';
      export async function action() {
        await fake[k]('thing');
        return { ok: true };
      }
    `;
    const messages = lintServerAction(code);
    expect(messages).toHaveLength(1);
    expect(messages[0].messageId).toBe('missingGate');
  });

  it('rejects gates inside try/catch (swallowed redirect)', () => {
    const code = `
      'use server';
      import { assertCan } from '@/lib/auth/assert-can';
      export async function action() {
        try { await assertCan('thing'); } catch {}
        return { ok: true };
      }
    `;
    const messages = lintServerAction(code);
    expect(messages).toHaveLength(1);
    expect(messages[0].messageId).toBe('missingGate');
  });

  it('rejects gates inside an if-branch', () => {
    const code = `
      'use server';
      import { assertCan } from '@/lib/auth/assert-can';
      export async function action() {
        if (false) await assertCan('thing');
        return { ok: true };
      }
    `;
    const messages = lintServerAction(code);
    expect(messages).toHaveLength(1);
  });

  it('rejects gates after an unconditional return', () => {
    const code = `
      'use server';
      import { assertCan } from '@/lib/auth/assert-can';
      export async function action() {
        return { ok: true };
        await assertCan('never:runs');
      }
    `;
    const messages = lintServerAction(code);
    expect(messages).toHaveLength(1);
  });

  it('accepts the codebase pattern: const x = (await assertCan(...)).id', () => {
    const code = `
      'use server';
      import { assertCan } from '@/lib/auth/assert-can';
      export async function createDealer(formData) {
        const userId = (await assertCan('dealer:create')).id;
        return { ok: true, userId };
      }
    `;
    expect(lintServerAction(code)).toEqual([]);
  });

  it('accepts return assertCan(...) as a gate-then-return pattern', () => {
    const code = `
      'use server';
      import { assertCan } from '@/lib/auth/assert-can';
      export async function action() {
        return assertCan('x');
      }
    `;
    expect(lintServerAction(code)).toEqual([]);
  });

  it('rejects a wrapper whose only gate call is inside an if-branch', () => {
    const code = `
      'use server';
      import { assertCan } from '@/lib/auth/assert-can';
      async function fakeWrapper() {
        if (false) await assertCan('x');
      }
      export async function action() {
        await fakeWrapper();
        return { ok: true };
      }
    `;
    const messages = lintServerAction(code);
    expect(messages).toHaveLength(1);
  });
});

describe('action-gate/no-ungated-action — Route Handlers', () => {
  it('fails when a route GET handler has no gate', () => {
    const code = `
      export async function GET(request) {
        return new Response('ok');
      }
    `;
    const messages = lintRouteHandler(code);
    expect(messages).toHaveLength(1);
    expect(messages[0].messageId).toBe('missingGateRoute');
    expect(messages[0].message).toContain("'GET'");
  });

  it('passes when the route handler calls assertCan', () => {
    const code = `
      import { assertCan } from '@/lib/auth/assert-can';
      export async function GET(request) {
        await assertCan('reports:view');
        return new Response('ok');
      }
    `;
    expect(lintRouteHandler(code)).toEqual([]);
  });

  it('passes when the route handler is opted out as public', () => {
    const code = `
      // authz: public
      export async function GET(request) {
        return new Response('ok');
      }
    `;
    expect(lintRouteHandler(code)).toEqual([]);
  });
});
